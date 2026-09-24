/**
 * kernel 侧运行时适配器（方案 §6.1 kernelAdapter）
 *
 * 运行环境：思源内核 goja 沙箱（非 Node、非浏览器）。
 * 仅可用：全局 siyuan.* 能力 + goja 注入的 setTimeout/setInterval/Promise 等。
 * 禁止：DOM、window、localStorage、FormData/Blob、require('siyuan')（前端包）。
 *
 * 外部 HTTP 一律经内核 /api/network/forwardProxy 转发（契约见 v3.8.5
 * kernel/apicontract/network_input.go：method/timeout 等为请求体顶层字段；
 * headers 为 [{name: value}] 数组；responseEncoding 支持 base64 取二进制）。
 */

import {
    RuntimeAdapter, NetResponse, BinaryDownload, UploadAssetResult,
} from '../sync/runtimeAdapter';

/* ── goja 全局 siyuan 对象的最小类型面（运行时由内核注入） ─────────────── */

interface KernelDataObject {
    text(): Promise<string>;
    json(): Promise<any>;
}

interface KernelFetchResponse extends KernelDataObject {
    ok: boolean;
    status: number;
    statusText: string;
    headers: Record<string, string>;
}

interface KernelSiyuan {
    plugin: { name: string; version: string; platform: string };
    logger: {
        info: (...args: any[]) => Promise<void>;
        warn: (...args: any[]) => Promise<void>;
        error: (...args: any[]) => Promise<void>;
        debug: (...args: any[]) => Promise<void>;
    };
    storage: {
        get(path: string): Promise<KernelDataObject>;
        put(path: string, content: string): Promise<void>;
    };
    rpc: {
        bind(name: string, handler: (...args: any[]) => any, description?: string): Promise<void>;
        unbind(name: string): Promise<void>;
        broadcast(method: string, params?: any[] | Record<string, any>): Promise<void>;
    };
    client: {
        fetch(path: string, init?: {
            method?: string;
            headers?: Record<string, string>;
            body?: string | ArrayBuffer;
        }): Promise<KernelFetchResponse>;
    };
}

function api(): KernelSiyuan {
    const s = (globalThis as any).siyuan;
    if (!s) {
        throw new Error('siyuan global not available in kernel runtime');
    }
    return s as KernelSiyuan;
}

/* ── base64 解码（goja 不保证 atob，自实现，无 Intl/依赖） ─────────────── */

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64DecodeToArrayBuffer(input: string): ArrayBuffer {
    const clean = input.replace(/[\r\n\s=]+/g, '');
    let length = 0;
    const bytes: number[] = [];
    let buffer = 0;
    let bits = 0;
    for (let i = 0; i < clean.length; i++) {
        const v = B64_ALPHABET.indexOf(clean.charAt(i));
        if (v < 0) {
            throw new Error(`invalid base64 character at ${i}`);
        }
        buffer = (buffer << 6) | v;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            bytes.push((buffer >> bits) & 0xff);
            length++;
        }
    }
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        out[i] = bytes[i];
    }
    return out.buffer;
}

/* ── forwardProxy 封装 ─────────────────────────────────────────── */

interface ForwardProxyData {
    url: string;
    status: number;
    contentType: string;
    body: string;
    bodyEncoding: string;
    headers: Record<string, string[]>;
    elapsed: number;
}

const FORWARD_PROXY_TIMEOUT_MS = 30000;

