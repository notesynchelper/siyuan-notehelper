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
    renderSingleFilename,
    renderFrontMatter,
} from '../settings/template';
import { MergeMode } from '../utils/types';
import { isWeChatMessage, extractDateFromWeChatTitle, sanitizeFileName } from '../utils/util';

/**
 * 文件处理器类
 */
export class FileHandler {
    private plugin: any;  // SiYuan Plugin instance
    private settings: PluginSettings;

    constructor(plugin: any, settings: PluginSettings) {
        this.plugin = plugin;
        this.settings = settings;
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
     * 合并文章到单个文件
     * @returns 返回 { docId: string, skipped: boolean }
     */
    private async mergeArticleToFile(article: Article, notebookId: string): Promise<{ docId: string, skipped: boolean }> {
        // 检查文章是否已存在（通过服务端 ID 去重）
        const existingArticleDocId = await this.checkDocumentBySourceId(article.id);
        if (existingArticleDocId) {
            logger.info(`Article ${article.id} already exists in merge mode, skipping`);
            return { docId: existingArticleDocId, skipped: true };
        }

        // 确定合并文件的名称
        const mergeDate = isWeChatMessage(article.title)
            ? extractDateFromWeChatTitle(article.title) || article.savedAt.split('T')[0]
            : article.savedAt.split('T')[0];

        const filename = renderSingleFilename(mergeDate, this.settings);
        const folderPath = renderFolderPath(article, this.settings);

        // 确保文件夹存在
        await this.ensureFolder(notebookId, folderPath);

        const docPath = `${folderPath}/${filename}`;

        // 检查合并目标文档是否已存在
        const existingDocId = await this.getDocumentByPath(notebookId, docPath);

        // 生成新内容
        const newContent = isWeChatMessage(article.title)
            ? renderWeChatMessage(article, this.settings)
            : renderArticleContent(article, this.settings);

        if (existingDocId) {
            // 文档存在，追加内容
            await this.appendToDocument(existingDocId, newContent);
            // 在追加的内容块上设置自定义属性标记
            await this.setBlockAttributes(existingDocId, article.id);
            logger.info(`Appended to document: ${docPath}`);
            return { docId: existingDocId, skipped: false };
        } else {
            // 文档不存在，创建新文档
            const frontMatter = renderFrontMatter(article, this.settings);
            const fullContent = frontMatter + newContent;
            const docId = await this.createDocument(notebookId, docPath, fullContent);
            // 设置自定义属性标记
            await this.setBlockAttributes(docId, article.id);
            logger.info(`Created merged document: ${docPath}`);
            return { docId, skipped: false };
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
            const response = await fetch('/api/filetree/getIDsByHPath', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    notebook: notebookId,
                    path: docPath,
                }),
            });

            const data = await response.json();

            if (data.code !== 0 || !data.data || data.data.length === 0) {
                return null;
            }

            return data.data[0];  // 返回第一个匹配的文档 ID
        } catch (error) {
            logger.error('Failed to get document by path:', error);
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

            return data.data.kramdown || '';
        } catch (error) {
            logger.error('Failed to get document content:', error);
            return '';
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
     * 设置块的自定义属性
     * @param blockId 块 ID
     * @param sourceId 服务端文章 ID
     */
    private async setBlockAttributes(blockId: string, sourceId: string): Promise<void> {
        try {
            const response = await fetch('/api/attr/setBlockAttrs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: blockId,
                    attrs: {
                        'custom-source-id': sourceId,
                    },
                }),
            });

            const data = await response.json();

            if (data.code !== 0) {
                throw new Error(`Failed to set block attributes: ${data.msg}`);
            }

            logger.debug(`Set custom-source-id attribute for block ${blockId}`);
        } catch (error) {
            logger.error('Failed to set block attributes:', error);
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
