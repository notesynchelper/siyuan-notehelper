/**
 * 合并消息裸链接 → 超链接 测试
 *
 * 需求：合并消息（renderWeChatMessageSimple）内容里若出现裸 URL（文本形式的链接），
 * 应解析为 markdown 超链接 [url](url)，落到思源后是可点击的 <a>（NodeTextMark a），
 * 而不是纯文本（NodeText）。
 *
 * TDD：本测试先红（当前裸 URL 原样保留为文本），实现 linkifyUrls 接入后转绿。
 */

import { renderWeChatMessageSimple } from '../src/settings/template';
import { DEFAULT_SETTINGS, PluginSettings } from '../src/settings/index';
import { Article } from '../src/utils/types';

function createMockArticle(overrides: Partial<Article> = {}): Article {
    return {
        id: 'msg-001',
        title: '同步助手_20250615_abc_文本',
        author: '',
        content: '这是合并消息内容',
        url: '',
        savedAt: '2025-06-15T14:30:45+08:00',
        ...overrides,
    };
}

function createSettings(overrides: Partial<PluginSettings> = {}): PluginSettings {
    // 用最简模板，避免被默认模板的其它字段干扰，只校验 content 区域
    return { ...DEFAULT_SETTINGS, mergeMessageTemplate: '{{{content}}}', ...overrides };
}

describe('合并消息裸链接 → 超链接 (renderWeChatMessageSimple)', () => {
    test('单个裸 URL 应被包成 markdown 超链接', () => {
        const url = 'https://mp.weixin.qq.com/s/AbCdEf12345';
        const article = createMockArticle({ content: url });
        const result = renderWeChatMessageSimple(article, createSettings());

        expect(result).toContain(`[${url}](${url})`);
    });

    test('裸 URL 紧贴中文文本时也应被识别', () => {
        const url = 'https://mp.weixin.qq.com/s/AbCdEf12345';
        const article = createMockArticle({ content: `详情见${url}点击查看` });
        const result = renderWeChatMessageSimple(article, createSettings());

        expect(result).toContain(`[${url}](${url})`);
        // 前后中文文本保留
        expect(result).toContain('详情见');
        expect(result).toContain('点击查看');
    });

    test('多个裸 URL 都应被处理', () => {
        const u1 = 'https://example.com/a';
        const u2 = 'http://test.org/b?x=1&y=2';
        const article = createMockArticle({ content: `第一条 ${u1} 第二条 ${u2}` });
        const result = renderWeChatMessageSimple(article, createSettings());

        expect(result).toContain(`[${u1}](${u1})`);
        expect(result).toContain(`[${u2}](${u2})`);
    });

    test('已是 markdown 超链接的 URL 不应被二次包裹', () => {
        const url = 'https://example.com/page';
        const article = createMockArticle({ content: `[原文链接](${url})` });
        const result = renderWeChatMessageSimple(article, createSettings());

        expect(result).toContain(`[原文链接](${url})`);
        // 不应出现 [url](url) 这种二次包裹
        expect(result).not.toContain(`[${url}](${url})`);
    });

    test('markdown 图片的 URL 不应被当成超链接处理', () => {
        const url = 'https://example.com/pic.png';
        const article = createMockArticle({ content: `![图片](${url})` });
        const result = renderWeChatMessageSimple(article, createSettings());

        expect(result).toContain(`![图片](${url})`);
        expect(result).not.toContain(`[${url}](${url})`);
    });

    test('裸 URL 末尾的中文标点不应被吞进链接', () => {
        const url = 'https://example.com/article';
        const article = createMockArticle({ content: `点这里：${url}。` });
        const result = renderWeChatMessageSimple(article, createSettings());

        expect(result).toContain(`[${url}](${url})`);
        // 句号留在链接外
        expect(result).toContain(`(${url})。`);
    });

    test('已是 HTML <a> 链接里的 URL 不应被二次处理（codex P2）', () => {
        const url = 'https://example.com/x';
        const article = createMockArticle({ content: `<a href="${url}">${url}</a>` });
        const result = renderWeChatMessageSimple(article, createSettings());

        // 锚文本里的可见 URL 保持原样，不被包成 [url](url)
        expect(result).toContain(`<a href="${url}">${url}</a>`);
        expect(result).not.toContain(`[${url}](${url})`);
    });

    test('粗体包裹的 URL 不应把收尾的 ** 吞进链接（codex P2）', () => {
        const url = 'https://example.com';
        const article = createMockArticle({ content: `**${url}**` });
        const result = renderWeChatMessageSimple(article, createSettings());

        // 粗体标记保留在链接外，URL 干净
        expect(result).toContain(`**[${url}](${url})**`);
        expect(result).not.toContain('**]');
        expect(result).not.toContain('**)');
    });

    test('HTML 表格单元格里的 URL 不应被包成 markdown（codex P2，表格走 HTML 块不解析 md）', () => {
        const url = 'https://example.com/cell';
        const article = createMockArticle({
            content: `<table><tr><td>${url}</td></tr></table>`,
        });
        const result = renderWeChatMessageSimple(article, createSettings());

        // 表格内容原样保留，URL 不被包裹（否则 HTML 块里会显示字面量 [url](url)）
        expect(result).toContain(`<td>${url}</td>`);
        expect(result).not.toContain(`[${url}](${url})`);
    });

    test('含配对括号的 URL（Wikipedia 式）应完整链接', () => {
        const url = 'https://en.wikipedia.org/wiki/Function_(mathematics)';
        const article = createMockArticle({ content: `见 ${url} 了解` });
        const result = renderWeChatMessageSimple(article, createSettings());

        // 整个含括号的 URL 都进链接，[url](url) 中括号配对、markdown 合法
        expect(result).toContain(`[${url}](${url})`);
    });

    test('URL 被英文括号包裹时收尾的 ) 不进链接', () => {
        const url = 'https://example.com/path';
        const article = createMockArticle({ content: `(见 ${url})` });
        const result = renderWeChatMessageSimple(article, createSettings());

        // URL 干净（不含收尾的包裹括号），整体输出为 (见 [url](url))
        expect(result).toContain(`[${url}](${url})`);
        expect(result).toBe(`(见 [${url}](${url}))`);
    });

    test('无链接的纯文本内容保持不变', () => {
        const article = createMockArticle({ content: '今天天气不错，没有任何链接。' });
        const result = renderWeChatMessageSimple(article, createSettings());

        expect(result).toBe('今天天气不错，没有任何链接。');
    });
});
