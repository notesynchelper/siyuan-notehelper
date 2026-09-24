/**
 * 浏览器运行时适配器（仅前端入口 src/index.ts 引用；kernel bundle 不含本文件）
 *
 * 行为与改造前逐项等价（方案 §6.1 browserAdapter），等价性由既有 jest 全量回归保证。
 */

import { RuntimeAdapter, NetResponse, ExternalRequestInit } from './runtimeAdapter';
import { uploadAsset as browserUploadAsset } from '../utils/assetUploader';

/* eslint-disable @typescript-eslint/no-explicit-any */
function browserFetch(): typeof fetch {
    const f = (globalThis as any).fetch;
    if (typeof f !== 'function') {
        throw new Error('browser runtime requires fetch');
    }
    return f as typeof fetch;
}

export function createBrowserRuntime(plugin: {
    loadData: (key: string) => Promise<any>;
    saveData: (key: string, data: any) => Promise<any>;
    showMessage?: (message: string, timeout?: number) => void;
}): RuntimeAdapter {
    return {
        isBrowser: true,

        async kernel(path, init): Promise<NetResponse> {
            return browserFetch()(path, {
                method: init?.method || 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    ...(init?.headers || {}),
                },
                body: init?.body,
            });
        },

        async external(url: string, init?: ExternalRequestInit): Promise<NetResponse> {
            return browserFetch()(url, {
                method: init?.method,
                headers: init?.headers,
                body: init?.body,
            });
        },

        async externalBinary(url) {
            const resp = await browserFetch()(url);
            if (!resp.ok) {
                throw new Error(`HTTP ${resp.status}`);
            }
            const blob = await resp.blob();
            const bytes = await blob.arrayBuffer();
            return {
                bytes,
                contentType: resp.headers?.get?.('content-type') || 'application/octet-stream',
            };
        },

        async uploadAsset(data, filename, targetDir) {
            return browserUploadAsset(data, filename, targetDir);
        },

        async readFile(key) {
            const data = await plugin.loadData(key);
            if (data == null) {
                return null;
            }
            // saveData 存字符串时 loadData 可能原样返回字符串；存对象时可能返回已解析对象
            return typeof data === 'string' ? data : JSON.stringify(data);
        },

        async writeFile(key, content) {
            await plugin.saveData(key, content);
        },

        async getDeviceId() {
            const STORAGE_KEY = 'notehelper-device-id';
            const w = globalThis as any;
            const ls = w.localStorage;
            let id = ls?.getItem?.(STORAGE_KEY);
            if (!id) {
                const os = w.siyuan?.config?.system?.os;
                const platform = os === 'android' || os === 'ios' ? 'mobile' : 'desktop';
                id = `${platform}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
                ls?.setItem?.(STORAGE_KEY, id);
            }
            return id;
        },

        notify(message) {
            plugin.showMessage?.(message);
        },
    };
}
