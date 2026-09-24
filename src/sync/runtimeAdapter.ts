/**
 * 运行时适配层接口与注册器（方案 §6）
 *
 * 同步核心的所有环境依赖（网络/存储/设备标识/通知）都经由此接口。
 * - browser 实现：src/sync/browserRuntime.ts（仅前端入口引用）
 * - kernel 实现：src/kernel/runtime.ts（仅 kernel 入口引用）
 * 本文件保持环境无关：不 import 浏览器或 kernel 实现，供两个 bundle 安全共享。
 *
 * 注入方式：入口 onload 首行 setRuntimeAdapter(...)，任何同步代码运行前完成。
 */

/** 内核 API 相对路径请求 */
export interface KernelRequestInit {
    method?: string;
    /** JSON 字符串 */
    body?: string;
    headers?: Record<string, string>;
}

/** 外部 HTTP 请求（GraphQL / 图片 / 附件） */
export interface ExternalRequestInit {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
}

/** 两端统一的最小 Response 形状（浏览器原生 Response 满足；kernel 侧由适配器构造） */
export interface NetResponse {
    ok: boolean;
    status: number;
    statusText: string;
    json(): Promise<any>;
    text(): Promise<string>;
}

export interface BinaryDownload {
    bytes: ArrayBuffer;
    contentType: string;
}

export interface UploadAssetResult {
    success: boolean;
    path?: string;
    error?: string;
}

export type NoticeType = 'info' | 'error' | 'success';

export interface RuntimeAdapter {
    /** 思源内核 HTTP API（相对路径，如 /api/block/appendBlock） */
    kernel(path: string, init?: KernelRequestInit): Promise<NetResponse>;
    /** 外部 HTTP 请求（绝对 URL） */
    external(url: string, init?: ExternalRequestInit): Promise<NetResponse>;
    /** 外部二进制下载（图片/附件本地化） */
    externalBinary(url: string): Promise<BinaryDownload>;
    /** 资产上传到思源（返回 assets 相对路径） */
    uploadAsset(data: ArrayBuffer, filename: string, targetDir: string): Promise<UploadAssetResult>;
    /** 读插件存储文件（data/storage/petal/siyuan-notehelper/<key>），不存在返回 null */
    readFile(key: string): Promise<string | null>;
    /** 写插件存储文件（content 为原始字符串） */
    writeFile(key: string, content: string): Promise<void>;
    /** 稳定设备标识（浏览器=localStorage；kernel=存储文件） */
    getDeviceId(): Promise<string>;
    /** 用户通知（浏览器=showMessage；kernel=日志+广播） */
    notify(message: string, type?: NoticeType): void;
    /** 是否浏览器运行时（控制 checkAndUpdate / 冷却闸等浏览器专属行为） */
    readonly isBrowser: boolean;
}

/* ── 模块级注入 ─────────────────────────────────────────────── */

let current: RuntimeAdapter | null = null;

export function setRuntimeAdapter(adapter: RuntimeAdapter): void {
    current = adapter;
}

export function getRuntime(): RuntimeAdapter {
    if (!current) {
        throw new Error('RuntimeAdapter not set (call setRuntimeAdapter at entry onload)');
    }
    return current;
}
