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
    second: string;
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
            second: dt.toFormat('ss'),
            weekday: WEEKDAY_MAP[dt.weekday] || '',
            quarter: `Q${dt.quarter}`,
        };
    } catch (error) {
        logger.error('Date components extraction error:', error);
        return {
            year: '', month: '', day: '', hour: '', minute: '', second: '', weekday: '', quarter: ''
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

        // 把企微消息里的裸 URL（文本形式链接）解析为可点击的 markdown 超链接
        content = linkifyUrls(content);

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
        filename = filename.replace(/[<>"\\/?*]/g, '-');

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
 * 把内容里的"裸 URL"（文本形式的链接）解析为 markdown 超链接 [url](url)，
 * 这样落到思源后是可点击的链接块，而不是纯文本。
 *
 * 已经是链接/图片/HTML 标签属性/代码区里的 URL 一律跳过，避免二次包裹或破坏代码示例：
 * - markdown 链接 [text](url) / 图片 ![alt](url)
 * - HTML 标签内（<a href="...">、<img src="..."> 等）
 * - 围栏代码块 / 行内 code（复用 findCodeRanges）
 */
export function linkifyUrls(content: string): string {
    if (!content) return content;

    // 1) 收集"受保护区"——这些范围里的 URL 不再处理
    const protectedRanges: { start: number; end: number }[] = [];

    // 代码区（围栏 ``` / ~~~ + 行内 `code`）
    for (const r of findCodeRanges(content)) protectedRanges.push(r);

    // markdown 链接 / 图片：[text](url) 或 ![alt](url)（含可选 "title"）
    const mdLinkRe = /!?\[[^\]]*\]\([^)]*\)/g;
    let lm: RegExpExecArray | null;
    while ((lm = mdLinkRe.exec(content)) !== null) {
        protectedRanges.push({ start: lm.index, end: lm.index + lm[0].length });
    }

    // 整个 <a ...>...</a>：保护链接文本里的可见 URL（已经是可点击链接，别再包一层）
    const anchorRe = /<a\b[^>]*>[\s\S]*?<\/a>/gi;
    while ((lm = anchorRe.exec(content)) !== null) {
        protectedRanges.push({ start: lm.index, end: lm.index + lm[0].length });
    }

    // 整个 <table>...</table>：后续 splitContentByTables 会把表格整体当 HTML 块落库，
    // 那里不解析 markdown——若在此把表格里的裸 URL 包成 [url](url)，用户看到的是字面量。
    const tableRe = /<table\b[^>]*>[\s\S]*?<\/table\s*>/gi;
    while ((lm = tableRe.exec(content)) !== null) {
        protectedRanges.push({ start: lm.index, end: lm.index + lm[0].length });
    }

    // 其余 HTML 标签：<...>（覆盖 <img src> 等属性里的 URL）
    const tagRe = /<[^>]+>/g;
    while ((lm = tagRe.exec(content)) !== null) {
        protectedRanges.push({ start: lm.index, end: lm.index + lm[0].length });
    }

    const isProtected = (start: number, end: number) =>
        protectedRanges.some((r) => start < r.end && end > r.start);

    // 2) 扫描裸 URL，落在受保护区外的包成 markdown 链接
    // 仅允许 URL 合法的 ASCII 字符（排除方括号/引号/尖括号/空白），因此遇到 CJK、
    // 空格等天然停下，不会把后续中文吞进链接。
    // 注意：不收 `*`，否则 **https://x** 这种粗体里的 URL 会把收尾的 ** 吞进链接。
    // 收 `()` 以支持 Wikipedia 这类含括号的 URL，末尾不配对的 `)` 再单独剥掉。
    const urlRe = /https?:\/\/[A-Za-z0-9\-._~:/?#@!$&+,;=%()]+/g;
    let result = '';
    let lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = urlRe.exec(content)) !== null) {
        let url = m[0];
        const start = m.index;
        // 去掉 URL 末尾残留的 ASCII 标点（句号/逗号/分号等不应算进链接）
        const trailing = url.match(/[.,;:!?]+$/);
        if (trailing) url = url.slice(0, url.length - trailing[0].length);
        // 剥掉末尾不配对的右括号（如 "(见 https://x)" 里收尾的 `)`）；
        // 括号配对的（Wikipedia 式）则保留，[url](url) 的 markdown 仍合法。
        url = trimUnbalancedTrailingParens(url);
        if (url.length === 0) continue;

        const end = start + url.length;
        if (isProtected(start, end)) continue;

        result += content.slice(lastIndex, start) + `[${url}](${url})`;
        // 末尾被剥掉的标点/括号留给下一段 slice 补回（lastIndex 指向 URL 真实结尾）
        lastIndex = end;
    }
    result += content.slice(lastIndex);

    return result;
}

/**
 * 剥掉 URL 末尾"不配对"的右括号。
 * CommonMark 的 autolink 同款规则：括号配对时全保留（Wikipedia Foo_(bar)），
 * 末尾 `)` 多于 `(` 时逐个剥掉，直到配平——这样 "(见 https://x)" 的收尾 `)` 不会被吞。
 */
function trimUnbalancedTrailingParens(url: string): string {
    while (url.endsWith(')')) {
        const opens = (url.match(/\(/g) || []).length;
        const closes = (url.match(/\)/g) || []).length;
        if (closes <= opens) break;
        url = url.slice(0, -1);
    }
    return url;
}

/**
 * 内容片段类型：markdown 文本或 HTML 表格
 */
export interface ContentSegment {
    type: 'markdown' | 'html-table';
    content: string;
}

/**
 * 找出内容里的"代码区"范围（围栏代码块 ``` / ~~~ 以及行内 code），
 * 落在这些范围里的 <table> 是代码示例、不是真表格，拆分时必须忽略。
 */
function findCodeRanges(content: string): { start: number; end: number }[] {
    const ranges: { start: number; end: number }[] = [];

    // 1) 围栏代码块：``` 或 ~~~（>=3 个），按行扫描，闭合需同字符且长度 >= 开栏
    const fenceRe = /^([ \t]*)(`{3,}|~{3,})([^\n]*)$/gm;
    const fences: { index: number; char: string; len: number; info: string; lineEnd: number }[] = [];
    let fm: RegExpExecArray | null;
    while ((fm = fenceRe.exec(content)) !== null) {
        fences.push({ index: fm.index, char: fm[2][0], len: fm[2].length, info: fm[3].trim(), lineEnd: fm.index + fm[0].length });
    }
    let i = 0;
    while (i < fences.length) {
        const open = fences[i];
        let closeIdx = -1;
        for (let j = i + 1; j < fences.length; j++) {
            const f = fences[j];
            if (f.char === open.char && f.len >= open.len && f.info === '') { closeIdx = j; break; }
        }
        if (closeIdx >= 0) {
            ranges.push({ start: open.index, end: fences[closeIdx].lineEnd });
            i = closeIdx + 1;
        } else {
            // 未闭合围栏：把剩余内容都当作代码
            ranges.push({ start: open.index, end: content.length });
            break;
        }
    }

    // 2) 行内 code：反引号 run（同长闭合），只在围栏之外识别
    const inFence = (idx: number) => ranges.some((r) => idx >= r.start && idx < r.end);
    const inlineRe = /(`+)(?:(?!\1)[\s\S])*?\1/g;
    let im: RegExpExecArray | null;
    while ((im = inlineRe.exec(content)) !== null) {
        if (!inFence(im.index)) ranges.push({ start: im.index, end: im.index + im[0].length });
    }

    return ranges;
}

/**
 * 把 <table> 范围向外扩展，吃掉直接包裹它的块级元素（div / figure / …）。
 * 处理 <div class="table-wrap"><table>…</table></div> 这类带包裹的表格——
 * 否则只抽内层 table 会把包裹标签留成孤儿 markdown 块、丢失容器样式。
 */
function expandTableToWrapper(content: string, start: number, end: number): { start: number; end: number } {
    const WRAPPERS = ['div', 'figure', 'center', 'section', 'span', 'p', 'article', 'aside'];
    let expanded = true;
    while (expanded) {
        expanded = false;
        const before = content.slice(0, start);
        const after = content.slice(end);
        // before 末尾紧贴的开标签（标签与 table 之间只允许空白）
        const openM = before.match(/<([a-zA-Z][\w-]*)\b[^>]*>\s*$/);
        if (!openM || openM.index === undefined) break;
        const tag = openM[1].toLowerCase();
        if (!WRAPPERS.includes(tag)) break;
        // after 开头紧贴的对应闭标签
        const closeM = after.match(new RegExp('^\\s*</' + tag + '\\s*>', 'i'));
        if (!closeM) break;
        start = openM.index;
        end = end + closeM[0].length;
        expanded = true;
    }
    return { start, end };
}

/**
 * 将内容拆分为 markdown 片段和 HTML 表格片段
 * 用于后续分别处理：markdown 通过 createDocWithMd 创建，表格通过 appendBlock DOM 创建为 HTML 块
 */
export function splitContentByTables(content: string): ContentSegment[] {
    logger.info(`[splitContentByTables] 输入内容长度: ${content.length}`);
    logger.info(`[splitContentByTables] 是否包含 <table: ${content.includes('<table')}`);

    // 代码区（围栏/行内 code）里的 <table> 是代码示例，不当作真表格
    const codeRanges = findCodeRanges(content);
    const inCode = (idx: number) => codeRanges.some((r) => idx >= r.start && idx < r.end);

    const openRegex = /<table[\s>]/gi;
    const closeRegex = /<\/table\s*>/gi;

    interface TagPos { index: number; isOpen: boolean; endOffset: number; }
    const tags: TagPos[] = [];

    let match: RegExpExecArray | null;
    while ((match = openRegex.exec(content)) !== null) {
        if (inCode(match.index)) continue;
        tags.push({ index: match.index, isOpen: true, endOffset: 0 });
        logger.info(`[splitContentByTables] 找到 <table 标签, 位置: ${match.index}`);
    }
    while ((match = closeRegex.exec(content)) !== null) {
        if (inCode(match.index)) continue;
        tags.push({ index: match.index, isOpen: false, endOffset: match.index + match[0].length });
        logger.info(`[splitContentByTables] 找到 </table> 标签, 位置: ${match.index}`);
    }

    if (tags.length === 0) {
        logger.info(`[splitContentByTables] 未找到任何 table 标签，返回整体 markdown`);
        return [{ type: 'markdown', content }];
    }

    tags.sort((a, b) => a.index - b.index);

    // 匹配顶层 table 的范围（处理嵌套）
    const ranges: { start: number; end: number }[] = [];
    let depth = 0;
    let startIdx = -1;

    for (const tag of tags) {
        if (tag.isOpen) {
            if (depth === 0) startIdx = tag.index;
            depth++;
        } else {
            depth--;
            if (depth === 0 && startIdx >= 0) {
                ranges.push({ start: startIdx, end: tag.endOffset });
                startIdx = -1;
            }
        }
    }

    logger.info(`[splitContentByTables] 找到 ${ranges.length} 个顶层 table 范围`);

    if (ranges.length === 0) {
        logger.info(`[splitContentByTables] 标签未配对，返回整体 markdown`);
        return [{ type: 'markdown', content }];
    }

    // 把每个 table 范围向外扩展，吃掉直接包裹它的块级元素（div/figure/…）
    const expandedRanges = ranges
        .map((r) => expandTableToWrapper(content, r.start, r.end))
        .sort((a, b) => a.start - b.start);

    const segments: ContentSegment[] = [];
    let lastEnd = 0;

    for (const range of expandedRanges) {
        if (range.start < lastEnd) continue; // 防御：扩展后若与上一片段重叠则跳过
        const before = content.substring(lastEnd, range.start).trim();
        if (before.length > 0) {
            segments.push({ type: 'markdown', content: before });
        }
        const tableContent = content.substring(range.start, range.end);
        segments.push({ type: 'html-table', content: tableContent });
        logger.info(`[splitContentByTables] table 片段长度: ${tableContent.length}, 前100字符: ${tableContent.substring(0, 100)}`);
        lastEnd = range.end;
    }

    const remaining = content.substring(lastEnd).trim();
    if (remaining.length > 0) {
        segments.push({ type: 'markdown', content: remaining });
    }

    logger.info(`[splitContentByTables] 最终拆分为 ${segments.length} 个片段: ${segments.map(s => `${s.type}(${s.content.length}字符)`).join(', ')}`);
    return segments;
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

        // 把合并消息里的裸 URL（文本形式链接）解析为可点击的 markdown 超链接
        content = linkifyUrls(content);

        return content;
    } catch (error) {
        logger.error('WeChat message simple rendering error:', error);
        return `## 📅 ${formatDate(article.savedAt, settings.dateSavedFormat)}\n${article.content}`;
    }
}
