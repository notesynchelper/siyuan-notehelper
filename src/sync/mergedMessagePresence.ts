/**
 * 合并消息「是否还在文档里」的判定。
 *
 * 背景：合并模式把「这篇已经并进来了」记在文档的 `custom-merged-ids` 属性里，但这个列表
 * **从不与文档正文对账**。用户在合并文档里删掉某一条消息后，属性里的 id 还在，于是插件
 * 永远认为它已同步 —— 即便「重置同步时间」后全量重拉（实测 53 篇全 skip），那条消息也
 * 再也回不来了。
 *
 * 对账靠「锚点」：追加消息时把它正文里那段时间戳原样存进 `custom-merged-anchors`
 * （id -> 锚点文本），之后拿存下来的那段文本去正文里找。
 *
 * ⚠️ 锚点必须**存下来**，不能每次按当前 `dateSavedFormat` 重新渲染：用户一旦改了时间格式，
 * 重新渲染出的锚点跟历史正文对不上，所有还在的历史消息都会被判成「已删除」→ 全部重新追加，
 * 那就是一场比原 bug 更糟的批量重复。存下来的锚点是「当初真的写进正文的那串字」，与展示
 * 设置解耦。
 *
 * 判定**故意偏保守**，凡是拿不准一律当作「还在」（跳过），宁可某次恢复不了也绝不制造重复：
 *  - 正文读取失败（null）→ 当作还在；
 *  - 该 id 没有存过锚点（本次修复之前写入的老文档）→ 当作还在；
 *  - 锚点在同一文档里不唯一（同一秒两条消息、或用户把格式改成了只到日期）→ 当作还在，
 *    因为分不清删的是哪一条。
 *
 * 注意「正文为空串」**不是**读取失败：用户可能把整篇合并文档清空了，那种情况必须能恢复，
 * 所以空正文要正常参与对账。读取失败由 null 表达。
 */

/** 文档级别存下来的 id -> 锚点文本映射。 */
export type MergedAnchors = Record<string, string>;

/**
 * 这个锚点在本文档里是否唯一。不唯一就没法判断被删的是哪一条，只能放弃对账。
 */
export function isAnchorUnique(anchors: MergedAnchors, articleId: string): boolean {
    const anchor = anchors[articleId];
    if (!anchor) return false;
    let seen = 0;
    for (const value of Object.values(anchors)) {
        if (value === anchor && ++seen > 1) return false;
    }
    return true;
}

/**
 * 已登记的某条合并消息，是否**确实**还在文档正文里。
 *
 * @param documentContent 正文；`null` 表示读取失败（保守当作还在）
 * @param anchors         该文档存下来的 id -> 锚点
 * @returns true = 还在 / 无法判定；false = 确认已被删除（可以重新追加）
 */
export function isMergedMessagePresent(
    documentContent: string | null,
    anchors: MergedAnchors,
    articleId: string
): boolean {
    if (documentContent === null) return true;          // 读不到 → 不对账
    if (!isAnchorUnique(anchors, articleId)) return true; // 没存过 / 不唯一 → 不对账
    return documentContent.includes(anchors[articleId]);
}

/**
 * 汇总判定：这篇合并消息本轮该不该跳过。
 *
 * @returns 'skip'      —— 已合并且正文里还在（或无法判定）
 * @returns 'reappend'  —— 已登记但正文里没了（用户删的），重新追加
 * @returns 'append'    —— 从没合并过，正常追加
 */
export function decideMergeAction(
    mergedIds: readonly string[],
    articleId: string,
    documentContent: string | null,
    anchors: MergedAnchors
): 'skip' | 'reappend' | 'append' {
    if (!mergedIds.includes(articleId)) return 'append';
    return isMergedMessagePresent(documentContent, anchors, articleId) ? 'skip' : 'reappend';
}
