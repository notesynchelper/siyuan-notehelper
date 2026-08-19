/**
 * 跨分页合并顺序回归测试（问题一）
 *
 * 服务端 search 按 updated_at DESC 分页（最新的在前），而合并写入永远往文档尾部 append。
 * 旧实现只在「本页 15 篇」内排序，于是某天的消息一旦跨页，就会落成「段内升序、段间倒序」
 * 的乱序——实测报障用户 2026-08-17 的 8 条消息跨 3 页，写出来是
 * 18:19 → 22:21 → 15:28:25 → 10:28 → 11:04 → 12:03 → 14:52 → 15:28:20。
 *
 * 修复：processArticleBatch 收到收集器时把合并类文章攒起来，等所有分页拉完再由
 * processMergedArticles 统一分组排序写入。
 */
import { FileHandler } from '../src/sync/fileHandler';
import { DEFAULT_SETTINGS, PluginSettings } from '../src/settings/index';
import { Article } from '../src/utils/types';
import { MergeMode } from '../src/utils/types';

function createSettings(overrides: Partial<PluginSettings> = {}): PluginSettings {
    return JSON.parse(JSON.stringify({
        ...DEFAULT_SETTINGS,
        mergeMode: MergeMode.MESSAGES,
        messageSortOrder: 'ASC',
        template: '{{{content}}}',
        ...overrides,
    }));
}

function msg(hhmmss: string, id: string): Article {
    return {
        id,
        title: '同步助手_20260817_图片_图片',
        author: '',
        content: `消息 ${hhmmss}`,
        url: '',
        savedAt: `2026-08-17T${hhmmss}+08:00`,
    } as Article;
}

/** 记录 mergeArticleToFile 的真实调用顺序；不碰网络。 */
function stubHandler(settings: PluginSettings) {
    const handler = new FileHandler({} as any, settings);
    const order: string[] = [];
    (handler as any).mergeArticleToFile = async (article: Article) => {
        order.push(article.savedAt.slice(11, 19));
        return { docId: 'doc-1', skipped: false };
    };
    (handler as any).createSeparateFile = async () => ({ docId: 'sep', skipped: false });
    return { handler, order };
}

// 报障用户当天的真实分布：8 条消息被 20 多篇公众号文章挤到了 3 页里
const PAGE_1 = [msg('18:19:50', 'm7'), msg('22:21:55', 'm8')];
const PAGE_2 = [msg('15:28:25', 'm6')];
const PAGE_3 = [
    msg('15:28:20', 'm5'), msg('14:52:05', 'm4'), msg('12:03:23', 'm3'),
    msg('11:04:02', 'm2'), msg('10:28:50', 'm1'),
];
const CHRONOLOGICAL = ['10:28:50', '11:04:02', '12:03:23', '14:52:05', '15:28:20', '15:28:25', '18:19:50', '22:21:55'];

