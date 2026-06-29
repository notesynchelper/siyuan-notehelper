/**
 * 「启动时同步」跨重载冷却闸。
 *
 * 背景：插件没有任何前台/可见性监听，自动同步的唯一启动触发是 onload 里的
 * `if (syncOnStart) performSync(true)`。但在 SiYuan 手机端（尤其安卓），从后台切回
 * 前台会重载 webview → 重跑 onload → 每次回前台都触发一次同步，等于把「启动时同步」
 * 变成了「每次回前台都同步」。
 *
 * 这里用一个存活于 webview 重载之间的时间戳（localStorage）做冷却：若距上次自动同步
 * 不足 cooldown，就跳过本次 syncOnStart 触发。把「每次回前台都同步」收敛成「最多每
 * cooldown 一次」，频繁切前后台不再反复同步。localStorage 跨重载存活（与 device-id 同
 * 一持久化机制），所以重载后读到的仍是上次的时间戳。
 */

const LAST_AUTOSYNC_KEY = 'notehelper-last-autosync-at';
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000; // 5 分钟

/**
 * 记录「一次自动同步已开始」的时间戳。在每次自动同步（syncOnStart 触发 + 定时同步）
 * 真正开跑时调用，供下次 onload 的 shouldRunSyncOnStart 判冷却。
 */
export function markAutoSyncStarted(now: number = Date.now()): void {
    try {
        window.localStorage.setItem(LAST_AUTOSYNC_KEY, String(now));
    } catch {
        /* localStorage 不可用时忽略——退化为「不冷却」，不影响数据正确性 */
    }
}

/**
 * 是否应在本次 onload 触发「启动时同步」。
 * 距上次自动同步 < cooldown（典型：刚从后台切回前台导致的重载）→ 返回 false 跳过。
 * 读不到时间戳 / localStorage 不可用 → 返回 true（首次启动或无法判定时照常同步）。
 */
export function shouldRunSyncOnStart(
    now: number = Date.now(),
    cooldownMs: number = DEFAULT_COOLDOWN_MS
): boolean {
    try {
        const raw = window.localStorage.getItem(LAST_AUTOSYNC_KEY);
        if (raw) {
            const last = parseInt(raw, 10);
            if (!isNaN(last) && now - last < cooldownMs) {
                return false;
            }
        }
    } catch {
        /* 读取失败时不阻止同步 */
    }
    return true;
}
