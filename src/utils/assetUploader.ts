/**
 * 资产上传工具 - 三层降级策略
 *
 * 第一层: /api/asset/upload (首选，自动去重)
 * 第二层: /api/file/putFile (降级，直接写入)
 * 第三层: putFile + insertLocalAssets (兜底)
 */

import { logger } from './logger';

const TEMP_DIR = '/data/plugins/siyuan-notehelper/tmp';

export interface UploadResult {
    success: boolean;
    path?: string;  // 资产路径，如 "assets/image-xxx.png"
    error?: string;
}

/**
 * 三层降级上传资产
 * 高容错设计：任何一层成功即返回，全部失败返回失败结果但不抛异常
 *
 * @param data 文件二进制数据
 * @param filename 文件名
 * @param targetDir 目标目录，如 "assets/笔记同步助手/images/2024-01-05"
 */
export async function uploadAsset(
    data: ArrayBuffer | Blob,
    filename: string,
    targetDir: string
): Promise<UploadResult> {

    // === 第一层：/api/asset/upload ===
    try {
        const result = await uploadViaAssetApi(data, filename, targetDir);
        if (result.success) {
            logger.info(`[资产上传] 第一层成功: ${result.path}`);
            return result;
        }
    } catch (e) {
        logger.warn(`[资产上传] 第一层失败: ${e}`);
    }

    // === 第二层：/api/file/putFile ===
    try {
        const result = await uploadViaPutFile(data, filename, targetDir);
        if (result.success) {
            logger.info(`[资产上传] 第二层成功: ${result.path}`);
            return result;
        }
    } catch (e) {
        logger.warn(`[资产上传] 第二层失败: ${e}`);
    }

    // === 第三层：putFile + insertLocalAssets ===
    try {
        const result = await uploadViaInsertLocal(data, filename, targetDir);
        if (result.success) {
            logger.info(`[资产上传] 第三层成功: ${result.path}`);
            return result;
        }
    } catch (e) {
        logger.warn(`[资产上传] 第三层失败: ${e}`);
    }

    // 全部失败，返回失败结果（不抛异常，不阻塞流程）
    logger.error(`[资产上传] 所有方案均失败，文件: ${filename}`);
    return { success: false, error: '所有上传方案均失败' };
}

/**
 * 第一层：使用 /api/asset/upload API
 * 优点：自动去重文件名，专为资产设计
 */
async function uploadViaAssetApi(
    data: ArrayBuffer | Blob,
    filename: string,
    targetDir: string
): Promise<UploadResult> {
    const formData = new FormData();
    formData.append('file[]', new Blob([data]), filename);
    formData.append('assetsDirPath', targetDir);

    const response = await fetch('/api/asset/upload', {
        method: 'POST',
        body: formData,
    });
    const result = await response.json();

    if (result.code !== 0) {
        throw new Error(result.msg || 'upload API 返回错误');
    }

    const path = extractPathFromSuccMap(result.data?.succMap || {}, filename);
    if (!path) {
        throw new Error('upload API 成功但未返回路径');
    }
    return { success: true, path };
}

/**
 * 第二层：使用 /api/file/putFile API
 * 直接写入文件到指定路径
 */
async function uploadViaPutFile(
    data: ArrayBuffer | Blob,
    filename: string,
    targetDir: string
): Promise<UploadResult> {
    // 生成唯一文件名
    const uniqueFilename = generateUniqueFilename(filename);
    const filePath = `/data/${targetDir}/${uniqueFilename}`;

    const formData = new FormData();
    formData.append('path', filePath);
    formData.append('file', new Blob([data]), uniqueFilename);

    const response = await fetch('/api/file/putFile', {
        method: 'POST',
        body: formData,
    });
    const result = await response.json();

    if (result.code !== 0) {
        throw new Error(result.msg || 'putFile API 返回错误');
    }

    // 返回资产引用路径（去掉 /data/ 前缀）
    return { success: true, path: `${targetDir}/${uniqueFilename}` };
}