/** 外层响应包装：内核 API 统一 {code, msg, data} 包络 */
async function forwardProxy(body: {
    url: string;
    method: string;
    timeout: number;
    headers?: Record<string, string>[];
    contentType?: string;
    payload?: unknown;
    responseEncoding?: string;
}): Promise<ForwardProxyData> {
    const resp = await api().client.fetch('/api/network/forwardProxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const envelope = await resp.json();
    if (!resp.ok || envelope.code !== 0) {
        throw new Error(
            `forwardProxy failed: HTTP ${resp.status}, code=${envelope.code}, msg=${envelope.msg}`,
        );
    }
    return envelope.data as ForwardProxyData;
}

function forwardHeaders(init?: { headers?: Record<string, string> }): Record<string, string>[] | undefined {
    if (!init?.headers) {
        return undefined;
    }
    // 契约：headers 是数组，每项单键对象（network_input.go Options.Headers）
    return Object.keys(init.headers).map((name) => ({ [name]: init.headers![name] }));
}

/** 把 forwardProxy 结果包装成两端统一的 NetResponse */
function wrapForwardAsNetResponse(data: ForwardProxyData, bodyText: string): NetResponse {
    return {
        ok: data.status >= 200 && data.status < 300,
        status: data.status,
        statusText: `HTTP ${data.status}`,
        text: async () => bodyText,
        json: async () => JSON.parse(bodyText),
    };
}

/* ── multipart 构造（无 FormData/Blob，纯字节拼装） ─────────────────── */

/** UTF-8 编码，兼容 goja；孤立代理项与 TextEncoder 一样替换为 U+FFFD。 */
export function utf8Encode(text: string): Uint8Array {
    const bytes: number[] = [];
    for (let i = 0; i < text.length; i++) {
        let cp = text.charCodeAt(i);
        if (cp >= 0xd800 && cp <= 0xdbff) {
            const low = text.charCodeAt(i + 1);
            if (low >= 0xdc00 && low <= 0xdfff) {
                cp = 0x10000 + ((cp - 0xd800) << 10) + low - 0xdc00;
                i++;
            } else cp = 0xfffd;
        } else if (cp >= 0xdc00 && cp <= 0xdfff) cp = 0xfffd;
        if (cp < 0x80) bytes.push(cp);
        else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
        else if (cp < 0x10000) bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
        else bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    }
    return new Uint8Array(bytes);
}

export function buildMultipart(
    boundary: string,
    fields: Array<{ name: string; value: string }>,
    fileField: { name: string; filename: string; contentType: string; bytes: ArrayBuffer },
): ArrayBuffer {
    const encoder: number[] = [];
    const pushString = (s: string) => {
        const bytes = utf8Encode(s);
        for (let i = 0; i < bytes.length; i++) encoder.push(bytes[i]);
    };
    const pushBytes = (b: ArrayBuffer) => {
        const arr = new Uint8Array(b);
        for (let i = 0; i < arr.length; i++) {
            encoder.push(arr[i]);
        }
    };

    for (const f of fields) {
        pushString(`--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"\r\n\r\n${f.value}\r\n`);
    }
    pushString(
        `--${boundary}\r\nContent-Disposition: form-data; name="${fileField.name}"; filename="${fileField.filename}"\r\n` +
        `Content-Type: ${fileField.contentType}\r\n\r\n`,
    );
    pushBytes(fileField.bytes);
    pushString(`\r\n--${boundary}--\r\n`);

    const out = new Uint8Array(encoder.length);
    for (let i = 0; i < encoder.length; i++) {
        out[i] = encoder[i];
    }
    return out.buffer;
}

async function postMultipart(path: string, body: ArrayBuffer, boundarySeed: string): Promise<any> {
    const resp = await api().client.fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundarySeed}` },
        body,
    });
    const json = await resp.json();
    if (!resp.ok || json.code !== 0) {
        throw new Error(json.msg || `HTTP ${resp.status}`);
    }
    return json;
}

/* ── kernel 适配器实现 ─────────────────────────────────────────── */

const DEVICE_ID_KEY = 'device-id';

export function createKernelRuntime(): RuntimeAdapter {
    return {
        isBrowser: false,

        async kernel(path, init) {
            return api().client.fetch(path, {
                method: init?.method || 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    ...(init?.headers || {}),
                },
                body: init?.body,
            });
        },

        async external(url, init) {
            const data = await forwardProxy({
                url,
                method: init?.method || 'GET',
                timeout: FORWARD_PROXY_TIMEOUT_MS,
                headers: forwardHeaders(init),
                // payload 为 JSON 值（默认 payloadEncoding=json 会再编码一层 JSON）
                payload: init?.body !== undefined ? JSON.parse(init.body) : undefined,
            });
            return wrapForwardAsNetResponse(data, data.body);
        },

        async externalBinary(url): Promise<BinaryDownload> {
            const data = await forwardProxy({
                url,
                method: 'GET',
                timeout: FORWARD_PROXY_TIMEOUT_MS,
                responseEncoding: 'base64',
            });
            if (data.status < 200 || data.status >= 300) {
                throw new Error(`HTTP ${data.status}`);
            }
            return {
                bytes: base64DecodeToArrayBuffer(data.body),
                contentType: data.contentType || 'application/octet-stream',
            };
        },

        async uploadAsset(data, filename, targetDir): Promise<UploadAssetResult> {
            // 第一层：/api/asset/upload（与浏览器路径一致，自动去重）
            try {
                const boundary = '----notehelper-kernel-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
                const body = buildMultipart(
                    boundary,
                    [
                        { name: 'assetsDirPath', value: targetDir },
                    ],
                    {
                        name: 'file[]',
                        filename,
                        contentType: 'application/octet-stream',
                        bytes: data,
                    },
                );
                const json = await postMultipart('/api/asset/upload', body, boundary);
                const succMap = (json.data && json.data.succMap) || {};
                const path = succMap[filename];
                if (path) {
                    return { success: true, path };
                }
                throw new Error('succMap has no entry for ' + filename);
            } catch (e) {
                await api().logger.warn('[kernel] asset/upload failed, fallback to putFile:', String(e));
            }
            // 第二层：/api/file/putFile 直接落盘
            try {
                const unique = `${Date.now().toString(36)}-${filename}`;
                const boundary = '----notehelper-kernel-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
                const body = buildMultipart(
                    boundary,
                    [
                        { name: 'path', value: `/data/${targetDir}/${unique}` },
                        { name: 'isDir', value: 'false' },
                    ],
                    {
                        name: 'file',
                        filename: unique,
                        contentType: 'application/octet-stream',
                        bytes: data,
                    },
                );
                await postMultipart('/api/file/putFile', body, boundary);
                return { success: true, path: `${targetDir}/${unique}` };
            } catch (e) {
                return { success: false, error: String(e) };
            }
        },

        async readFile(key) {
            try {
                const obj = await api().storage.get(key);
                return await obj.text();
            } catch {
                return null;
            }
        },

        async writeFile(key, content) {
            await api().storage.put(key, content);
        },

        async getDeviceId() {
            const raw = await this.readFile(DEVICE_ID_KEY);
            if (raw) {
                try {
                    const parsed = JSON.parse(raw);
                    if (parsed && typeof parsed.id === 'string') {
                        return parsed.id;
                    }
                } catch {
                    /* fallthrough */
                }
            }
            const id = `docker-kernel-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
            await this.writeFile(DEVICE_ID_KEY, JSON.stringify({ id }));
            return id;
        },

        notify(message, type) {
            // 内核 logger 同步内联返回（非 Promise），不能 .catch；broadcast 是 Promise
            const fn = type === 'error' ? api().logger.error : api().logger.info;
            fn(`[notehelper] ${message}`);
            Promise.resolve(api().rpc.broadcast('notehelper-notice', [{ message, type }])).catch(() => {});
        },
    };
}
