/**
 * 模板引擎
 */

import Mustache from 'mustache';
import { DateTime } from 'luxon';
import { logger } from '../utils/logger';
import { Article, Highlight, ImageMode } from '../utils/types';
import { formatDate, isWeChatMessage } from '../utils/util';
import { PluginSettings, DEFAULT_SETTINGS } from './index';

// 图床代理URL
const IMAGE_PROXY_URL = 'https://images.weserv.nl/?url=';

// 星期映射
const WEEKDAY_MAP: Record<number, string> = {
    1: '周一', 2: '周二', 3: '周三', 4: '周四',
    5: '周五', 6: '周六', 7: '周日'
};

/**
 * 从日期字符串生成分开的时间变量
 */
function getDateComponents(dateStr: string): {
    year: string;
    month: string;
    day: string;
    hour: string;
    minute: string;
    weekday: string;
    quarter: string;
} {
    try {
        const dt = DateTime.fromISO(dateStr);
        return {
            year: dt.toFormat('yyyy'),
            month: dt.toFormat('MM'),
            day: dt.toFormat('dd'),
            hour: dt.toFormat('HH'),
            minute: dt.toFormat('mm'),
            weekday: WEEKDAY_MAP[dt.weekday] || '',
            quarter: `Q${dt.quarter}`,
        };
    } catch (error) {
        logger.error('Date components extraction error:', error);
        return {
            year: '', month: '', day: '', hour: '', minute: '', weekday: '', quarter: ''
        };
    }
}

// 默认模板
export const DEFAULT_TEMPLATE = `## 来源
[原文链接]({{{originalUrl}}})

## 正文
{{{content}}}`;

// 文章视图接口
export interface ArticleView {
    id: string;
    title: string;
    author?: string;
    content: string;
    originalUrl: string;
    siteName?: string;
    description?: string;
    note?: string;
    dateSaved: string;
    datePublished?: string;
    dateRead?: string;
    dateArchived?: string;
    wordsCount?: number;
    readLength?: number;
    state?: string;
    type?: string;
    image?: string;
    labels?: string[];
    highlights?: HighlightView[];
}

// 高亮视图接口
export interface HighlightView {
    text: string;
    note?: string;
    color: string;
    dateHighlighted?: string;
    labels?: string[];
}

/**
 * 将文章转换为视图对象
 */
export function articleToView(
    article: Article,
    settings: PluginSettings
): ArticleView {
    const highlights = article.highlights?.map(h => highlightToView(h, settings)) || [];

    return {
        id: article.id,
        title: article.title || 'Untitled',
        author: article.author,
        content: article.content || '',
        originalUrl: article.url,
        siteName: article.siteName,
        description: article.description,
        note: article.note,
        dateSaved: formatDate(article.savedAt, settings.dateSavedFormat),
        datePublished: article.publishedAt
            ? formatDate(article.publishedAt, settings.dateSavedFormat)
            : undefined,
        wordsCount: article.wordsCount,
        readLength: article.readLength,
        state: article.state,
        type: article.type,
        image: article.image,
        labels: article.labels?.map(l => l.name) || [],
        highlights,
    };
}

/**
 * 将高亮转换为视图对象
 */
export function highlightToView(
    highlight: Highlight,
    settings: PluginSettings
): HighlightView {
    return {
        text: highlight.quote,
        note: highlight.annotation,
        color: highlight.color || 'yellow',
        dateHighlighted: formatDate(
            highlight.highlightedAt,
            settings.dateHighlightedFormat
        ),
    };
}

/**
 * 渲染文章内容
 */
export function renderArticleContent(
    article: Article,
    settings: PluginSettings
): string {
    try {
        const view = articleToView(article, settings);
        const template = settings.template || DEFAULT_TEMPLATE;
        let content = Mustache.render(template, view);

        // 处理图片URL
        content = processImageUrls(content, settings);

        return content;
    } catch (error) {
        logger.error('Template rendering error:', error);
        return `# ${article.title}\n\n${article.content}`;
    }
}

/**
 * 渲染企微消息（简洁模式）
 */
export function renderWeChatMessage(
    article: Article,
    settings: PluginSettings
): string {
    try {
        const view = articleToView(article, settings);
        const template = settings.wechatMessageTemplate;
        let content = Mustache.render(template, view);

        // 处理图片URL
        content = processImageUrls(content, settings);

        return content;
    } catch (error) {
        logger.error('WeChat message template rendering error:', error);
        return renderArticleContent(article, settings);
    }
}