/**
 * 第三层：先 putFile 写入临时目录，再用 insertLocalAssets 导入
 * 这是最后的兜底方案
 */
async function uploadViaInsertLocal(
    data: ArrayBuffer | Blob,
    filename: string,
    _targetDir: string  // insertLocalAssets 会自动决定目标位置
): Promise<UploadResult> {
    // 1. 先写入临时目录
    const uniqueFilename = generateUniqueFilename(filename);
    const tempPath = `${TEMP_DIR}/${uniqueFilename}`;

    const formData = new FormData();
    formData.append('path', tempPath);
    formData.append('file', new Blob([data]), uniqueFilename);

    const putResponse = await fetch('/api/file/putFile', {
        method: 'POST',
        body: formData,
    });
    const putResult = await putResponse.json();

    if (putResult.code !== 0) {
        throw new Error(`写入临时文件失败: ${putResult.msg}`);
    }

    // 2. 获取工作空间绝对路径并拼接
    const workspaceDir = (window as any).siyuan?.config?.system?.workspaceDir;
    if (!workspaceDir) {
        // 清理临时文件
        cleanupTempFile(tempPath).catch(() => {});
        throw new Error('无法获取工作空间路径');
    }

    // 处理路径分隔符（Windows 使用反斜杠）
    const absolutePath = `${workspaceDir}${tempPath}`.replace(/\\/g, '/');

    // 3. 调用 insertLocalAssets
    const insertResponse = await fetch('/api/asset/insertLocalAssets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            assetPaths: [absolutePath],
            id: '',  // 不关联到特定文档
        }),
    });
    const insertResult = await insertResponse.json();

    // 清理临时文件（异步，不阻塞）
    cleanupTempFile(tempPath).catch(() => {});

    if (insertResult.code !== 0) {
        throw new Error(`insertLocalAssets 失败: ${insertResult.msg}`);
    }

    // 4. 从 succMap 提取路径
    // insertLocalAssets 的 succMap 格式: { "assets/xxx.png": "![](assets/xxx.png)" }
    const succMap = insertResult.data?.succMap || {};
    const assetPath = Object.keys(succMap)[0];

    if (!assetPath) {
        throw new Error('insertLocalAssets 成功但未返回路径');
    }

    return { success: true, path: assetPath };
}

/**
 * 生成唯一文件名（时间戳 + 随机字符串）
 */
function generateUniqueFilename(filename: string): string {
    const lastDotIndex = filename.lastIndexOf('.');
    const ext = lastDotIndex !== -1 ? filename.slice(lastDotIndex + 1) : '';
    const baseName = lastDotIndex !== -1 ? filename.slice(0, lastDotIndex) : filename;
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return ext ? `${baseName}-${timestamp}-${random}.${ext}` : `${baseName}-${timestamp}-${random}`;
}

/**
 * 从 succMap 中提取上传后的路径
 * 思源可能会修改文件名，所以需要模糊匹配
 */
function extractPathFromSuccMap(succMap: Record<string, string>, filename: string): string {
    // 直接匹配
    if (succMap[filename]) return succMap[filename];

    // 模糊匹配（思源可能修改文件名）
    const lastDotIndex = filename.lastIndexOf('.');
    const baseName = lastDotIndex !== -1 ? filename.slice(0, lastDotIndex) : filename;

    for (const [key, value] of Object.entries(succMap)) {
        if (key.includes(baseName)) return value;
    }

    // 兜底取第一个
    const values = Object.values(succMap);
    return values.length > 0 ? values[0] : '';
}

/**
 * 清理临时文件（异步，失败不影响主流程）
 */
async function cleanupTempFile(path: string): Promise<void> {
    try {
        await fetch('/api/file/removeFile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path }),
        });
    } catch {
        // 忽略清理失败
    }
}
