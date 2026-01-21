/**
 * 文件处理器
 * 负责在思源笔记中创建和更新文档
 */

import { logger } from '../utils/logger';
import { uploadAsset } from '../utils/assetUploader';
import { Article } from '../utils/types';
import { PluginSettings } from '../settings';
import {
    renderArticleContent,
    renderWeChatMessage,
    renderFilename,
    renderFolderPath,
    renderMergeFolderPath,
    renderSingleFilename,
    renderFrontMatter,
    renderWeChatMessageSimple,
} from '../settings/template';
import { MergeMode, ImageMode } from '../utils/types';
import {
    isWeChatMessage,
    extractDateFromWeChatTitle,
    sanitizeFileName,
    formatDate,
    normalizePath,
    joinPath,
} from '../utils/util';
import { DateTime } from 'luxon';

// 星期映射（用于图片路径变量替换）
const WEEKDAY_MAP: Record<number, string> = {
    1: '周一', 2: '周二', 3: '周三', 4: '周四',
    5: '周五', 6: '周六', 7: '周日'
};

/**
 * 文件处理器类
 */
export class FileHandler {
    private plugin: any;  // SiYuan Plugin instance
    private settings: PluginSettings;
    private documentCache: Map<string, string>;  // 缓存文档路径到ID的映射

    constructor(plugin: any, settings: PluginSettings) {
        this.plugin = plugin;
        this.settings = settings;
        this.documentCache = new Map();
    }

    /**
     * 清除文档缓存（在每次同步开始时调用）
     */
    public clearDocumentCache(): void {
        this.documentCache.clear();
        logger.debug('[FileHandler] Document cache cleared');
    }

    /**
     * 处理单篇文章
     * @returns 返回 { docId: string, skipped: boolean }，skipped 为 true 表示文章被跳过
     */
    async processArticle(article: Article, notebookId: string): Promise<{ docId: string, skipped: boolean }> {
        try {
            const shouldMerge = this.shouldMergeArticle(article);

            if (shouldMerge) {
                return await this.mergeArticleToFile(article, notebookId);
            } else {
                return await this.createSeparateFile(article, notebookId);
            }
        } catch (error) {
            logger.error(`Failed to process article ${article.id}:`, error);
            throw error;
        }
    }

    /**
     * 判断是否应该合并文章
     */
    private shouldMergeArticle(article: Article): boolean {
        const mergeMode = this.settings.mergeMode;
        const isWeChat = isWeChatMessage(article.title);

        let shouldMerge = false;
        let reason = '';

        if (mergeMode === MergeMode.NONE) {
            shouldMerge = false;
            reason = 'mergeMode is NONE';
        } else if (mergeMode === MergeMode.MESSAGES) {
            shouldMerge = isWeChat;
            reason = isWeChat ? 'mergeMode is MESSAGES and is WeChat message' : 'mergeMode is MESSAGES but not WeChat message';
        } else if (mergeMode === MergeMode.ALL) {
            shouldMerge = true;
            reason = 'mergeMode is ALL';
        }

        logger.debug(`[shouldMergeArticle] Article: "${article.title}", MergeMode: ${mergeMode}, IsWeChat: ${isWeChat}, Result: ${shouldMerge}, Reason: ${reason}`);

        return shouldMerge;
    }

    /**
     * 创建独立文件
     * @returns 返回 { docId: string, skipped: boolean }
     */
    private async createSeparateFile(article: Article, notebookId: string): Promise<{ docId: string, skipped: boolean }> {
        // 1. 先生成路径（提前计算，用于路径去重）
        const folderPath = renderFolderPath(article, this.settings);
        const filename = sanitizeFileName(renderFilename(article, this.settings));
        const docPath = `${folderPath}/${filename}`;

        logger.debug(`[createSeparateFile] Checking for duplicate: ${docPath}`);

        // 2. 路径优先去重：直接查文件系统（不依赖索引，解决重启后索引延迟问题）
        const existingByPath = await this.getDocumentByHPath(notebookId, docPath);
        if (existingByPath) {
            logger.debug(`[createSeparateFile] Document exists at path: ${docPath}, skipping`);
            return { docId: existingByPath, skipped: true };
        }

        // 3. 属性备选去重：通过 source-id 属性检查（索引可用时的双重保险）
        const existingByAttr = await this.checkDocumentBySourceId(article.id);
        if (existingByAttr) {
            logger.debug(`[createSeparateFile] Document found by source-id: ${article.id}, skipping`);
            return { docId: existingByAttr, skipped: true };
        }

        // 4. 确保文件夹存在
        await this.ensureFolder(notebookId, folderPath);

        // 5. 生成内容
        const frontMatter = renderFrontMatter(article, this.settings);
        let content = isWeChatMessage(article.title)
            ? renderWeChatMessage(article, this.settings)
            : renderArticleContent(article, this.settings);

        logger.debug(`[createSeparateFile] 渲染后的内容长度: ${content.length}`);
        logger.debug(`[createSeparateFile] 原始文章内容: ${article.content?.substring(0, 300)}...`);

        // 5.1 处理附件链接（自动下载到本地）
        logger.debug(`[createSeparateFile] 调用 processAttachments...`);
        content = await this.processAttachments(content);
        logger.debug(`[createSeparateFile] processAttachments 完成`);

        const fullContent = frontMatter + content;

        // 6. 创建文档
        const docId = await this.createDocument(notebookId, docPath, fullContent);

        // 7. 设置自定义属性，用于后续去重（关键属性，必须成功）
        await this.setBlockAttributes(docId, article.id);

        // 8. 设置笔记同步助手默认属性
        await this.setNoteHelperAttributes(docId, '链接');

        logger.debug(`[createSeparateFile] Created document: ${docPath}`);
        return { docId, skipped: false };
    }

