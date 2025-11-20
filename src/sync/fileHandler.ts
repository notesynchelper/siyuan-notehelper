/**
 * 文件处理器
 * 负责在思源笔记中创建和更新文档
 */

import { logger } from '../utils/logger';
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
import { MergeMode } from '../utils/types';
import {
    isWeChatMessage,
    extractDateFromWeChatTitle,
    sanitizeFileName,
    formatDate,
    normalizePath,
    joinPath,
} from '../utils/util';

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

        if (mergeMode === MergeMode.NONE) {
            return false;
        } else if (mergeMode === MergeMode.MESSAGES) {
            return isWeChatMessage(article.title);
        } else if (mergeMode === MergeMode.ALL) {
            return true;
        }

        return false;
    }

    /**
     * 创建独立文件
     * @returns 返回 { docId: string, skipped: boolean }
     */
    private async createSeparateFile(article: Article, notebookId: string): Promise<{ docId: string, skipped: boolean }> {
        // 检查文档是否已存在（通过服务端 ID 去重）
        const existingDocId = await this.checkDocumentBySourceId(article.id);
        if (existingDocId) {
            logger.info(`Document already exists for article ${article.id}, skipping`);
            return { docId: existingDocId, skipped: true };
        }

        // 生成文件夹路径
        const folderPath = renderFolderPath(article, this.settings);

        // 确保文件夹存在
        await this.ensureFolder(notebookId, folderPath);

        // 生成文件名
        let filename = sanitizeFileName(renderFilename(article, this.settings));

        // 生成内容
        const frontMatter = renderFrontMatter(article, this.settings);
        const content = isWeChatMessage(article.title)
            ? renderWeChatMessage(article, this.settings)
            : renderArticleContent(article, this.settings);
        const fullContent = frontMatter + content;

        // 创建文档
        const docPath = `${folderPath}/${filename}`;
        const docId = await this.createDocument(notebookId, docPath, fullContent);

        // 设置自定义属性，用于后续去重
        await this.setBlockAttributes(docId, article.id);

        logger.info(`Created document: ${docPath}`);
        return { docId, skipped: false };
    }

    /**
     * 合并文章到单个文件（使用块属性去重）
     * @returns 返回 { docId: string, skipped: boolean }
     */
    private async mergeArticleToFile(article: Article, notebookId: string): Promise<{ docId: string, skipped: boolean }> {
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

        logger.info(`[mergeArticleToFile] Processing article for merge:`, {
            articleId: article.id,
            articleTitle: article.title,
            isWeChatMessage: isWeChatMessage(article.title),
            mergeDate: mergeDate,
            filename: filename,
            folderPath: folderPath,
            docPath: docPath
        });

        // 检查合并目标文档是否已存在
        const existingDocId = await this.getDocumentByPath(notebookId, docPath);

        logger.info(`[processMergedArticle] getDocumentByPath result:`, {
            existingDocId,
            existingDocIdType: typeof existingDocId,
            looksLikeTimestamp: typeof existingDocId === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(existingDocId)
        });

        if (existingDocId) {
            // 再次检查ID的有效性
            if (typeof existingDocId === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(existingDocId)) {
                logger.error(`[processMergedArticle] Invalid document ID detected (timestamp): ${existingDocId}`);
                logger.error(`[processMergedArticle] Creating new document instead of merging`);
                return await this.createMergedDocument(notebookId, docPath, article, mergeDate);
            }

            // 文档存在，使用块属性去重
            return await this.mergeToExistingDocument(existingDocId, article, docPath);
        } else {
            // 文档不存在，创建新文档（传递mergeDate确保一致性）
            return await this.createMergedDocument(notebookId, docPath, article, mergeDate);
        }
    }

    /**
     * 合并到已存在的文档（使用块属性去重）
     */
    private async mergeToExistingDocument(
        docId: string,
        article: Article,
        docPath: string
    ): Promise<{ docId: string, skipped: boolean }> {
        logger.info(`[mergeToExistingDocument] Starting merge for article:`, {
            docId,
            articleId: article.id,
            articleTitle: article.title,
            docPath
        });

        // 获取已合并的消息ID列表（从块属性读取）
        const mergedIds = await this.getMergedIds(docId);

        logger.info(`[mergeToExistingDocument] Found ${mergedIds.length} existing merged IDs`);

        // 检查文章是否已存在
        if (mergedIds.includes(article.id)) {
            logger.info(`[mergeToExistingDocument] Article ${article.id} already exists in ${docPath}, skipping`);
            return { docId, skipped: true };
        }

        // 新文章，追加内容
        logger.info(`[mergeToExistingDocument] Adding new article ${article.id} to ${docPath}`);

        try {
            // 获取现有文档内容
            const existingContent = await this.getDocumentContent(docId);

            logger.debug(`[mergeToExistingDocument] Existing content length: ${existingContent.length}`);

            // 生成新内容（根据消息类型使用不同渲染）
            const newContentPart = isWeChatMessage(article.title)
                ? renderWeChatMessageSimple(article, this.settings)
                : renderArticleContent(article, this.settings);

            // 添加分隔符
            const separator = existingContent.trim() ? '\n\n---\n\n' : '';

            // 拼接完整内容（无Front Matter）
            const newFullContent = `${existingContent}${separator}${newContentPart}`;

            logger.debug(`[mergeToExistingDocument] New content length: ${newFullContent.length}`);

            // 更新文档
            await this.updateDocument(docId, newFullContent);

            // 添加消息ID到块属性列表（重要：这必须在更新文档成功后执行）
            await this.addMergedId(docId, article.id);

            logger.info(`[mergeToExistingDocument] Successfully merged article ${article.id}`);
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
        logger.info(`[createMergedDocument] Creating new merged document:`, {
            notebookId,
            docPath,
            articleId: article.id,
            articleTitle: article.title,
            mergeDate: mergeDate
        });

        try {
            // 生成内容（根据消息类型使用不同渲染）
            const contentPart = isWeChatMessage(article.title)
                ? renderWeChatMessageSimple(article, this.settings)
                : renderArticleContent(article, this.settings);

            logger.debug(`[createMergedDocument] Generated content length: ${contentPart.length}`);

            // 创建文档（无Front Matter）
            const docId = await this.createDocument(notebookId, docPath, contentPart);

            if (!docId) {
                throw new Error('Failed to create document: no docId returned');
            }

            logger.info(`[createMergedDocument] Document created with ID: ${docId}`);

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
            await fetch('/api/attr/setBlockAttrs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: docId,
                    attrs: {
                        'custom-merge-doc': 'true',
                        'custom-creation-time': siyuanTimestamp,  // 使用思源格式而不是ISO格式
                        'custom-merge-date': mergeDate,  // 使用传入的mergeDate
                        'custom-merge-path': docPath,    // 添加路径属性便于调试
                    },
                }),
            });

            logger.info(`[createMergedDocument] Successfully created merged document: ${docPath}`);
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
            logger.info(`[updateDocument] Called with docId: ${docId}`);
            logger.info(`[updateDocument] DocId type: ${typeof docId}`);
            logger.info(`[updateDocument] DocId looks like timestamp: ${typeof docId === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(docId)}`);
            logger.info(`[updateDocument] Content length: ${content.length}`);

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

            logger.info(`[updateDocument] Content preview (first 500 chars):`, requestBody.data.substring(0, 500));
            logger.info(`[updateDocument] Content preview (last 500 chars):`, requestBody.data.substring(Math.max(0, requestBody.data.length - 500)));

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

            logger.info(`[updateDocument] Successfully updated document: ${docId}`);
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
                logger.info(`[getDocumentByPath] Found in cache: ${cachedId} for path: ${normalizedPath}`);
                return cachedId;
            }

            // 从路径提取文件名（不带.md扩展名）
            const filename = normalizedPath.split('/').pop() || '';
            const filenameWithoutExt = filename.replace(/\.md$/i, '');

            logger.info(`[getDocumentByPath] Searching for document:`, {
                notebookId,
                originalPath: docPath,
                normalizedPath: normalizedPath,
                filename: filenameWithoutExt
            });

            // 方法1：使用SQL查询，通过自定义属性查找合并文档
            // 先尝试通过 custom-merge-date 属性查找（更可靠）
            const mergeDate = filenameWithoutExt.match(/\d{4}-\d{2}-\d{2}/)?.[0];
            let sql = '';

            if (mergeDate) {
                // 如果能提取日期，使用日期属性查询（最可靠）
                sql = `
                    SELECT DISTINCT b.id, b.content, b.hpath
                    FROM blocks b
                    JOIN attributes a ON b.id = a.block_id
                    WHERE b.type = 'd'
                    AND b.box = '${notebookId}'
                    AND a.name = 'custom-merge-date'
                    AND a.value = '${mergeDate}'
                    ORDER BY b.created DESC
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

            logger.info(`[getDocumentByPath] SQL response:`, {
                code: data.code,
                dataLength: data.data ? data.data.length : 0
            });

            if (data.code !== 0 || !data.data || data.data.length === 0) {
                // 方法2：如果精确匹配失败，尝试使用原API
                logger.info(`[getDocumentByPath] SQL query found no results, trying filetree API`);

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

                logger.info(`[getDocumentByPath] Filetree API response:`, {
                    code: apiData.code,
                    dataLength: apiData.data ? apiData.data.length : 0,
                    data: apiData.data
                });

                if (apiData.code !== 0 || !apiData.data || apiData.data.length === 0) {
                    logger.info(`[getDocumentByPath] Document not found: ${normalizedPath}`);
                    return null;
                }

                const apiDocId = apiData.data[0];

                // 添加详细日志以诊断问题
                logger.info(`[getDocumentByPath] API data array:`, {
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

                logger.info(`[getDocumentByPath] Document found via API with ID: ${apiDocId}`);
                // 缓存结果
                this.documentCache.set(cacheKey, apiDocId);
                return apiDocId;
            }

            // SQL查询成功
            const docId = data.data[0].id;
            logger.info(`[getDocumentByPath] Document found via SQL with ID: ${docId}`, {
                hpath: data.data[0].hpath,
                content: data.data[0].content
            });
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

            logger.info(`[getDocumentContent] Original content length: ${content.length}`);
            logger.info(`[getDocumentContent] Content starts with: ${content.substring(0, 100)}`);

            // 移除文档级别的IAL属性（思源的 Inline Attribute List）
            // 格式为：---\n{: attr1="value1" attr2="value2" ...}\n
            // 这些IAL属性中的ISO时间戳会导致思源解析时报错 "found invalid ID [2025-xx-xxTxx:xx:xx.xxxZ]"
            // 只移除文档开头的IAL，保留内容中的其他部分
            const originalLength = content.length;
            content = this.removeDocumentIAL(content);

            logger.info(`[getDocumentContent] After IAL removal - length: ${content.length}, removed: ${originalLength - content.length} chars`);
            logger.info(`[getDocumentContent] Content now starts with: ${content.substring(0, 100)}`);

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
            logger.info('[removeDocumentIAL] Removed document-level IAL with --- prefix');
        }

        // 步骤2: 移除所有块级IAL（{: ...}\n格式）
        // 这些IAL通常紧跟在块（标题、段落等）之后
        // 格式如：{: id="20251120112342-fg8fppm" updated="20251120112342"}
        const blockIALPattern = /\n\{:[^}]*\}\s*\n/g;
        const blockIALMatches = cleaned.match(blockIALPattern);
        if (blockIALMatches) {
            logger.info(`[removeDocumentIAL] Found ${blockIALMatches.length} block-level IAL attributes`);
            cleaned = cleaned.replace(blockIALPattern, '\n');
            logger.info('[removeDocumentIAL] Removed all block-level IAL attributes');
        }

        // 步骤3: 移除可能在行末的IAL（例如：## 标题{: id="xxx"}）
        const inlineIALPattern = /\{:[^}]*\}/g;
        const inlineIALMatches = cleaned.match(inlineIALPattern);
        if (inlineIALMatches) {
            logger.info(`[removeDocumentIAL] Found ${inlineIALMatches.length} inline IAL attributes`);
            cleaned = cleaned.replace(inlineIALPattern, '');
            logger.info('[removeDocumentIAL] Removed all inline IAL attributes');
        }

        const removedChars = originalLength - cleaned.length;
        if (removedChars > 0) {
            logger.info(`[removeDocumentIAL] Total removed: ${removedChars} chars`);
        } else {
            logger.info('[removeDocumentIAL] No IAL attributes found');
        }

        return cleaned;
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

            logger.info(`[addMergedId] Successfully added article ${articleId} to merged list (total: ${mergedIds.length})`);
        } catch (error) {
            logger.error('Failed to add merged ID:', error);
            throw error;
        }
    }

    /**
     * 获取默认笔记本 ID
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
}
