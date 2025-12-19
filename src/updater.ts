/**
 * 自动更新模块
 * 检查新版本并自动更新插件文件
 */

import { logger } from './utils/logger';
import { showMessage } from 'siyuan';

const VERSION_URL = 'https://siyuan.notebooksyncer.com/plugversion';
const BASE_URL = 'https://siyuan.notebooksyncer.com/sy';
const PLUGIN_PATH = '/data/plugins/siyuan-notehelper';

// 需要下载的文件列表
const FILES = [
    { remote: `${BASE_URL}/plugin.json`, local: `${PLUGIN_PATH}/plugin.json` },
    { remote: `${BASE_URL}/index.js`, local: `${PLUGIN_PATH}/index.js` },
    { remote: `${BASE_URL}/index.css`, local: `${PLUGIN_PATH}/index.css` },
    { remote: `${BASE_URL}/i18n/zh_CN.json`, local: `${PLUGIN_PATH}/i18n/zh_CN.json` },
    { remote: `${BASE_URL}/i18n/en_US.json`, local: `${PLUGIN_PATH}/i18n/en_US.json` },
];

/**
 * 获取远程版本号
 */
async function getRemoteVersion(): Promise<string | null> {
    const response = await fetch(VERSION_URL);
    if (!response.ok) return null;
    const data = await response.json();
    return data.version || null;
}

/**
 * 获取本地版本号（从已安装的 plugin.json 读取）
 */
async function getLocalVersion(): Promise<string> {
    const response = await fetch('/api/file/getFile', {
        method: 'POST',
        body: JSON.stringify({ path: `${PLUGIN_PATH}/plugin.json` })
    });
    if (!response.ok) return '0.0.0';
    const data = await response.json();
    return data.version || '0.0.0';
}

/**
 * 比较版本号
 * @returns true 表示远程版本更新，需要更新
 */
function compareVersions(remote: string, local: string): boolean {
    const r = remote.split('.').map(Number);
    const l = local.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if ((r[i] || 0) > (l[i] || 0)) return true;
        if ((r[i] || 0) < (l[i] || 0)) return false;
    }
    return false;
}

/**
 * 下载所有文件到内存
 * 必须全部下载成功才返回
 */
async function downloadAllFiles(): Promise<Map<string, ArrayBuffer>> {
    const downloads = FILES.map(async (f) => {
        const resp = await fetch(f.remote);
        if (!resp.ok) throw new Error(`下载失败: ${f.remote}`);
        return { path: f.local, data: await resp.arrayBuffer() };
    });

    const results = await Promise.all(downloads);
    const map = new Map<string, ArrayBuffer>();
    results.forEach(r => map.set(r.path, r.data));
    return map;
}

/**
 * 写入单个文件到思源插件目录
 */
async function writeFile(path: string, data: ArrayBuffer): Promise<void> {
    const formData = new FormData();
    formData.append('path', path);
    formData.append('file', new Blob([data]));

    const resp = await fetch('/api/file/putFile', {
        method: 'POST',
        body: formData
    });
    if (!resp.ok) throw new Error(`写入失败: ${path}`);
}

/**
 * 检查并更新插件
 * 在打开设置页或同步时调用
 */
export async function checkAndUpdate(): Promise<void> {
    try {
        const remoteVersion = await getRemoteVersion();
        if (!remoteVersion) return;

        const localVersion = await getLocalVersion();
        if (!compareVersions(remoteVersion, localVersion)) return;

        logger.info(`发现新版本: ${localVersion} -> ${remoteVersion}`);

        // 先下载所有文件到内存
        const files = await downloadAllFiles();

        // 全部下载成功后再写入
        for (const [path, data] of files) {
            await writeFile(path, data);
        }

        showMessage(`笔记同步助手插件已更新到 ${remoteVersion} 版本，重启思源笔记后生效。`, 6000);
        logger.info(`更新完成: ${remoteVersion}`);
    } catch (error) {
        logger.error('自动更新失败:', error);
    }
}