    /**
     * 合并文章到单个文件（使用块属性去重）
     * @returns 返回 { docId: string, skipped: boolean }
     */
    private async mergeArticleToFile(article: Article, notebookId: string): Promise<{ docId: string, skipped: boolean }> {
        logger.debug('=== mergeArticleToFile START ===');
        logger.debug(`Article title: ${article.title}`);

        // 确定合并文件的名称
        const mergeDate = isWeChatMessage(article.title)
            ? extractDateFromWeChatTitle(article.title) || article.savedAt.split('T')[0]
            : article.savedAt.split('T')[0];

        const filename = renderSingleFilename(mergeDate, this.settings);
        // 使用合并模式专用的文件夹配置
        const folderPath = renderMergeFolderPath(article, this.settings);

        // 确保文件夹存在
        await this.ensureFolder(notebookId, folderPath);

        // 使用路径工具函数规范化路径
        const docPath = joinPath(folderPath, filename);

        const mergeInfo = {
            articleId: article.id,
            articleTitle: article.title,
            isWeChatMessage: isWeChatMessage(article.title),
            mergeDate: mergeDate,
            filename: filename,
            folderPath: folderPath,
            docPath: docPath
        };

        logger.debug(`[mergeArticleToFile] Processing article for merge:`, mergeInfo);

        // 检查合并目标文档是否已存在
        const existingDocId = await this.getDocumentByPath(notebookId, docPath);

        const checkResult = {
            existingDocId,
            existingDocIdType: typeof existingDocId,
            looksLikeTimestamp: typeof existingDocId === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(existingDocId)
        };
        logger.debug(`[processMergedArticle] getDocumentByPath result:`, checkResult);

        if (existingDocId) {
            logger.debug('[mergeArticleToFile] Document exists, merging to existing...');
            // 再次检查ID的有效性
            if (typeof existingDocId === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(existingDocId)) {
                logger.error(`[processMergedArticle] Invalid document ID detected (timestamp): ${existingDocId}`);
                logger.error(`[processMergedArticle] Creating new document instead of merging`);
                return await this.createMergedDocument(notebookId, docPath, article, mergeDate);
            }

            // 文档存在，使用块属性去重
            return await this.mergeToExistingDocument(existingDocId, article, docPath, mergeDate);
        } else {
            // 文档不存在，创建新文档（传递mergeDate确保一致性）
            logger.debug('[mergeArticleToFile] Document not found, creating new...');
            return await this.createMergedDocument(notebookId, docPath, article, mergeDate);
        }
    }

    /**
     * 合并到已存在的文档（使用块属性去重）
     */
    private async mergeToExistingDocument(
        docId: string,
        article: Article,
        docPath: string,
        mergeDate: string
    ): Promise<{ docId: string, skipped: boolean }> {
        logger.debug(`[mergeToExistingDocument] Starting merge for article:`, {
            docId,
            articleId: article.id,
            articleTitle: article.title,
            docPath,
            mergeDate
        });

        // 获取已合并的消息ID列表（从块属性读取）
        const mergedIds = await this.getMergedIds(docId);

        logger.debug(`[mergeToExistingDocument] Found ${mergedIds.length} existing merged IDs`);

        // 检查文章是否已存在
        if (mergedIds.includes(article.id)) {
            logger.debug(`[mergeToExistingDocument] Article ${article.id} already exists in ${docPath}, skipping`);
            return { docId, skipped: true };
        }

        // 新文章，追加内容
        logger.debug(`[mergeToExistingDocument] Adding new article ${article.id} to ${docPath}`);

        try {
            // 获取现有文档内容
            const existingContent = await this.getDocumentContent(docId);

            logger.debug(`[mergeToExistingDocument] Existing content length: ${existingContent.length}`);

            // 生成新内容（根据消息类型使用不同渲染）
            let newContentPart = isWeChatMessage(article.title)
                ? renderWeChatMessageSimple(article, this.settings)
                : renderArticleContent(article, this.settings);

            logger.debug(`[mergeToExistingDocument] 渲染后的内容长度: ${newContentPart.length}`);
            logger.debug(`[mergeToExistingDocument] 原始文章内容: ${article.content?.substring(0, 300)}...`);

            // 处理附件链接（自动下载到本地）
            logger.debug(`[mergeToExistingDocument] 调用 processAttachments...`);
            newContentPart = await this.processAttachments(newContentPart);
            logger.debug(`[mergeToExistingDocument] processAttachments 完成`);

            // 添加分隔符
            const separator = existingContent.trim() ? '\n\n---\n\n' : '';

            // 拼接完整内容（无Front Matter）
            const newFullContent = `${existingContent}${separator}${newContentPart}`;

            logger.debug(`[mergeToExistingDocument] New content length: ${newFullContent.length}`);

            // 更新文档
            await this.updateDocument(docId, newFullContent);

            // 添加消息ID到块属性列表（重要：这必须在更新文档成功后执行）
            await this.addMergedId(docId, article.id);

            // 检查并补充 custom-merge-date 属性（兼容手动创建的文档）
            const existingMergeDate = await this.getBlockAttribute(docId, 'custom-merge-date');
            if (!existingMergeDate) {
                logger.debug(`[mergeToExistingDocument] Document missing custom-merge-date, adding: ${mergeDate}`);
                await this.setBlockAttrsWithRetry(docId, {
                    'custom-merge-doc': 'true',
                    'custom-merge-date': mergeDate,
                    'custom-merge-path': docPath,
                });
                logger.debug(`[mergeToExistingDocument] Added custom-merge-date attribute: ${mergeDate}`);
            }

            logger.debug(`[mergeToExistingDocument] Successfully merged article ${article.id}`);
            return { docId, skipped: false };
        } catch (error) {
            logger.error(`[mergeToExistingDocument] Failed to merge article:`, error);
            throw error;
        }
    }