describe('合并消息跨分页排序', () => {
    test('旧行为复现：逐页各自排序 → 段内升序、段间倒序（乱序）', async () => {
        const { handler, order } = stubHandler(createSettings());
        // 不传收集器 = 老路径，每页各写各的
        for (const page of [PAGE_1, PAGE_2, PAGE_3]) {
            await handler.processArticleBatch(page, 'nb');
        }
        expect(order).toEqual([
            '18:19:50', '22:21:55',
            '15:28:25',
            '10:28:50', '11:04:02', '12:03:23', '14:52:05', '15:28:20',
        ]);
        expect(order).not.toEqual(CHRONOLOGICAL);
    });

    test('修复后：攒完所有分页再统一写 → 严格按时间升序', async () => {
        const { handler, order } = stubHandler(createSettings());
        const pending: Article[] = [];
        for (const page of [PAGE_1, PAGE_2, PAGE_3]) {
            const r = await handler.processArticleBatch(page, 'nb', pending);
            expect(r.created).toBe(0);   // 推迟了，本页不写
        }
        expect(pending).toHaveLength(8);
        expect(order).toEqual([]);       // 分页阶段一条都没写

        const result = await handler.processMergedArticles(pending, 'nb');
        expect(result.created).toBe(8);
        expect(order).toEqual(CHRONOLOGICAL);
    });

    test('DESC 设置下统一写入也严格倒序', async () => {
        const { handler, order } = stubHandler(createSettings({ messageSortOrder: 'DESC' }));
        const pending: Article[] = [];
        for (const page of [PAGE_1, PAGE_2, PAGE_3]) {
            await handler.processArticleBatch(page, 'nb', pending);
        }
        await handler.processMergedArticles(pending, 'nb');
        expect(order).toEqual([...CHRONOLOGICAL].reverse());
    });

    test('不同日期的消息各自成组，互不串味', async () => {
        const { handler, order } = stubHandler(createSettings());
        const otherDay = {
            ...msg('09:00:00', 'x1'),
            title: '同步助手_20260818_图片_图片',
            savedAt: '2026-08-18T09:00:00+08:00',
        } as Article;
        const pending: Article[] = [];
        await handler.processArticleBatch([PAGE_1[1], otherDay, PAGE_1[0]], 'nb', pending);
        await handler.processMergedArticles(pending, 'nb');
        // 08-17 组内升序；08-18 单独一组
        expect(order).toEqual(['18:19:50', '22:21:55', '09:00:00']);
    });

    test('空集合不炸', async () => {
        const { handler } = stubHandler(createSettings());
        await expect(handler.processMergedArticles([], 'nb')).resolves.toEqual({
            created: 0, skipped: 0, errors: [],
        });
    });
});

/**
 * 正文对账的安全闸（问题一b 修复的反例保护）
 *
 * 默认文章模板 DEFAULT_TEMPLATE 里没有 dateSaved，MergeMode.ALL 下普通文章的正文
 * 根本不含时间戳。若拿时间戳锚点无条件对账，每轮同步都会「找不到锚点 → 判定被删 →
 * 重新追加」，把同一篇文章无限追加 —— 比原 bug 更糟。
 * 所以锚点必须先用「这篇自己的渲染结果里有没有它」自校验。
 */
describe('合并对账锚点自校验', () => {
    const { FileHandler: FH } = require('../src/sync/fileHandler');

    function handlerWith(settings: PluginSettings) {
        return new FH({} as any, settings);
    }

    test('企微消息模板含 dateSaved → 锚点可用', () => {
        const h = handlerWith(createSettings());
        const anchor = (h as any).mergedMessageAnchorIfReliable(msg('10:28:50', 'm1'));
        expect(anchor).toBe('2026-08-17 10:28:50');
    });

    test('MergeMode.ALL 下的普通文章（默认模板无 dateSaved）→ 放弃对账，返回空锚点', () => {
        const h = handlerWith(createSettings({ mergeMode: MergeMode.ALL, template: undefined as any }));
        const article = {
            id: 'a1', title: '一篇公众号文章', author: '', content: '正文',
            url: 'https://example.com/x', savedAt: '2026-08-17T10:00:00+08:00',
        } as Article;
        expect((h as any).mergedMessageAnchorIfReliable(article)).toBe('');
    });

    test('用户把 mergeMessageTemplate 里的 dateSaved 删掉 → 同样放弃对账', () => {
        const h = handlerWith(createSettings({ mergeMessageTemplate: '---\n{{{content}}}' }));
        expect((h as any).mergedMessageAnchorIfReliable(msg('10:28:50', 'm1'))).toBe('');
    });

    test('没存下锚点时 decideMergeAction 等价于老行为（skip，不会重复追加）', () => {
        const { decideMergeAction } = require('../src/sync/mergedMessagePresence');
        // 锚点为空 => recordMergedAnchor 不会写入 => 对账查不到该 id => 保守 skip
        expect(decideMergeAction(['a1'], 'a1', '任何不含时间戳的正文', {})).toBe('skip');
    });
});
