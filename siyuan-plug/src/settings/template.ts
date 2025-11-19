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
 * 渲染文件夹路径
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
 * 渲染单文件模式的文件名
 */
export function renderSingleFilename(
    date: string,
    settings: PluginSettings
): string {
    try {
        const formattedDate = formatDate(date, settings.singleFileDateFormat);
        const template = settings.singleFileName || '同步助手_{{{date}}}';
        return Mustache.render(template, { date: formattedDate });
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