    /**
     * 创建新的合并文档
     */
    private async createMergedDocument(
        notebookId: string,
        docPath: string,
        article: Article,
        mergeDate: string
    ): Promise<{ docId: string, skipped: boolean }> {
        logger.debug('=== createMergedDocument START ===');
        const createInfo = {
            notebookId,
            docPath,
            articleId: article.id,
            articleTitle: article.title,
            mergeDate: mergeDate
        };
        logger.debug(`[createMergedDocument] Creating new merged document:`, createInfo);

        try {
            // 生成内容（根据消息类型使用不同渲染）
            let contentPart = isWeChatMessage(article.title)
                ? renderWeChatMessageSimple(article, this.settings)
                : renderArticleContent(article, this.settings);

            logger.debug(`[createMergedDocument] 渲染后的内容长度: ${contentPart.length}`);
            logger.debug(`[createMergedDocument] 原始文章内容: ${article.content?.substring(0, 300)}...`);

            // 处理附件链接（自动下载到本地）
            logger.debug(`[createMergedDocument] 调用 processAttachments...`);
            contentPart = await this.processAttachments(contentPart);
            logger.debug(`[createMergedDocument] processAttachments 完成`);

            logger.debug(`[createMergedDocument] Generated content length: ${contentPart.length}`);

            // 创建文档（无Front Matter）
            const docId = await this.createDocument(notebookId, docPath, contentPart);

            if (!docId) {
                throw new Error('Failed to create document: no docId returned');
            }

            logger.debug(`[createMergedDocument] Document created with ID: ${docId}`);

            // 将新创建的文档添加到缓存
            const normalizedPath = docPath
                .replace(/\\/g, '/')
                .replace(/\/+/g, '/')
                .replace(/^\//, '');
            const cacheKey = `${notebookId}:${normalizedPath}`;
            this.documentCache.set(cacheKey, docId);
            logger.debug(`[createMergedDocument] Added to cache: ${cacheKey} => ${docId}`);

            // 初始化块属性：添加第一个消息ID
            // 这非常重要，必须在文档创建后立即执行
            await this.addMergedId(docId, article.id);

            // 生成思源格式的时间戳（YYYYMMDDHHmmss）
            const now = new Date();
            const siyuanTimestamp =
                now.getFullYear() +
                String(now.getMonth() + 1).padStart(2, '0') +
                String(now.getDate()).padStart(2, '0') +
                String(now.getHours()).padStart(2, '0') +
                String(now.getMinutes()).padStart(2, '0') +
                String(now.getSeconds()).padStart(2, '0');

            // 设置额外的元数据属性（使用传入的mergeDate确保一致性）
            const attrs = {
                'custom-merge-doc': 'true',
                'custom-creation-time': siyuanTimestamp,  // 使用思源格式而不是ISO格式
                'custom-merge-date': mergeDate,  // 使用传入的mergeDate
                'custom-merge-path': docPath,    // 添加路径属性便于调试
            };
            logger.debug('[createMergedDocument] Setting attributes:', attrs);

            await this.setBlockAttrsWithRetry(docId, attrs);

            // 设置笔记同步助手默认属性
            await this.setNoteHelperAttributes(docId, '消息');

            logger.debug(`[createMergedDocument] Successfully created merged document: ${docPath}`);
            return { docId, skipped: false };
        } catch (error) {
            logger.error(`[createMergedDocument] Failed to create merged document:`, error);
            throw error;
        }
    }

    /**
     * 更新文档内容
     */
    private async updateDocument(docId: string, content: string): Promise<void> {
        try {
            // 添加详细的诊断日志
            logger.debug(`[updateDocument] Called with docId: ${docId}`);
            logger.debug(`[updateDocument] DocId type: ${typeof docId}`);
            logger.debug(`[updateDocument] DocId looks like timestamp: ${typeof docId === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(docId)}`);
            logger.debug(`[updateDocument] Content length: ${content.length}`);

            // 如果发现docId是时间戳格式，记录错误并拒绝更新
            if (typeof docId === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(docId)) {
                logger.error(`[updateDocument] ERROR: Refusing to update with timestamp ID: ${docId}`);
                throw new Error(`Invalid document ID (timestamp format): ${docId}`);
            }

            // 检查content中是否有ID格式的内容
            const idPattern = /\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]/;
            const match = content.match(idPattern);
            if (match) {
                logger.warn(`[updateDocument] WARNING: Found timestamp pattern in content: ${match[1]}`);
                logger.warn(`[updateDocument] Content snippet around timestamp: ${content.substring(Math.max(0, content.indexOf(match[0]) - 50), Math.min(content.length, content.indexOf(match[0]) + 100))}`);
            }

            const requestBody = {
                dataType: 'markdown',
                data: content,
                id: docId,
            };

            logger.debug(`[updateDocument] Content preview (first 500 chars):`, requestBody.data.substring(0, 500));
            logger.debug(`[updateDocument] Content preview (last 500 chars):`, requestBody.data.substring(Math.max(0, requestBody.data.length - 500)));

            logger.debug(`[updateDocument] Request body:`, {
                dataType: requestBody.dataType,
                id: requestBody.id,
                dataPreview: requestBody.data.substring(0, 200)
            });

            const response = await fetch('/api/block/updateBlock', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            });

            const data = await response.json();

            if (data.code !== 0) {
                logger.error(`[updateDocument] API error response:`, {
                    code: data.code,
                    msg: data.msg,
                    docId: docId
                });
                throw new Error(`Failed to update document: ${data.msg}`);
            }

            logger.debug(`[updateDocument] Successfully updated document: ${docId}`);
        } catch (error) {
            logger.error('Failed to update document:', error);
            throw error;
        }
    }

    /**
     * 确保文件夹存在
     */
    private async ensureFolder(notebookId: string, folderPath: string): Promise<void> {
        // 调用思源 API 创建文件夹（如果不存在）
        // 思源会自动创建不存在的父文件夹
        // 这里暂时留空，因为创建文档时会自动创建必要的文件夹
    }

    /**
     * 创建文档
     */
    private async createDocument(
        notebookId: string,
        docPath: string,
        content: string
    ): Promise<string> {
        try {
            const response = await fetch('/api/filetree/createDocWithMd', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    notebook: notebookId,
                    path: docPath,
                    markdown: content,
                }),
            });

            const data = await response.json();

            if (data.code !== 0) {
                throw new Error(`Failed to create document: ${data.msg}`);
            }

            return data.data;  // 返回文档 ID
        } catch (error) {
            logger.error('Failed to create document:', error);
            throw error;
        }
    }

    /**
     * 根据路径获取文档 ID
     */
    private async getDocumentByPath(
        notebookId: string,
        docPath: string
    ): Promise<string | null> {
        try {
            // 规范化路径：
            // 1. 将反斜杠替换为正斜杠（Windows兼容性）
            // 2. 移除开头的斜杠
            // 3. 移除重复的斜杠
            let normalizedPath = docPath
                .replace(/\\/g, '/')  // Windows路径兼容
                .replace(/\/+/g, '/')  // 移除重复斜杠
                .replace(/^\//, '');   // 移除开头斜杠

            // 先检查缓存
            const cacheKey = `${notebookId}:${normalizedPath}`;
            if (this.documentCache.has(cacheKey)) {
                const cachedId = this.documentCache.get(cacheKey);
                logger.debug(`[getDocumentByPath] Found in cache: ${cachedId} for path: ${normalizedPath}`);
                return cachedId;
            }

            // 从路径提取文件名（不带.md扩展名）
            const filename = normalizedPath.split('/').pop() || '';
            const filenameWithoutExt = filename.replace(/\.md$/i, '');

            const searchInfo = {
                notebookId,
                originalPath: docPath,
                normalizedPath: normalizedPath,
                filename: filenameWithoutExt
            };
            logger.debug(`[getDocumentByPath] Searching for document:`, searchInfo);

            // 方法1：使用SQL查询，通过自定义属性或标题查找合并文档
            // 改进：使用 LEFT JOIN 兼容手动创建的文档（没有 custom-merge-date 属性）
            const mergeDate = filenameWithoutExt.match(/\d{4}-\d{2}-\d{2}/)?.[0];
            let sql = '';

            if (mergeDate) {
                // 如果能提取日期，使用智能查询：
                // 1. 优先匹配有 custom-merge-date 属性的文档
                // 2. 兜底匹配同名文档（兼容手动创建的文档）
                sql = `
                    SELECT DISTINCT b.id, b.content, b.hpath, a.value as merge_date
                    FROM blocks b
                    LEFT JOIN attributes a ON b.id = a.block_id AND a.name = 'custom-merge-date'
                    WHERE b.type = 'd'
                    AND b.box = '${notebookId}'
                    AND (
                        a.value = '${mergeDate}'
                        OR (a.value IS NULL AND b.content = '${filenameWithoutExt}')
                    )
                    ORDER BY
                        CASE WHEN a.value = '${mergeDate}' THEN 0 ELSE 1 END,
                        b.created DESC
                    LIMIT 1
                `;
            } else {
                // 否则使用文档标题匹配
                sql = `
                    SELECT id, content, hpath
                    FROM blocks
                    WHERE type = 'd'
                    AND box = '${notebookId}'
                    AND content = '${filenameWithoutExt}'
                    ORDER BY created DESC
                    LIMIT 1
                `;
            }

            logger.debug(`[getDocumentByPath] SQL query: ${sql}`);

            const response = await fetch('/api/query/sql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ stmt: sql }),
            });

            const data = await response.json();

            const sqlResponse = {
                code: data.code,
                dataLength: data.data ? data.data.length : 0
            };
            logger.debug(`[getDocumentByPath] SQL response:`, sqlResponse);

            if (data.code !== 0 || !data.data || data.data.length === 0) {
                // 方法2：如果精确匹配失败，尝试使用原API
                logger.debug(`[getDocumentByPath] SQL query found no results, trying filetree API`);

                // 确保路径以 .md 结尾（思源API查询要求）
                if (!normalizedPath.endsWith('.md')) {
                    normalizedPath = `${normalizedPath}.md`;
                }

                const apiResponse = await fetch('/api/filetree/getIDsByHPath', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        notebook: notebookId,
                        path: normalizedPath,
                    }),
                });

                const apiData = await apiResponse.json();

                const apiResponseInfo = {
                    code: apiData.code,
                    dataLength: apiData.data ? apiData.data.length : 0,
                    data: apiData.data
                };
                logger.debug(`[getDocumentByPath] Filetree API response:`, apiResponseInfo);

                if (apiData.code !== 0 || !apiData.data || apiData.data.length === 0) {
                    logger.debug(`[getDocumentByPath] Document not found: ${normalizedPath}`);
                    return null;
                }

                const apiDocId = apiData.data[0];

                // 添加详细日志以诊断问题
                logger.debug(`[getDocumentByPath] API data array:`, {
                    dataType: typeof apiData.data,
                    isArray: Array.isArray(apiData.data),
                    dataLength: apiData.data.length,
                    firstItem: apiDocId,
                    firstItemType: typeof apiDocId,
                    looksLikeTimestamp: typeof apiDocId === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(apiDocId)
                });

                // 检查是否返回了时间戳而不是ID
                if (typeof apiDocId === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(apiDocId)) {
                    logger.error(`[getDocumentByPath] WARNING: API returned timestamp instead of document ID: ${apiDocId}`);
                    logger.error(`[getDocumentByPath] Full API response:`, apiData);
                    return null; // 返回null表示文档不存在，避免使用错误的ID
                }

                logger.debug(`[getDocumentByPath] Document found via API with ID: ${apiDocId}`);
                // 缓存结果
                this.documentCache.set(cacheKey, apiDocId);
                return apiDocId;
            }

            // SQL查询成功
            const docId = data.data[0].id;
            const foundInfo = {
                hpath: data.data[0].hpath,
                content: data.data[0].content
            };
            logger.debug(`[getDocumentByPath] Document found via SQL with ID: ${docId}`, foundInfo);
            // 缓存结果
            this.documentCache.set(cacheKey, docId);
            return docId;
        } catch (error) {
            logger.error('[getDocumentByPath] Failed to get document by path:', error);
            return null;
        }
    }

    /**
     * 追加内容到文档
     */
    private async appendToDocument(docId: string, content: string): Promise<void> {
        try {
            // 获取文档当前内容
            const currentContent = await this.getDocumentContent(docId);

            // 添加分隔符
            const separator = '\n\n---\n\n';
            const newFullContent = currentContent + separator + content;

            // 更新文档
            const response = await fetch('/api/block/updateBlock', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    dataType: 'markdown',
                    data: newFullContent,
                    id: docId,
                }),
            });

            const data = await response.json();

            if (data.code !== 0) {
                throw new Error(`Failed to append to document: ${data.msg}`);
            }
        } catch (error) {
            logger.error('Failed to append to document:', error);
            throw error;
        }
    }

    /**
     * 获取文档内容
     */
    private async getDocumentContent(docId: string): Promise<string> {
        try {
            const response = await fetch('/api/block/getBlockKramdown', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: docId }),
            });

            const data = await response.json();

            if (data.code !== 0) {
                throw new Error(`Failed to get document content: ${data.msg}`);
            }

            let content = data.data.kramdown || '';

            logger.debug(`[getDocumentContent] Original content length: ${content.length}`);
            logger.debug(`[getDocumentContent] Content starts with: ${content.substring(0, 100)}`);

            // 移除文档级别的IAL属性（思源的 Inline Attribute List）
            // 格式为：---\n{: attr1="value1" attr2="value2" ...}\n
            // 这些IAL属性中的ISO时间戳会导致思源解析时报错 "found invalid ID [2025-xx-xxTxx:xx:xx.xxxZ]"
            // 只移除文档开头的IAL，保留内容中的其他部分
            const originalLength = content.length;
            content = this.removeDocumentIAL(content);

            logger.debug(`[getDocumentContent] After IAL removal - length: ${content.length}, removed: ${originalLength - content.length} chars`);
            logger.debug(`[getDocumentContent] Content now starts with: ${content.substring(0, 100)}`);

            return content;
        } catch (error) {
            logger.error('Failed to get document content:', error);
            return '';
        }
    }

    /**
     * 移除所有IAL属性（包括文档级和块级）
     * @param content 原始内容
     * @returns 移除IAL后的内容
     */
    private removeDocumentIAL(content: string): string {
        let cleaned = content;
        const originalLength = content.length;

        // 步骤1: 移除文档开头的IAL（---\n{: ...}\n格式）
        const docIALPattern = /^---\s*\n\{:[^}]*\}\s*\n+/;
        if (docIALPattern.test(cleaned)) {
            cleaned = cleaned.replace(docIALPattern, '');
            logger.debug('[removeDocumentIAL] Removed document-level IAL with --- prefix');
        }

        // 步骤2: 移除所有块级IAL（{: ...}\n格式）
        // 这些IAL通常紧跟在块（标题、段落等）之后
        // 格式如：{: id="20251120112342-fg8fppm" updated="20251120112342"}
        const blockIALPattern = /\n\{:[^}]*\}\s*\n/g;
        const blockIALMatches = cleaned.match(blockIALPattern);
        if (blockIALMatches) {
            logger.debug(`[removeDocumentIAL] Found ${blockIALMatches.length} block-level IAL attributes`);
            cleaned = cleaned.replace(blockIALPattern, '\n');
            logger.debug('[removeDocumentIAL] Removed all block-level IAL attributes');
        }

        // 步骤3: 移除可能在行末的IAL（例如：## 标题{: id="xxx"}）
        const inlineIALPattern = /\{:[^}]*\}/g;
        const inlineIALMatches = cleaned.match(inlineIALPattern);
        if (inlineIALMatches) {
            logger.debug(`[removeDocumentIAL] Found ${inlineIALMatches.length} inline IAL attributes`);
            cleaned = cleaned.replace(inlineIALPattern, '');
            logger.debug('[removeDocumentIAL] Removed all inline IAL attributes');
        }

        const removedChars = originalLength - cleaned.length;
        if (removedChars > 0) {
            logger.debug(`[removeDocumentIAL] Total removed: ${removedChars} chars`);
        } else {
            logger.debug('[removeDocumentIAL] No IAL attributes found');
        }

        return cleaned;
    }

    /**
     * 通过人类可读路径获取文档ID（不依赖索引，直接查文件系统）
     * 用于解决思源重启后索引延迟导致的重复问题
     * @param notebookId 笔记本 ID
     * @param hpath 人类可读路径（如 "笔记同步助手/2024-12-19/文章标题"）
     * @returns 文档 ID，如果不存在返回 null
     */
    private async getDocumentByHPath(notebookId: string, hpath: string): Promise<string | null> {
        try {
            // 规范化路径
            let normalizedPath = hpath
                .replace(/\\/g, '/')
                .replace(/\/+/g, '/')
                .replace(/^\//, '');

            // 思源 API 需要 .md 后缀
            if (!normalizedPath.endsWith('.md')) {
                normalizedPath = `${normalizedPath}.md`;
            }

            logger.debug(`[getDocumentByHPath] Checking path: ${normalizedPath}`);

            const response = await fetch('/api/filetree/getIDsByHPath', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    notebook: notebookId,
                    path: normalizedPath,
                }),
            });

            const data = await response.json();

            if (data.code !== 0 || !data.data || data.data.length === 0) {
                logger.debug(`[getDocumentByHPath] Document not found at path: ${normalizedPath}`);
                return null;
            }

            const docId = data.data[0];

            // 验证返回的是有效的文档 ID，而不是时间戳
            if (typeof docId === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(docId)) {
                logger.warn(`[getDocumentByHPath] Invalid ID (timestamp format): ${docId}`);
                return null;
            }

            logger.debug(`[getDocumentByHPath] Found document: ${docId}`);
            return docId;
        } catch (error) {
            logger.error('[getDocumentByHPath] Failed:', error);
            return null;
        }
    }

    /**
     * 通过服务端文章 ID 检查文档是否已存在
     * @param sourceId 服务端文章 ID
     * @returns 文档 ID，如果不存在返回 null
     */
    private async checkDocumentBySourceId(sourceId: string): Promise<string | null> {
        try {
            const sql = `SELECT block_id FROM attributes WHERE name='custom-source-id' AND value='${sourceId}' LIMIT 1`;
            const response = await fetch('/api/query/sql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ stmt: sql }),
            });

            const data = await response.json();

            if (data.code !== 0 || !data.data || data.data.length === 0) {
                return null;
            }

            return data.data[0].block_id;
        } catch (error) {
            logger.error('Failed to check document by source ID:', error);
            return null;
        }
    }

    /**
     * 设置笔记同步助手默认属性
     * @param docId 文档 ID
     * @param type 类型："链接" 或 "消息"
     */
    private async setNoteHelperAttributes(docId: string, type: '链接' | '消息'): Promise<void> {
        try {
            const response = await fetch('/api/attr/setBlockAttrs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: docId,
                    attrs: {
                        'custom-note-helper': '笔记同步助手',
                        'custom-note-helper-type': type,
                    },
                }),
            });

            const data = await response.json();

            if (data.code !== 0) {
                throw new Error(`Failed to set note-helper attributes: ${data.msg}`);
            }

            logger.debug(`Set note-helper attributes for doc ${docId}: type=${type}`);
        } catch (error) {
            logger.error('Failed to set note-helper attributes:', error);
            // 不抛出错误，因为这是非关键属性
        }
    }

    /**
     * 设置块的自定义属性
     * @param blockId 块 ID
     * @param sourceId 服务端文章 ID（可选，用于向后兼容）
     */
    private async setBlockAttributes(blockId: string, sourceId?: string): Promise<void> {
        try {
            const attrs: Record<string, string> = {};

            // 向后兼容：如果提供了sourceId，设置custom-source-id
            if (sourceId) {
                attrs['custom-source-id'] = sourceId;
            }

            if (Object.keys(attrs).length === 0) {
                return;  // 没有要设置的属性
            }

            const response = await fetch('/api/attr/setBlockAttrs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: blockId,
                    attrs,
                }),
            });

            const data = await response.json();

            if (data.code !== 0) {
                throw new Error(`Failed to set block attributes: ${data.msg}`);
            }

            logger.debug(`Set block attributes for block ${blockId}`);
        } catch (error) {
            logger.error('Failed to set block attributes:', error);
            throw error;
        }
    }

    /**
     * 带重试机制的属性设置（用于关键属性）
     * @param blockId 块 ID
     * @param attrs 属性对象
     * @param maxRetries 最大重试次数，默认 2
     */
    private async setBlockAttrsWithRetry(
        blockId: string,
        attrs: Record<string, string>,
        maxRetries: number = 2
    ): Promise<void> {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const response = await fetch('/api/attr/setBlockAttrs', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: blockId, attrs }),
                });

                const data = await response.json();

                if (data.code === 0) {
                    logger.debug(`[setBlockAttrsWithRetry] Success on attempt ${attempt + 1}`);
                    return;
                }

                logger.warn(`[setBlockAttrsWithRetry] Failed attempt ${attempt + 1}: ${data.msg}`);

                if (attempt < maxRetries) {
                    // 递增延迟：100ms, 200ms, 300ms...
                    await this.sleep(100 * (attempt + 1));
                }
            } catch (error) {
                logger.error(`[setBlockAttrsWithRetry] Error on attempt ${attempt + 1}:`, error);
                if (attempt === maxRetries) {
                    throw error;
                }
                await this.sleep(100 * (attempt + 1));
            }
        }

        throw new Error(`Failed to set block attributes after ${maxRetries + 1} attempts`);
    }

    /**
     * 延迟函数
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 获取块的单个属性值
     * @param blockId 块 ID
     * @param attrName 属性名
     * @returns 属性值，如果不存在返回 null
     */
    private async getBlockAttribute(blockId: string, attrName: string): Promise<string | null> {
        try {
            const response = await fetch('/api/attr/getBlockAttrs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: blockId }),
            });

            const data = await response.json();

            if (data.code !== 0) {
                return null;
            }

            return data.data?.[attrName] || null;
        } catch (error) {
            logger.error('Failed to get block attribute:', error);
            return null;
        }
    }

    /**
     * 获取已合并的消息ID列表
     * @param docId 文档 ID
     * @returns 消息ID数组
     */
    private async getMergedIds(docId: string): Promise<string[]> {
        try {
            logger.debug(`[getMergedIds] Getting merged IDs for doc: ${docId}`);

            const idsJson = await this.getBlockAttribute(docId, 'custom-merged-ids');

            if (!idsJson) {
                logger.debug(`[getMergedIds] No merged IDs found for doc ${docId}, returning empty array`);
                return [];
            }

            logger.debug(`[getMergedIds] Retrieved JSON: ${idsJson.substring(0, 100)}...`);

            const ids = JSON.parse(idsJson);

            if (!Array.isArray(ids)) {
                logger.warn(`[getMergedIds] Merged IDs is not an array, got: ${typeof ids}`);
                return [];
            }

            logger.debug(`[getMergedIds] Found ${ids.length} merged IDs`);
            return ids;
        } catch (error) {
            logger.error('[getMergedIds] Failed to parse merged IDs:', error);
            return [];
        }
    }

    /**
     * 添加消息ID到已合并列表
     * @param docId 文档 ID
     * @param articleId 文章 ID
     */
    private async addMergedId(docId: string, articleId: string): Promise<void> {
        try {
            logger.debug(`[addMergedId] Adding article ${articleId} to doc ${docId}`);

            // 获取现有ID列表
            const mergedIds = await this.getMergedIds(docId);

            // 检查是否已存在
            if (mergedIds.includes(articleId)) {
                logger.debug(`[addMergedId] Article ${articleId} already in merged list, skipping`);
                return;
            }

            // 添加新ID
            mergedIds.push(articleId);

            logger.debug(`[addMergedId] Updating merged IDs list with ${mergedIds.length} items`);

            // 生成思源格式的时间戳（YYYYMMDDHHmmss）
            // 不使用ISO格式，因为ISO格式中的特殊字符会被思源误认为块ID引用
            const now = new Date();
            const siyuanTimestamp =
                now.getFullYear() +
                String(now.getMonth() + 1).padStart(2, '0') +
                String(now.getDate()).padStart(2, '0') +
                String(now.getHours()).padStart(2, '0') +
                String(now.getMinutes()).padStart(2, '0') +
                String(now.getSeconds()).padStart(2, '0');

            // 保存更新后的列表
            const response = await fetch('/api/attr/setBlockAttrs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: docId,
                    attrs: {
                        'custom-merged-ids': JSON.stringify(mergedIds),
                        'custom-last-merge-time': siyuanTimestamp,  // 使用思源格式而不是ISO格式
                        'custom-merge-count': String(mergedIds.length),
                    },
                }),
            });

            const data = await response.json();

            if (data.code !== 0) {
                logger.error(`[addMergedId] Failed to save merged IDs:`, data);
                throw new Error(`Failed to add merged ID: ${data.msg}`);
            }

            logger.debug(`[addMergedId] Successfully added article ${articleId} to merged list (total: ${mergedIds.length})`);
        } catch (error) {
            logger.error('Failed to add merged ID:', error);
            throw error;
        }
    }

    /**
     * 获取默认笔记本 ID（第一个未关闭的笔记本）
     */
    async getDefaultNotebook(): Promise<string> {
        try {
            const response = await fetch('/api/notebook/lsNotebooks', {
                method: 'POST',
            });

            const data = await response.json();

            if (data.code !== 0 || !data.data || !data.data.notebooks) {
                throw new Error('Failed to get notebooks');
            }

            const notebooks = data.data.notebooks;

            // 返回第一个未关闭的笔记本
            const openNotebook = notebooks.find((nb: any) => !nb.closed);
            if (openNotebook) {
                return openNotebook.id;
            }

            // 如果没有打开的笔记本，返回第一个
            return notebooks[0]?.id || '';
        } catch (error) {
            logger.error('Failed to get default notebook:', error);
            throw error;
        }
    }

    /**
     * 获取目标笔记本 ID
     * 优先使用用户设置的笔记本，如果未设置则使用默认笔记本
     * @returns {Promise<{notebookId: string, isDefault: boolean}>} 笔记本ID和是否为默认
     */
    async getTargetNotebook(): Promise<{notebookId: string, isDefault: boolean}> {
        // 如果用户已设置目标笔记本，直接使用
        if (this.settings.targetNotebook) {
            return {
                notebookId: this.settings.targetNotebook,
                isDefault: false
            };
        }

        // 未设置时使用默认笔记本
        const defaultNotebook = await this.getDefaultNotebook();
        return {
            notebookId: defaultNotebook,
            isDefault: true
        };
    }

    /**
     * 获取所有未关闭的笔记本列表
     * @returns {Promise<Array<{id: string, name: string}>>} 笔记本列表
     */
    async getAllNotebooks(): Promise<Array<{id: string, name: string}>> {
        try {
            const response = await fetch('/api/notebook/lsNotebooks', {
                method: 'POST',
            });

            const data = await response.json();

            if (data.code !== 0 || !data.data || !data.data.notebooks) {
                throw new Error('Failed to get notebooks');
            }

            // 过滤出未关闭的笔记本，只返回 id 和 name
            return data.data.notebooks
                .filter((nb: any) => !nb.closed)
                .map((nb: any) => ({
                    id: nb.id,
                    name: nb.name
                }));
        } catch (error) {
            logger.error('Failed to get notebooks:', error);
            throw error;
        }
    }

    /**
     * 处理内容中的附件和图片链接，下载到本地并替换链接
     * @param content 原始内容
     * @returns 处理后的内容
     */
    async processAttachments(content: string): Promise<string> {
        logger.info(`[资源处理] ========== 开始处理文章资源 ==========`);
        logger.info(`[资源处理] 内容长度: ${content.length} 字符`);
        logger.info(`[资源处理] 图片模式: ${this.settings.imageMode}`);
        logger.debug(`[资源处理] 内容预览: ${content.substring(0, 500)}...`);

        // 1. 处理图片链接 ![alt](url) - 仅在 LOCAL 模式下
        if (this.settings.imageMode === ImageMode.LOCAL) {
            const imageRegex = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
            const imageMatches: Array<{full: string, alt: string, url: string}> = [];
            let imageMatch;

            while ((imageMatch = imageRegex.exec(content)) !== null) {
                imageMatches.push({
                    full: imageMatch[0],
                    alt: imageMatch[1],
                    url: imageMatch[2]
                });
            }

            logger.info(`[图片处理] 检测到 ${imageMatches.length} 个图片链接`);

            if (imageMatches.length > 0) {
                for (let i = 0; i < imageMatches.length; i++) {
                    const item = imageMatches[i];
                    logger.info(`[图片处理] [${i + 1}/${imageMatches.length}] 开始处理图片`);
                    logger.info(`[图片处理] 原始链接: ${item.full}`);
                    logger.info(`[图片处理] 图片URL: ${item.url}`);

                    try {
                        const localPath = await this.downloadImage(item.url);
                        if (localPath) {
                            const newLink = `![${item.alt}](${localPath})`;
                            content = content.replace(item.full, newLink);
                            logger.info(`[图片处理] ✓ 下载成功`);
                            logger.info(`[图片处理] 本地路径: ${localPath}`);
                            logger.info(`[图片处理] 替换后链接: ${newLink}`);
                            logger.info(`[图片处理] 替换状态: 成功`);
                        } else {
                            logger.warn(`[图片处理] ✗ 下载失败，保留原链接`);
                            logger.info(`[图片处理] 替换状态: 跳过（下载失败）`);
                        }
                    } catch (error) {
                        logger.error(`[图片处理] ✗ 处理异常: ${error}`);
                        logger.info(`[图片处理] 替换状态: 跳过（异常）`);
                    }
                }
            }
        } else {
            logger.info(`[图片处理] 图片模式为 ${this.settings.imageMode}，跳过图片本地化`);
        }

        // 2. 处理附件链接 [文件名](url) - 排除图片链接
        const attachmentRegex = /(?<!!)\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
        const matches: Array<{full: string, displayName: string, url: string}> = [];
        let match;

        while ((match = attachmentRegex.exec(content)) !== null) {
            matches.push({
                full: match[0],
                displayName: match[1],
                url: match[2]
            });
        }

        logger.info(`[附件处理] 检测到 ${matches.length} 个附件链接`);

        if (matches.length > 0) {
            for (let i = 0; i < matches.length; i++) {
                const item = matches[i];
                logger.info(`[附件处理] [${i + 1}/${matches.length}] 开始处理附件`);
                logger.info(`[附件处理] 原始链接: ${item.full}`);
                logger.info(`[附件处理] 文件名: ${item.displayName}`);
                logger.info(`[附件处理] 附件URL: ${item.url}`);

                try {
                    const localPath = await this.downloadAttachment(item.url, item.displayName);
                    if (localPath) {
                        const newLink = `[${item.displayName}](${localPath})`;
                        content = content.replace(item.full, newLink);
                        logger.info(`[附件处理] ✓ 下载成功`);
                        logger.info(`[附件处理] 本地路径: ${localPath}`);
                        logger.info(`[附件处理] 替换后链接: ${newLink}`);
                        logger.info(`[附件处理] 替换状态: 成功`);
                    } else {
                        logger.warn(`[附件处理] ✗ 下载失败，保留原链接`);
                        logger.info(`[附件处理] 替换状态: 跳过（下载失败）`);
                    }
                } catch (error) {
                    logger.error(`[附件处理] ✗ 处理异常: ${error}`);
                    logger.info(`[附件处理] 替换状态: 跳过（异常）`);
                }
            }
        }

        logger.info(`[资源处理] ========== 资源处理完成 ==========`);
        return content;
    }

    /**
     * 下载附件到本地
     * @param url 附件 URL
     * @param displayName markdown 链接中的显示名称（用作文件名）
     * @returns 本地路径
     */
    private async downloadAttachment(url: string, displayName: string): Promise<string | null> {
        try {
            // 1. 下载文件
            logger.info(`[附件下载] 发起网络请求...`);
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            logger.info(`[附件下载] 网络请求成功，状态码: ${response.status}`);

            const blob = await response.blob();
            const arrayBuffer = await blob.arrayBuffer();
            logger.info(`[附件下载] 文件大小: ${(arrayBuffer.byteLength / 1024).toFixed(2)} KB`);

            // 2. 使用 displayName 作为文件名（确保有扩展名）
            let filename = sanitizeFileName(displayName);

            // 如果 displayName 没有扩展名，尝试从 URL 获取
            if (!filename.includes('.')) {
                const urlExtension = this.getExtensionFromUrl(url);
                if (urlExtension) {
                    filename = `${filename}.${urlExtension}`;
                }
            }
            logger.info(`[附件下载] 保存文件名: ${filename}`);

            // 3. 上传到思源
            // 验证路径必须以 assets/ 开头，否则使用默认路径
            let attachmentFolder = this.settings.attachmentFolder;
            if (!attachmentFolder.startsWith('assets/')) {
                attachmentFolder = 'assets/笔记同步助手/attachments';
                logger.warn(`[附件下载] 路径未以 assets/ 开头，使用默认路径: ${attachmentFolder}`);
            }

            logger.info(`[附件下载] 上传目录: ${attachmentFolder}`);

            // 使用三层降级上传策略
            const uploadResult = await uploadAsset(arrayBuffer, filename, attachmentFolder);

            if (!uploadResult.success) {
                logger.error(`[附件下载] 上传失败: ${uploadResult.error}`);
                return null;  // 返回 null 但不抛异常，不阻塞流程
            }

            logger.info(`[附件下载] 上传成功，路径: ${uploadResult.path}`);
            return uploadResult.path || null;
        } catch (error) {
            logger.error(`[附件下载] 失败: ${error}`);
            return null;
        }
    }

    /**
     * 下载图片到本地
     * @param url 图片 URL
     * @returns 本地路径
     */
    private async downloadImage(url: string): Promise<string | null> {
        try {
            // 1. 下载图片
            logger.info(`[图片下载] 发起网络请求...`);
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            logger.info(`[图片下载] 网络请求成功，状态码: ${response.status}`);

            const blob = await response.blob();
            const arrayBuffer = await blob.arrayBuffer();
            logger.info(`[图片下载] 文件大小: ${(arrayBuffer.byteLength / 1024).toFixed(2)} KB`);

            // 2. 生成文件名（从 URL 提取或生成唯一名）
            let filename = this.getFilenameFromUrl(url);
            if (!filename) {
                // 生成唯一文件名
                const ext = this.getExtensionFromUrl(url) || 'jpg';
                filename = `image-${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;
            }
            filename = sanitizeFileName(filename);
            logger.info(`[图片下载] 保存文件名: ${filename}`);

            // 3. 上传到思源（使用图片专用目录）
            // 渲染目录模板中的日期变量
            let imageFolder = this.settings.imageAttachmentFolder || this.settings.attachmentFolder;
            const now = new Date().toISOString();
            const today = formatDate(now, this.settings.folderDateFormat);

            // 生成分开的时间变量
            const dt = DateTime.fromISO(now);
            const year = dt.toFormat('yyyy');
            const month = dt.toFormat('MM');
            const day = dt.toFormat('dd');
            const hour = dt.toFormat('HH');
            const minute = dt.toFormat('mm');
            const weekday = WEEKDAY_MAP[dt.weekday] || '';
            const quarter = `Q${dt.quarter}`;

            // 替换所有时间变量
            imageFolder = imageFolder
                .replace(/\{\{\{date\}\}\}/g, today)
                .replace(/\{\{\{year\}\}\}/g, year)
                .replace(/\{\{\{month\}\}\}/g, month)
                .replace(/\{\{\{day\}\}\}/g, day)
                .replace(/\{\{\{hour\}\}\}/g, hour)
                .replace(/\{\{\{minute\}\}\}/g, minute)
                .replace(/\{\{\{weekday\}\}\}/g, weekday)
                .replace(/\{\{\{quarter\}\}\}/g, quarter);

            // 验证路径必须以 assets/ 开头，否则使用默认路径
            if (!imageFolder.startsWith('assets/')) {
                imageFolder = `assets/笔记同步助手/images/${today}`;
                logger.warn(`[图片下载] 路径未以 assets/ 开头，使用默认路径: ${imageFolder}`);
            }
            logger.info(`[图片下载] 上传目录: ${imageFolder}`);

            // 使用三层降级上传策略
            const uploadResult = await uploadAsset(arrayBuffer, filename, imageFolder);

            if (!uploadResult.success) {
                logger.error(`[图片下载] 上传失败: ${uploadResult.error}`);
                return null;  // 返回 null 但不抛异常，不阻塞流程
            }

            logger.info(`[图片下载] 上传成功，路径: ${uploadResult.path}`);
            return uploadResult.path || null;
        } catch (error) {
            logger.error(`[图片下载] 失败: ${error}`);
            return null;
        }
    }

    /**
     * 从 URL 中提取文件名
     */
    private getFilenameFromUrl(url: string): string | null {
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            const filename = pathname.split('/').pop();
            // 只返回有扩展名的文件名
            if (filename && filename.includes('.')) {
                return filename;
            }
        } catch {
            // URL 解析失败
        }
        return null;
    }

    /**
     * 从 URL 中提取文件扩展名
     */
    private getExtensionFromUrl(url: string): string | null {
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            const lastDotIndex = pathname.lastIndexOf('.');
            if (lastDotIndex !== -1) {
                return pathname.substring(lastDotIndex + 1).toLowerCase();
            }
        } catch {
            // URL 解析失败
        }
        return null;
    }
}
