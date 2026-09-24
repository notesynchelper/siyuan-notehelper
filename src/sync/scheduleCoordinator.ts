/**
 * 调度协调器（方案 §2/§0.1#1/#8）
 *
 * 前端与 kernel 的调度所有权判定。四态：
 * - unsupported        非 docker 或 kernelVersion < 3.7.0 → 本地模式（现状完全不变）
 * - kernel-active      docker + 插件启用(kernel.js 存在) + RPC ping 通过 → 委托 kernel
 * - kernel-owned-unreachable  docker + 插件启用 + ping 失败 → 不本地接管（防双写），
 *                       手动同步报错可重试；周期性重 ping
 * - local              docker 但 kernel.js 未安装/插件未启用 → 本地模式
 *
 * 判定数据源（全部只读）：
 * - window.siyuan.config.system.{container, kernelVersion}
 * - /api/petal/loadPetals → petal.enabled / petal.kernel.existed
 * - /api/plugin/rpc/siyuan-notehelper → notehelperPing（带 protocolVersion 校验）
 */

import {
    isBackgroundCapable,
    KERNEL_PROTOCOL_VERSION,
} from './background';

export type ScheduleMode =
    | 'unsupported'
    | 'kernel-active'
    | 'kernel-owned-unreachable'
    | 'local';

export interface PingResult {
    protocolVersion: number;
    running?: boolean;
    [k: string]: unknown;
}

/** 协调器依赖（全部可注入，便于单测） */
export interface ScheduleCoordinatorDeps {
    /** 思源系统信息（window.siyuan.config.system） */
    system: { container?: string; kernelVersion?: string } | null | undefined;
    /** loadPetals 结果中本插件的启用状态与 kernel.js 存在性；null=未安装 */
    petal: { enabled: boolean; kernelExisted: boolean } | null;
    /** RPC ping（resolve=结果 / reject=不可达） */
    ping: () => Promise<PingResult>;
    /** 进入/退出某模式时的动作（本地定时器的启停由调用方在此挂） */
    onModeChange?: (mode: ScheduleMode) => void;
}

export function resolveScheduleMode(deps: ScheduleCoordinatorDeps): ScheduleMode {
    if (!isBackgroundCapable(deps.system)) {
        return 'unsupported';
    }
    if (!deps.petal || !deps.petal.kernelExisted) {
        // kernel.js 不存在（老版本插件包 / 用户装了旧版）→ 本地模式
        return 'local';
    }
    if (!deps.petal.enabled) {
        // 插件被禁用 → 前端也活着吗？禁用插件时前端同样不加载；
        // 能跑到这里说明前端在跑而 petal 未启用（边界态）→ 本地模式
        return 'local';
    }
    // kernel.js 存在且启用 → 所有权归 kernel；可达性靠 ping 动态判定
    return 'kernel-owned-unreachable';
}

/** ping 并校验协议版本；成功 → kernel-active */
export async function probeKernelActive(deps: ScheduleCoordinatorDeps): Promise<boolean> {
    try {
        const pong = await deps.ping();
        return pong?.protocolVersion === KERNEL_PROTOCOL_VERSION;
    } catch {
        return false;
    }
}

/**
 * 完整判定流程（onload / 设置保存 / kernel-plugin-state-change / 手动同步前重试用）。
 * 返回最终模式。
 */
export async function evaluateScheduleMode(
    deps: ScheduleCoordinatorDeps,
    current: ScheduleMode | null,
): Promise<ScheduleMode> {
    const base = resolveScheduleMode(deps);
    if (base !== 'kernel-owned-unreachable') {
        return base;
    }
    const alive = await probeKernelActive(deps);
    return alive ? 'kernel-active' : 'kernel-owned-unreachable';
}

/* ── 前端 RPC 封装（浏览器 fetch，思源会话鉴权） ────────────────── */

export async function rpcCall<T = unknown>(method: string, params: unknown[] = [], timeoutMs = 8000): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const resp = await fetch('/api/plugin/rpc/siyuan-notehelper', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', method, params, id: Date.now() }),
            signal: controller.signal,
        });
        if (!resp.ok) {
            throw new Error(`HTTP ${resp.status}`);
        }
        const data = await resp.json();
        if (data.error) {
            throw new Error(data.error.message || 'rpc error');
        }
        return data.result as T;
    } finally {
        clearTimeout(timer);
    }
}

/** 读取本插件 petal 状态（loadPetals）；未安装返回 null */
export async function fetchOwnPetal(pluginName: string): Promise<{ enabled: boolean; kernelExisted: boolean } | null> {
    const resp = await fetch('/api/petal/loadPetals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frontend: 'desktop' }),
    });
    if (!resp.ok) throw new Error(`loadPetals HTTP ${resp.status}`);
    const data = await resp.json();
    if (data.code !== 0 || !Array.isArray(data.data)) throw new Error('loadPetals failed');
    const petal = (data.data || []).find((p: { name?: string }) => p.name === pluginName);
    if (!petal) {
        return null;
    }
    return {
        enabled: petal.enabled === true,
        kernelExisted: petal.kernel?.existed === true,
    };
}
