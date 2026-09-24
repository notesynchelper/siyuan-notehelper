/**
 * kernel 插件入口（方案 §7）
 *
 * 构建产物 dist/kernel.js 在思源内核（>=3.7.0, kernels 含 docker）中加载，
 * 生命周期随内核进程，与浏览器是否打开无关。
 *
 * 职责：
 * - 单写者：docker 模式下所有同步（定时/手动/启动）由本进程执行，前端经 RPC 触发
 * - 调度：每轮重读 settings 快照，frequency 钳制到 >=10 分钟
 * - 状态：notehelper-sync-state 文件的唯一写者（kernel 模式）
 */

import { Settings } from 'luxon';
import { setRuntimeAdapter, getRuntime } from './sync/runtimeAdapter';
import { createKernelRuntime } from './kernel/runtime';
import { SyncManager } from './sync/syncManager';
import { createDefaultSettings, PluginSettings } from './settings';
import { NoticeFn } from './sync/SyncNoticeManager';
import {
    SETTINGS_KEY,
    KERNEL_PROTOCOL_VERSION,
    computeEffectiveFrequency,
} from './sync/background';
import {
    SyncState, SyncStateAccess, createRuntimeStateAccess,
} from './sync/syncState';
import { SyncResult } from './utils/types';

/* ── goja 环境无 Intl：固定东八区 + 固定 locale（实验验证，见方案 §6.3/§12） ── */
Settings.defaultZone = 'utc+08:00';
Settings.defaultLocale = 'en-US';

/* ── 模块状态 ───────────────────────────────────────────────── */

interface KernelSchedule {
    effectiveFrequencyMinutes: number;
    nextRunAt: number | null; // epoch ms
    timerId: any;
    tickCount: number;
}

let schedule: KernelSchedule | null = null;
let stateAccess: SyncStateAccess | null = null;
let isSyncing = false;
let startedAt = 0;
let unloaded = false;
let scheduleEvaluation = 0;
let settingsTimer: ReturnType<typeof setInterval> | null = null;

/** 同步核心。settingsSnapshot 为稳定引用对象，每轮 sync 前原地刷新（方案 §5） */
let syncManager: SyncManager | null = null;
let settingsSnapshot: PluginSettings = createDefaultSettings();

/* eslint-disable @typescript-eslint/no-explicit-any */
function api(): any {
    return (globalThis as any).siyuan;
}

function runtime() {
    return getRuntime();
}

/** kernel 通知：无 UI 环境把进度/结果提示降级为内核日志（SyncNoticeManager 注入版） */
const kernelNotice: NoticeFn = (message, _timeout, type) => {
    // 注意：内核 logger 是同步内联返回（undefined），不是 Promise——不能 .catch
    const log = type === 'error' ? api().logger.error : api().logger.info;
    log(`[notehelper-kernel] ${message}`);
};

