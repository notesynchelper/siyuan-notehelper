/**
 * 模板引擎
 */

import Mustache from 'mustache';
import { logger } from '../utils/logger';
import { Article, Highlight } from '../utils/types';
import { formatDate, isWeChatMessage } from '../utils/util';
import { PluginSettings } from './index';

// 默认模板
export const DEFAULT_TEMPLATE = `# {{{title}}}
#笔记同步助手

## 来源
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
        return Mustache.render(template, view);
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
        return Mustache.render(template, view);
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
        const template = settings.filename || '{{{title}}}';
        let filename = Mustache.render(template, view);

        // 清理文件名中的非法字符
        filename = filename.replace(/[<>:"/\\|?*]/g, '-');

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

        // 添加 date 变量用于文件夹模板
        const viewWithDate = {
            ...view,
            date: formatDate(article.savedAt, settings.folderDateFormat),
        };

        const template = settings.folder || '笔记同步助手';
        return Mustache.render(template, viewWithDate);
    } catch (error) {
        logger.error('Folder path rendering error:', error);
        return '笔记同步助手';
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

        // 添加 date 变量用于文件夹模板（使用合并模式的日期格式）
        const viewWithDate = {
            ...view,
            date: formatDate(article.savedAt, settings.mergeFolderDateFormat),
        };

        const template = settings.mergeFolder || '笔记同步助手/企微消息/{{{date}}}';
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
        return '笔记同步助手/企微消息';
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
        const template = settings.singleFileName || '同步助手_{{{date}}}';
        let filename = Mustache.render(template, { date: formattedDate });

        // 确保文件名不包含路径分隔符或其他不合法字符
        // 1. 移除路径分隔符
        // 2. 移除 .md 扩展名（如果有的话，后面会统一添加）
        filename = filename
            .replace(/[\/\\]/g, '_')  // 路径分隔符替换为下划线
            .replace(/\.md$/i, '');    // 移除可能存在的 .md 扩展名

        return filename;
    } catch (error) {
        logger.error('Single filename rendering error:', error);
        return '同步助手';
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
    return content.replace(
        /\*\*(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})\*\*/g,
        '<small style="color: #999;">$1</small>'
    );
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

        // 使用企微消息模板
        const template = settings.wechatMessageTemplate || '---\n## 📅 {{{dateSaved}}}\n{{{content}}}';
        return Mustache.render(template, articleView);
    } catch (error) {
        logger.error('WeChat message simple rendering error:', error);
        return `## 📅 ${formatDate(article.savedAt, settings.dateSavedFormat)}\n${article.content}`;
    }
}
