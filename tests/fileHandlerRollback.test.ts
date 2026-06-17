/**
 * createSeparateFile 表格分段失败回滚测试
 *
 * 验证 #3 修复 + 安全回滚：当一篇【含 HTML 表格】的文章在追加片段阶段
 * （appendBlock 返回 code!==0）失败时——
 *   1. 失败必须上抛（不再静默吞掉 → 不会被误标记为已同步）；
 *   2. 本次新建的半成品【独立文档】被回滚删除（removeDocByID），
 *      以便下次同步能干净重试，而不是按路径命中残缺文档后跳过。
 * 合并模式不在此路径、不回滚（文档可能含其它文章内容），不在本测试范围。
 */
import { FileHandler } from '../src/sync/fileHandler';
import { DEFAULT_SETTINGS, PluginSettings } from '../src/settings/index';
import { Article } from '../src/utils/types';

function createSettings(overrides: Partial<PluginSettings> = {}): PluginSettings {
    // template 只渲染正文，避免 DEFAULT_TEMPLATE 的「原文链接」触发附件处理
    return { ...DEFAULT_SETTINGS, template: '{{{content}}}', ...overrides };
}

function createMockArticle(overrides: Partial<Article> = {}): Article {
    return {
        id: 'art-rollback-1',
        title: 'Rollback Test',
        author: 'a',
        content: 'Intro paragraph.\n\n<table><thead><tr><th>City</th></tr></thead><tbody><tr><td>Tokyo</td></tr></tbody></table>\n\nOutro paragraph.',
        url: 'https://example.com/article',
        savedAt: '2026-06-17T10:00:00+08:00',
        ...overrides,
    } as Article;
}

interface RouterCalls { appendBlock: number; appendBlockData: string[]; createDoc: number; removeDocByID: string[]; }

// failMode:
//   'none'     — 所有 appendBlock 成功
//   'markdown' — 仅【markdown 片段】的 appendBlock 失败（data 不含 <table>），
//                html-table 片段成功 —— 专门验证 #3 新增的 markdown 分支上抛，
//                而不是 html-table 分支（appendHtmlBlock 本来就会抛）。
function makeFetchRouter(opts: { failMode: 'none' | 'markdown' }): { fetchMock: jest.Mock; calls: RouterCalls } {
    const calls: RouterCalls = { appendBlock: 0, appendBlockData: [], createDoc: 0, removeDocByID: [] };
    const fetchMock = jest.fn(async (url: string, init?: { body?: string }) => {
        const u = String(url);
        const body = init?.body ? JSON.parse(init.body) : {};
        let resp: { code: number; msg: string; data: unknown };
        if (u.includes('/api/block/appendBlock')) {
            calls.appendBlock++;
            const data: string = body.data || '';
            calls.appendBlockData.push(data);
            const isTable = data.includes('<table');
            const shouldFail = opts.failMode === 'markdown' && !isTable;
            resp = shouldFail
                ? { code: 1, msg: 'forced markdown-segment append failure (test)', data: null }
                : { code: 0, msg: '', data: [{ doOperations: [{ id: 'blk' }] }] };
        } else if (u.includes('/api/filetree/removeDocByID')) {
            calls.removeDocByID.push(body.id);
            resp = { code: 0, msg: '', data: null };
        } else if (u.includes('/api/filetree/createDocWithMd')) {
            calls.createDoc++;
            resp = { code: 0, msg: '', data: 'doc-id-123' };
        } else {
            // getIDsByHPath / query SQL / ensureFolder 等：返回空 → 未命中去重，继续创建
            resp = { code: 0, msg: '', data: [] };
        }
        return { ok: true, json: async () => resp } as unknown as Response;
    });
    return { fetchMock, calls };
}

describe('createSeparateFile — 表格分段失败安全回滚', () => {
    const realFetch = global.fetch;
    afterEach(() => { global.fetch = realFetch; });

    test('markdown 片段追加失败（表格段成功）→ 上抛 + 回滚删除半成品独立文档', async () => {
        const { fetchMock, calls } = makeFetchRouter({ failMode: 'markdown' });
        global.fetch = fetchMock as unknown as typeof fetch;

        const fh = new FileHandler({ saveSettings: async () => {} }, createSettings());
        const article = createMockArticle();

        await expect(
            (fh as unknown as { createSeparateFile(a: Article, n: string): Promise<unknown> })
                .createSeparateFile(article, 'notebook-1')
        ).rejects.toThrow();

        expect(calls.createDoc).toBeGreaterThan(0);          // 文档被创建
        // 关键：表格段（含 <table>）成功，是后面的 markdown 段（Outro）触发上抛——
        // 真正验证 #3 新增的 markdown 分支 throw，而非 html-table 分支。
        expect(calls.appendBlockData.some((d) => d.includes('<table'))).toBe(true);
        expect(calls.appendBlock).toBeGreaterThanOrEqual(2);
        expect(calls.removeDocByID).toContain('doc-id-123'); // 半成品文档被回滚删除
    });

    test('appendBlock 成功 → 不触发回滚删除', async () => {
        const { fetchMock, calls } = makeFetchRouter({ failMode: 'none' });
        global.fetch = fetchMock as unknown as typeof fetch;

        const fh = new FileHandler({ saveSettings: async () => {} }, createSettings());
        const article = createMockArticle({ id: 'art-rollback-2' });

        await (fh as unknown as { createSeparateFile(a: Article, n: string): Promise<unknown> })
            .createSeparateFile(article, 'notebook-1');

        expect(calls.appendBlock).toBeGreaterThan(0);
        expect(calls.removeDocByID).toHaveLength(0);          // 成功路径不删任何文档
    });
});
