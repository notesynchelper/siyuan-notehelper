import {
    isAnchorUnique,
    isMergedMessagePresent,
    decideMergeAction,
    MergedAnchors,
} from '../src/sync/mergedMessagePresence';

const DOC = [
    '## 📅 2026-08-17 10:28:50',
    '早上好',
    '---',
    '## 📅 2026-08-17 18:19:50',
    '下午的消息',
].join('\n');

const ANCHORS: MergedAnchors = {
    a: '2026-08-17 10:28:50',
    b: '2026-08-17 18:19:50',
    gone: '2026-08-17 11:04:02',
};

describe('isAnchorUnique', () => {
    test('锚点唯一', () => {
        expect(isAnchorUnique(ANCHORS, 'a')).toBe(true);
    });
    test('没存过锚点 → 不可用', () => {
        expect(isAnchorUnique(ANCHORS, 'nope')).toBe(false);
    });
    test('两条消息锚点相同（同一秒 / 只到日期）→ 分不清删了哪条，不可用', () => {
        const dup: MergedAnchors = { x: '2026-08-17', y: '2026-08-17' };
        expect(isAnchorUnique(dup, 'x')).toBe(false);
        expect(isAnchorUnique(dup, 'y')).toBe(false);
    });
});

describe('isMergedMessagePresent', () => {
    test('正文里有锚点 → 还在', () => {
        expect(isMergedMessagePresent(DOC, ANCHORS, 'a')).toBe(true);
    });
    test('正文里没有锚点 → 已被删除', () => {
        expect(isMergedMessagePresent(DOC, ANCHORS, 'gone')).toBe(false);
    });
    test('读取失败(null) → 保守视为还在', () => {
        expect(isMergedMessagePresent(null, ANCHORS, 'gone')).toBe(true);
    });
    test('正文是空串 → 是「被清空」而不是「读不到」，必须判定为已删除', () => {
        // codex 复检 #2：空正文一度被当成读取失败，导致清空整篇文档后永远恢复不了
        expect(isMergedMessagePresent('', ANCHORS, 'a')).toBe(false);
    });
    test('没存过锚点（老文档）→ 不对账，视为还在', () => {
        expect(isMergedMessagePresent(DOC, ANCHORS, 'legacy')).toBe(true);
    });
});

describe('decideMergeAction', () => {
    const ids = ['a', 'b', 'gone', 'legacy'];

    test('没合并过 → 追加', () => {
        expect(decideMergeAction(ids, 'new', DOC, ANCHORS)).toBe('append');
    });
    test('合并过且正文里还在 → 跳过', () => {
        expect(decideMergeAction(ids, 'a', DOC, ANCHORS)).toBe('skip');
    });
    test('合并过但正文里没了（用户删的）→ 重新追加', () => {
        expect(decideMergeAction(ids, 'gone', DOC, ANCHORS)).toBe('reappend');
    });
    test('老文档没存锚点 → 退回老行为 skip，绝不误判成删除', () => {
        expect(decideMergeAction(ids, 'legacy', DOC, ANCHORS)).toBe('skip');
    });
    test('读取失败 → skip', () => {
        expect(decideMergeAction(ids, 'gone', null, ANCHORS)).toBe('skip');
    });
    test('整篇被清空 → 全部重新追加（恢复得了）', () => {
        expect(decideMergeAction(ids, 'a', '', ANCHORS)).toBe('reappend');
        expect(decideMergeAction(ids, 'b', '', ANCHORS)).toBe('reappend');
    });

    test('回归：用户改了 dateSavedFormat 也不会批量重复', () => {
        // 锚点是【当初写进正文的那串字】，不随 dateSavedFormat 重新渲染。
        // 即使用户后来把格式改成别的，存下来的锚点仍能在历史正文里找到 → 继续 skip。
        const storedAnchors: MergedAnchors = { a: '2026-08-17 10:28:50' };
        expect(decideMergeAction(['a'], 'a', DOC, storedAnchors)).toBe('skip');
    });

    test('回归：删掉合并文档里的单条消息后能恢复', () => {
        const afterDelete = DOC.replace('## 📅 2026-08-17 18:19:50\n下午的消息', '');
        expect(decideMergeAction(['b'], 'b', afterDelete, ANCHORS)).toBe('reappend');
        expect(decideMergeAction(['a'], 'a', afterDelete, ANCHORS)).toBe('skip');
    });
});
