/**
 * 后台同步调度纯逻辑（无 DOM / 无环境依赖，前端与 kernel 两个入口共用）
 *
 * 相关方案：docs/plans/2026-09-24-docker-background-sync-plan.md
 * - 能力判定：Docker 版且 kernelVersion >= MIN_KERNEL_APP_VERSION
 * - 频率下限：后台同步最低 10 分钟一次；非法值（NaN/Infinity/<=0）视为禁用
 */

/** kernel plugin 机制首次可用（`kernels` 字段被内核识别）的思源版本 */
export const MIN_KERNEL_APP_VERSION = '3.7.0';

/** 用户配置存储 key（前端 saveData 与 kernel siyuan.storage 同目录同文件，保持一致） */
export const SETTINGS_KEY = 'notehelper-settings';

/** 前端 ↔ kernel RPC 协议版本（不匹配视为不可协作，前端回退判定为不可达） */
export const KERNEL_PROTOCOL_VERSION = 1;

/** 后台定时同步的最低执行间隔（分钟） */
export const MIN_BACKGROUND_FREQUENCY_MINUTES = 10;

/** 后台定时同步的最大执行间隔（分钟），与设置页 1440 上限一致 */
export const MAX_BACKGROUND_FREQUENCY_MINUTES = 1440;

/**
 * 比较语义化版本 a >= b（只比 主.次.修订，忽略后缀）。
 * 非法输入返回 false。
 */
export function semverGte(a: string | undefined | null, b: string): boolean {
    if (!a || typeof a !== 'string') {
        return false;
    }
    const parse = (v: string): number[] | null => {
        const m = v.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
        if (!m) {
            return null;
        }
        return [Number(m[1]), Number(m[2]), Number(m[3])];
    };
    const va = parse(a);
    const vb = parse(b);
    if (!va || !vb) {
        return false;
    }
    for (let i = 0; i < 3; i++) {
        if (va[i] !== vb[i]) {
            return va[i] > vb[i];
        }
    }
    return true;
}

/**
 * 是否具备后台同步能力（Docker 后端 + 内核版本达标）。
 * 传入的参数来自 window.siyuan.config.system（前端）；kernel 侧恒为 true（能运行即达标）。
 */
export function isBackgroundCapable(system: {
    container?: string;
    kernelVersion?: string;
} | undefined | null): boolean {
    if (!system || system.container !== 'docker') {
        return false;
    }
    return semverGte(system.kernelVersion, MIN_KERNEL_APP_VERSION);
}

/**
 * 计算后台定时同步的有效频率（分钟）。
 * - 非有限数 / <=0 / NaN / Infinity：返回 null（不启动后台任务）
 * - (0, 1440]：钳制到 [10, 1440]
 */
export function computeEffectiveFrequency(freq: unknown): number | null {
    if (typeof freq !== 'number' || !Number.isFinite(freq) || freq <= 0) {
        return null;
    }
    const floored = Math.floor(freq);
    return Math.min(
        MAX_BACKGROUND_FREQUENCY_MINUTES,
        Math.max(MIN_BACKGROUND_FREQUENCY_MINUTES, floored),
    );
}