/** 读取用户配置（每轮/每次 apply 都重读文件做快照，方案 §5） */
async function readSettingsSnapshot(): Promise<any | null> {
    const raw = await runtime().readFile(SETTINGS_KEY);
    if (raw == null) {
        return null;
    }
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

/* ── 调度 ───────────────────────────────────────────────────── */

function stopSchedule(): void {
    if (schedule && schedule.timerId != null) {
        clearInterval(schedule.timerId);
    }
    schedule = null;
}

async function applySchedule(reason: string): Promise<KernelSchedule | null> {
    const evaluation = ++scheduleEvaluation;
    const settings = await readSettingsSnapshot();
    if (unloaded || evaluation !== scheduleEvaluation) return schedule;
    if (!settings) {
        stopSchedule();
        await api().logger.warn(`[notehelper-kernel] ${reason}: settings 文件缺失/不可解析，不启动调度`);
        return null;
    }
    const effective = computeEffectiveFrequency(settings.frequency);
    if (effective == null) {
        stopSchedule();
        await api().logger.info(`[notehelper-kernel] ${reason}: frequency=${settings.frequency} 未启用后台同步`);
        return null;
    }

    // 频率未变不重排（codex #8）
    if (schedule && schedule.effectiveFrequencyMinutes === effective && schedule.timerId != null) {
        return schedule;
    }
    stopSchedule();

    const timerId = setInterval(() => {
        runScheduledTick().catch(async (e: unknown) => {
            await api().logger.error('[notehelper-kernel] scheduled tick error:', String(e));
        });
    }, effective * 60 * 1000);

    schedule = {
        effectiveFrequencyMinutes: effective,
        nextRunAt: Date.now() + effective * 60 * 1000,
        timerId,
        tickCount: 0,
    };
    await api().logger.info(
        `[notehelper-kernel] ${reason}: 后台同步调度已启动，每 ${effective} 分钟（原始 frequency=${settings.frequency}）`,
    );
    return schedule;
}

async function runScheduledTick(): Promise<void> {
    if (!schedule) {
        return;
    }
    await applySchedule('scheduled-refresh');
    if (!schedule) return;
    schedule.tickCount += 1;
    schedule.nextRunAt = Date.now() + schedule.effectiveFrequencyMinutes * 60 * 1000;
    const tickCount = schedule.tickCount;
    await api().logger.info(`[notehelper-kernel] scheduled tick #${tickCount}`);
    if (unloaded) return;
    const result = await executeSync('scheduled');
    await api().logger.info(
        `[notehelper-kernel] tick #${tickCount} 完成: success=${result.success} count=${result.count}`,
    );
}

/** 每轮同步：重读 settings 文件刷新配置快照（原地 assign 保持引用稳定）再执行 */
async function runKernelSync(reason: 'manual' | 'scheduled' | 'onstart'): Promise<SyncResult> {
    const fresh = await readSettingsSnapshot();
    if (fresh) {
        Object.assign(settingsSnapshot, createDefaultSettings(), fresh);
    }
    // 手动同步保留完整通知语义（isAutoSync=false）；scheduled/onstart 走静默（方案 §0.1 新1）
    const isAutoSync = reason !== 'manual';
    return syncManager!.sync(isAutoSync);
}

/** 统一同步执行体（进程内互斥：单写者模型下唯一需要的锁，方案 §4/§0.1#1） */
async function executeSync(reason: 'manual' | 'scheduled' | 'onstart'): Promise<SyncResult> {
    if (isSyncing) {
        return { success: false, count: 0, errors: ['kernel sync already in progress'] };
    }
    if (!syncManager || !stateAccess) {
        return { success: false, count: 0, errors: ['kernel sync manager not initialized'] };
    }
    isSyncing = true;
    try {
        const result = await runKernelSync(reason);
        const nowStr = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
        await stateAccess.commit((st: SyncState) => {
            st.lastSyncAt = nowStr;
            st.lastResult = {
                success: result.success,
                count: result.count,
                skipped: result.skipped,
                errors: result.errors,
                reason,
                at: nowStr,
            };
            st.lastError = result.success ? undefined : (result.errors || []).join('; ').slice(0, 500);
        });
        api().rpc.broadcast('notehelper-bg-sync', [result]).catch(() => {});
        return result;
    } finally {
        isSyncing = false;
    }
}

/* ── RPC（协议见方案 §4） ──────────────────────────────────── */

async function bindRpcs(): Promise<void> {
    const { rpc } = api();

    await rpc.bind(
        'notehelperPing',
        async () => ({
            protocolVersion: KERNEL_PROTOCOL_VERSION,
            pluginVersion: api().plugin.version,
            running: true,
            startedAt,
            schedule: schedule
                ? {
                    effectiveFrequencyMinutes: schedule.effectiveFrequencyMinutes,
                    nextRunAt: schedule.nextRunAt,
                    tickCount: schedule.tickCount,
                }
                : null,
        }),
        'Ping the notehelper kernel service.',
    );

    await rpc.bind(
        'notehelperGetStatus',
        async () => ({
            running: schedule != null,
            syncing: isSyncing,
            effectiveFrequencyMinutes: schedule?.effectiveFrequencyMinutes ?? null,
            nextRunAt: schedule?.nextRunAt ?? null,
            tickCount: schedule?.tickCount ?? 0,
            syncAt: stateAccess?.get().syncAt ?? '',
            initialSyncCompleted: stateAccess?.get().initialSyncCompleted ?? false,
            lastSyncAt: stateAccess?.get().lastSyncAt ?? null,
            lastResult: stateAccess?.get().lastResult ?? null,
            lastError: stateAccess?.get().lastError ?? null,
        }),
        'Return background sync scheduling status.',
    );

    await rpc.bind(
        'notehelperTriggerSync',
        async (request?: { reason?: string }) => {
            const reason = request?.reason === 'manual' || request?.reason === 'onstart'
                ? request.reason
                : 'scheduled';
            if (isSyncing) return { success: false, count: 0, busy: true };
            return executeSync(reason);
        },
        'Trigger a sync run in kernel (manual / scheduled / onstart).',
    );

    await rpc.bind(
        'notehelperApplySettings',
        async () => {
            const s = await applySchedule('applySettings');
            return {
                appliedAt: Date.now(),
                running: s != null,
                effectiveFrequencyMinutes: s?.effectiveFrequencyMinutes ?? null,
            };
        },
        'Re-read settings and re-schedule background sync.',
    );

    await rpc.bind(
        'notehelperResetSyncCursor',
        async () => {
            if (isSyncing) {
                return { reset: false, busy: true };
            }
            if (!stateAccess) {
                return { reset: false, busy: false };
            }
            isSyncing = true;
            try {
                await stateAccess.commit((st: SyncState) => {
                    st.syncAt = '';
                    st.deviceSyncCursors = {};
                    st.initialSyncCompleted = false;
                });
                return { reset: true, busy: false };
            } finally {
                isSyncing = false;
            }
        },
        'Reset all sync cursors (kernel owns them in docker mode).',
    );
    await rpc.bind(
        'notehelperUpdateSyncCursor',
        async (request?: { syncAt?: string }) => {
            if (isSyncing) return { updated: false, busy: true };
            if (!syncManager || typeof request?.syncAt !== 'string') return { updated: false, busy: false };
            isSyncing = true;
            try {
                await syncManager.updateSyncCursor(request.syncAt);
                return { updated: true, busy: false };
            } finally {
                isSyncing = false;
            }
        },
        'Update the sync cursor owned by kernel.',
    );

}

/* ── 生命周期 ─────────────────────────────────────────────── */

async function onload(): Promise<void> {
    unloaded = false;
    startedAt = Date.now();
    setRuntimeAdapter(createKernelRuntime());

    await api().logger.info(
        `[notehelper-kernel] onload platform=${api().plugin.platform} version=${api().plugin.version}`,
    );

    // 状态访问器 + 迁移（kernel 是 docker 模式的所有者；幂等）
    const legacyRaw = await runtime().readFile(SETTINGS_KEY);
    let legacySettings: unknown = null;
    try {
        legacySettings = legacyRaw ? JSON.parse(legacyRaw) : null;
    } catch {
        legacySettings = null;
    }
    stateAccess = await createRuntimeStateAccess(
        legacySettings,
        (key: string) => runtime().readFile(key),
        (key: string, content: string) => runtime().writeFile(key, content),
    );
    // 状态真身只在访问器内存快照里（commit 会替换快照对象，读取一律经 get()）
    await api().logger.info('[notehelper-kernel] sync-state 就绪（必要时已从旧 settings 迁移）');

    // 同步核心（P2 接入）：kernel 侧不带浏览器副作用（无 updater / 冷却戳）
    const fresh = await readSettingsSnapshot();
    if (fresh) {
        Object.assign(settingsSnapshot, createDefaultSettings(), fresh);
    }
    syncManager = new SyncManager(null, settingsSnapshot, {
        notify: kernelNotice,
        stateAccess,
    });

    await bindRpcs();
    await applySchedule('onload');
    if (unloaded) return;
    // RPC 两次失败后仍会重读配置；frequency=0 时也能恢复到正数。
    settingsTimer = setInterval(() => {
        applySchedule('settings-refresh').catch((e) => api().logger.error(String(e)));
    }, 60 * 1000);
}

async function onrunning(): Promise<void> {
    await api().logger.info(`[notehelper-kernel] running, protocol=v${KERNEL_PROTOCOL_VERSION}`);
    api().rpc.broadcast('notehelper-kernel-ready', [{ protocolVersion: KERNEL_PROTOCOL_VERSION }]).catch(() => {});
}

async function onunload(): Promise<void> {
    unloaded = true;
    ++scheduleEvaluation;
    // 不等待进行中的长任务（方案 §0.1#2：中断安全由游标推进时机 + source-id 去重保证）
    stopSchedule();
    if (settingsTimer != null) clearInterval(settingsTimer);
    settingsTimer = null;
    await api().logger.info('[notehelper-kernel] unloaded');
}

/* goja 会在求值后依次回调生命周期 */
function register(): void {
    const s = api();
    s.plugin.lifecycle.onload = onload;
    s.plugin.lifecycle.onrunning = onrunning;
    s.plugin.lifecycle.onunload = onunload;
}

register();
