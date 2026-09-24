/**
 * 同步状态存储（与用户配置分离，方案 §5）
 *
 * - key: `notehelper-sync-state`（前端 saveData 与 kernel siyuan.storage 同目录同文件）
 * - 单一写者：kernel 模式下仅 kernel 写；本地模式（桌面/手机/未启用 kernel）仅前端写
 * - 文件随思源同步（data/storage/petal/ 在同步范围内），设备级游标因此跨设备可见
 *
 * 本模块为纯逻辑（I/O 注入），便于单测；读写由 RuntimeAdapter 提供。
 */

import { SyncResult } from '../utils/types';

export const SYNC_STATE_KEY = 'notehelper-sync-state';

/** 当前状态文件结构版本 */
export const SYNC_STATE_SCHEMA_VERSION = 1;

export interface SyncLastResult {
    success: boolean;
    count: number;
    skipped: number;
    errors?: string[];
    /** 本次同步触发来源 */
    reason?: 'manual' | 'scheduled' | 'onstart';
    /** 完成时间（ISO，无毫秒） */
    at: string;
}

export interface SyncState {
    schemaVersion: number;
    /** 全局同步游标（向后兼容字段，从 settings.syncAt 迁移） */
    syncAt: string;
    /** 设备级游标 */
    deviceSyncCursors: Record<string, string>;
    /** 首次同步是否已完成 */
    initialSyncCompleted: boolean;
    /** 最近一次同步完成时间（含自动/手动） */
    lastSyncAt?: string;
    /** 最近一次同步结果 */
    lastResult?: SyncLastResult;
    /** 最近一次同步错误（顶层异常） */
    lastError?: string;
}

export function createEmptySyncState(): SyncState {
    return {
        schemaVersion: SYNC_STATE_SCHEMA_VERSION,
        syncAt: '',
        deviceSyncCursors: {},
        initialSyncCompleted: false,
    };
}

export function toSyncResultPayload(result: SyncResult, reason: SyncLastResult['reason'], at: string): SyncLastResult {
    return {
        success: result.success,
        count: result.count,
        skipped: result.skipped,
        errors: result.errors,
        reason,
        at,
    };
}

/** 归一化：容错读取（缺字段/坏结构） */
export function normalizeSyncState(raw: unknown): SyncState {
    const base = createEmptySyncState();
    if (!raw || typeof raw !== 'object') {
        return base;
    }
    const r = raw as Partial<SyncState>;
    return {
        schemaVersion: SYNC_STATE_SCHEMA_VERSION,
        syncAt: typeof r.syncAt === 'string' ? r.syncAt : '',
        deviceSyncCursors:
            r.deviceSyncCursors && typeof r.deviceSyncCursors === 'object'
                ? { ...r.deviceSyncCursors }
                : {},
        initialSyncCompleted: r.initialSyncCompleted === true,
        lastSyncAt: typeof r.lastSyncAt === 'string' ? r.lastSyncAt : undefined,
        lastResult: r.lastResult && typeof r.lastResult === 'object' ? r.lastResult : undefined,
        lastError: typeof r.lastError === 'string' ? r.lastError : undefined,
    };
}

export type ReadFileFn = (key: string) => Promise<string | null>;
export type WriteFileFn = (key: string, content: string) => Promise<void>;

export async function readSyncState(read: ReadFileFn): Promise<SyncState | null> {
    const raw = await read(SYNC_STATE_KEY);
    if (raw == null) {
        return null;
    }
    try {
        return normalizeSyncState(JSON.parse(raw));
    } catch {
        // 坏文件：当空状态处理（宁可贵一次重同步，不可卡死）
        return createEmptySyncState();
    }
}

export async function writeSyncState(write: WriteFileFn, state: SyncState): Promise<void> {
    await write(SYNC_STATE_KEY, JSON.stringify(state, null, 2));
}

/**
 * 迁移：旧版把游标内嵌在 settings 里。状态文件不存在时，从 settings 搬迁。
 * 幂等：状态文件已存在则原样返回（migrated=false）。
 * 由「所有者」调用：kernel 模式=kernel onload；本地模式=前端 onload。见方案 §0.1#3。
 *
 * @param legacySettings 旧 settings 对象（含可能内嵌的 syncAt/deviceSyncCursors/initialSyncCompleted）
 * @returns 迁移后的状态 + 是否发生了迁移 + 应从 settings 剥离的字段（调用方负责持久化）
 */
export async function migrateLegacySettings(
    legacySettings: unknown,
    read: ReadFileFn,
    write: WriteFileFn,
): Promise<{ state: SyncState; migrated: boolean }> {
    const existing = await readSyncState(read);
    if (existing) {
        return { state: existing, migrated: false };
    }

    const state = createEmptySyncState();
    const s = (legacySettings || {}) as Record<string, unknown>;
    if (typeof s.syncAt === 'string') {
        state.syncAt = s.syncAt;
    }
    if (s.deviceSyncCursors && typeof s.deviceSyncCursors === 'object') {
        state.deviceSyncCursors = s.deviceSyncCursors as Record<string, string>;
    }
    if (s.initialSyncCompleted === true) {
        state.initialSyncCompleted = true;
    }

    await writeSyncState(write, state);
    return { state, migrated: true };
}

/* ── 内存缓存 + 写穿透的访问器（两个入口共用） ──────────────── */

export interface SyncStateAccess {
    /** 同步过程内读内存快照 */
    get(): SyncState;
    /** 修改并持久化（写穿透） */
    commit(mutator: (s: SyncState) => void): Promise<void>;
}

/**
 * 建立状态访问器：读现有文件；不存在则从 legacy settings 迁移（幂等）。
 * 持有内存快照，commit 时更新快照并写回文件（单一写者模型下安全）。
 */
export async function createRuntimeStateAccess(
    legacySettings: unknown,
    read: ReadFileFn,
    write: WriteFileFn,
): Promise<SyncStateAccess> {
    const { state } = await migrateLegacySettings(legacySettings, read, write);
    let snapshot = state;
    return {
        get: () => snapshot,
        commit: async (mutator) => {
            const next = normalizeSyncState(snapshot);
            mutator(next);
            await writeSyncState(write, next);
            snapshot = next;
        },
    };
}