/**
 * 渲染文件名
 */
export function renderFilename(
    article: Article,
    settings: PluginSettings
): string {
    try {
        const view = articleToView(article, settings);

        // 添加 date 和时间组件变量用于文件名模板
        const dateComponents = getDateComponents(article.savedAt);
        const viewWithDate = {
            ...view,
            date: formatDate(article.savedAt, settings.filenameDateFormat),
            ...dateComponents,
        };

        const template = settings.filename || DEFAULT_SETTINGS.filename;
        let filename = Mustache.render(template, viewWithDate);

        // 清理文件名中的非法字符（思源使用虚拟路径，只需排除路径分隔符和控制字符）
        filename = filename.replace(/[<>:"\\/?*]/g, '-');

        // 确保文件名不为空
        if (!filename.trim()) {
            filename = `untitled-${article.id}`;
        }

        return filename;
    } catch (error) {
        logger.error('Filename rendering error:', error);
        return `article-${article.id}`;
    }
}

/**
 * 渲染文件夹路径（普通文章）
 */
export function renderFolderPath(
    article: Article,
    settings: PluginSettings
): string {
    try {
        const view = articleToView(article, settings);

        // 添加 date 和时间组件变量用于文件夹模板
        const dateComponents = getDateComponents(article.savedAt);
        const viewWithDate = {
            ...view,
            date: formatDate(article.savedAt, settings.folderDateFormat),
            ...dateComponents,
        };

        const template = settings.folder || DEFAULT_SETTINGS.folder;
        return Mustache.render(template, viewWithDate);
    } catch (error) {
        logger.error('Folder path rendering error:', error);
        return DEFAULT_SETTINGS.folder;
    }
}

/**
 * 渲染合并模式的文件夹路径
 */
export function renderMergeFolderPath(
    article: Article,
    settings: PluginSettings
): string {
    try {
        const view = articleToView(article, settings);

        // 添加 date 和时间组件变量用于文件夹模板（使用合并模式的日期格式）
        const dateComponents = getDateComponents(article.savedAt);
        const viewWithDate = {
            ...view,
            date: formatDate(article.savedAt, settings.mergeFolderDateFormat),
            ...dateComponents,
        };

        const template = settings.mergeFolderTemplate || settings.mergeFolder || DEFAULT_SETTINGS.mergeFolderTemplate;
        let path = Mustache.render(template, viewWithDate);

        // 规范化路径：
        // 1. 将反斜杠替换为正斜杠（Windows兼容）
        // 2. 移除重复的斜杠
        // 3. 移除开头和结尾的斜杠
        path = path
            .replace(/\\/g, '/')    // Windows路径兼容
            .replace(/\/+/g, '/')   // 移除重复斜杠
            .replace(/^\//, '')     // 移除开头斜杠
            .replace(/\/$/, '');    // 移除结尾斜杠

        return path;
    } catch (error) {
        logger.error('Merge folder path rendering error:', error);
        return DEFAULT_SETTINGS.mergeFolderTemplate;
    }
}

/**
 * 渲染单文件模式的文件名
 */
export function renderSingleFilename(
    date: string,
    settings: PluginSettings
): string {
    try {
        const formattedDate = formatDate(date, settings.singleFileDateFormat);
        const dateComponents = getDateComponents(date);
        const template = settings.singleFileName || DEFAULT_SETTINGS.singleFileName;
        let filename = Mustache.render(template, {
            date: formattedDate,
            ...dateComponents,
        });

        // 确保文件名不包含路径分隔符或其他不合法字符
        // 1. 移除路径分隔符
        // 2. 移除 .md 扩展名（如果有的话，后面会统一添加）
        filename = filename
            .replace(/[\/\\]/g, '_')  // 路径分隔符替换为下划线
            .replace(/\.md$/i, '');    // 移除可能存在的 .md 扩展名

        return filename;
    } catch (error) {
        logger.error('Single filename rendering error:', error);
        return DEFAULT_SETTINGS.singleFileName;
    }
}

/**
 * 渲染前言（Front Matter）
 */
export function renderFrontMatter(
    article: Article,
    settings: PluginSettings
): string {
    if (!settings.frontMatterTemplate && settings.frontMatterVariables.length === 0) {
        return '';
    }

    try {
        const view = articleToView(article, settings);

        if (settings.frontMatterTemplate) {
            // 使用自定义模板
            return Mustache.render(settings.frontMatterTemplate, view);
        } else {
            // 使用变量列表生成 YAML
            const frontMatter: Record<string, any> = {};
            settings.frontMatterVariables.forEach(varName => {
                const value = (view as any)[varName];
                if (value !== undefined) {
                    frontMatter[varName] = value;
                }
            });

            // 简单的 YAML 序列化
            const yaml = Object.entries(frontMatter)
                .map(([key, value]) => {
                    if (Array.isArray(value)) {
                        return `${key}: [${value.join(', ')}]`;
                    } else if (typeof value === 'string' && value.includes('\n')) {
                        return `${key}: |\n  ${value.replace(/\n/g, '\n  ')}`;
                    } else {
                        return `${key}: ${value}`;
                    }
                })
                .join('\n');

            return `---\n${yaml}\n---\n\n`;
        }
    } catch (error) {
        logger.error('Front matter rendering error:', error);
        return '';
    }
}

/**
 * 前置模板解析（检查模板是否需要获取文章内容）
 */
export function templateNeedsContent(template: string): boolean {
    // 检查模板是否包含 content、highlights 等需要完整内容的变量
    return (
        template.includes('{{{content}}}') ||
        template.includes('{{content}}') ||
        template.includes('{{{highlights}}}') ||
        template.includes('{{highlights}}')
    );
}

/**
 * 弱化聊天记录中的时间戳显示
 * 将 **yyyy/MM/dd HH:mm:ss** 格式的时间戳转为灰色小字体
 */
export function processContentTimestamps(content: string): string {
    // 匹配格式：**2025/01/15 10:30:00**
    // 使用斜体格式替代粗体，视觉上弱化时间戳
    return content.replace(
        /\*\*(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})\*\*/g,
        '*$1*'
    );
}

/**
 * 处理内容中的图片URL
 * 如果启用了图床代理，将图片URL替换为代理URL
 */
export function processImageUrls(content: string, settings: PluginSettings): string {
    if (settings.imageMode !== ImageMode.PROXY) {
        return content;
    }

    // 匹配 Markdown 图片语法: ![alt](url)
    const markdownImageRegex = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;

    content = content.replace(markdownImageRegex, (match, alt, url) => {
        // 避免重复代理
        if (url.startsWith(IMAGE_PROXY_URL)) {
            return match;
        }
        const proxyUrl = IMAGE_PROXY_URL + encodeURIComponent(url);
        return `![${alt}](${proxyUrl})`;
    });

    // 匹配 HTML img 标签: <img src="url">
    const htmlImageRegex = /<img([^>]*)\ssrc=["'](https?:\/\/[^"']+)["']([^>]*)>/gi;

    content = content.replace(htmlImageRegex, (match, before, url, after) => {
        if (url.startsWith(IMAGE_PROXY_URL)) {
            return match;
        }
        const proxyUrl = IMAGE_PROXY_URL + encodeURIComponent(url);
        return `<img${before} src="${proxyUrl}"${after}>`;
    });

    return content;
}

/**
 * 渲染企微消息简洁内容（用于合并模式）
 * 与 renderWeChatMessage 不同，这个函数专门用于合并文件中的追加内容
 * 使用简洁样式，不包含 Front Matter，只渲染核心内容
 */
export function renderWeChatMessageSimple(
    article: Article,
    settings: PluginSettings
): string {
    try {
        const dateSaved = formatDate(article.savedAt, settings.dateSavedFormat);

        // 处理内容中的时间戳（弱化显示）
        const processedContent = processContentTimestamps(article.content || '');

        const articleView = {
            id: article.id,
            title: article.title,
            content: processedContent,
            dateSaved,
        };

        // 使用用户自定义的合并消息模板，如果没有则使用企微消息模板
        const template = settings.mergeMessageTemplate || settings.wechatMessageTemplate || '---\n## 📅 {{{dateSaved}}}\n{{{content}}}';
        let content = Mustache.render(template, articleView);

        // 处理图片URL
        content = processImageUrls(content, settings);

        return content;
    } catch (error) {
        logger.error('WeChat message simple rendering error:', error);
        return `## 📅 ${formatDate(article.savedAt, settings.dateSavedFormat)}\n${article.content}`;
    }
}
