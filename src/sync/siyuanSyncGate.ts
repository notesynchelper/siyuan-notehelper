/**
 * 「等思源自己的同步先跑完」启动闸。
 *
 * 背景：插件的「启动时同步」原本只是 onload 里一个固定 10 秒的 setTimeout。10 秒挡不住
 * 思源的云同步——那是网络操作，常常远超 10 秒。设备 A 已经同步过文章 Y 并写出了 Y.sy，
 * 设备 B 开机时思源同步还没把 Y.sy 拉下来，插件就开跑了：插件所有去重层查的都是**本地**
 * 有没有这篇，文件压根还没到，于是插件自己造一份；随后思源同步把 A 的那份也送达 →
 * 同一篇文章两个文档。实测 A/B：不等 = 2 份，等 = 1 份。
 *
 * 注意这里等的**不是索引**——2072 篇的库重启后 t+10s 索引早已完整，索引不是瓶颈；
 * 等的是「文件有没有被下载下来」。
 *
 * 思源 3.6.5 / 3.8.0 都会向每个插件的 eventBus 派发 sync-start / sync-end / sync-fail
 * （app/src/dialog/processSystem.ts），这里就靠它。
 *
 * 判定规则（既不能等不到、也不能白等）：
 *  - 思源没开云同步 → 立刻放行，一秒都不等；
 *  - 静默期内没见到任何 sync-start/sync-end → 认为本次启动没有同步要等，放行
 *    （覆盖「插件挂监听时，启动同步早就跑完了」这种拿不到事件的情况）；
 *  - 见到 sync-start → 一直等到 sync-end / sync-fail；
 *  - 无论如何不超过 maxWait → 超时也放行，绝不能因为等同步而永远不同步。
 */

import { logger } from '../utils/logger';

export type SyncGateOutcome =
    /** 思源没开云同步，无需等待 */
    | 'sync-disabled'
    /** 等到了 sync-end / sync-fail */
    | 'sync-finished'
    /** 静默期内没有任何同步动静，认为不需要等 */
    | 'no-sync-observed'
    /** 等太久了，放行兜底 */
    | 'timeout'
    /** 插件卸载/重载，等待被主动取消（调用方应就此放弃本次启动同步） */
    | 'cancelled';

export type SiyuanSyncEvent = 'sync-start' | 'sync-end' | 'sync-fail';

export interface SyncGateDeps {
    /** 思源是否开启了云同步。读不到时应返回 false（当作没开，立刻放行）。 */
    isSyncEnabled: () => boolean;
    /** 订阅思源同步事件，返回取消订阅函数。 */
    on: (type: SiyuanSyncEvent, cb: () => void) => () => void;
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
    /**
     * 交出一个「取消等待」的句柄。插件 onunload 时必须调它，否则闸最长会攥着思源
     * eventBus 的三个监听器和两个定时器空等 5 分钟——而那时插件实例已经废了。
     */
    registerCancel?: (cancel: () => void) => void;
}

export interface SyncGateOptions {
    /** 静默期：这么久没见到任何同步事件就认为没同步要等。默认 25s。 */
    quietMs?: number;
    /** 最长等待，超时强制放行。默认 5 分钟。 */
    maxWaitMs?: number;
}

export const DEFAULT_QUIET_MS = 25_000;
export const DEFAULT_MAX_WAIT_MS = 5 * 60_000;

export function waitForSiyuanSyncSettled(
    deps: SyncGateDeps,
    options: SyncGateOptions = {}
): Promise<SyncGateOutcome> {
    const quietMs = options.quietMs ?? DEFAULT_QUIET_MS;
    const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
    const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as any));

    // 思源没开云同步就没有任何东西要等——这条必须最先判，否则没开同步的用户会白等一个静默期。
    let enabled = false;
    try {
        enabled = deps.isSyncEnabled();
    } catch {
        enabled = false;
    }
    if (!enabled) {
        return Promise.resolve('sync-disabled');
    }

    return new Promise<SyncGateOutcome>((resolve) => {
        const unsubscribers: Array<() => void> = [];
        let quietTimer: unknown = null;
        let maxTimer: unknown = null;
        let done = false;

        const finish = (outcome: SyncGateOutcome) => {
            if (done) return;
            done = true;
            if (quietTimer !== null) clearTimer(quietTimer);
            if (maxTimer !== null) clearTimer(maxTimer);
            for (const off of unsubscribers) {
                try { off(); } catch { /* 取消订阅失败不影响放行 */ }
            }
            resolve(outcome);
        };

        const subscribe = (type: SiyuanSyncEvent, cb: () => void) => {
            try {
                unsubscribers.push(deps.on(type, cb));
            } catch (error) {
                logger.warn(`[syncGate] 订阅 ${type} 失败:`, error);
            }
        };

        // 同步开跑了 → 撤掉静默期，改为一直等它结束（只受 maxWait 约束）。
        subscribe('sync-start', () => {
            if (done) return;
            if (quietTimer !== null) {
                clearTimer(quietTimer);
                quietTimer = null;
            }
        });
        subscribe('sync-end', () => finish('sync-finished'));
        // 同步失败也要放行：思源不会再有后续事件了，继续等只会永远不同步。
        subscribe('sync-fail', () => finish('sync-finished'));

        quietTimer = setTimer(() => {
            quietTimer = null;
            finish('no-sync-observed');
        }, quietMs);

        maxTimer = setTimer(() => finish('timeout'), maxWaitMs);

        // 卸载时能立刻收摊：finish 里会清定时器 + 退订所有监听。
        try {
            deps.registerCancel?.(() => finish('cancelled'));
        } catch (error) {
            logger.warn('[syncGate] registerCancel 失败:', error);
        }
    });
}
