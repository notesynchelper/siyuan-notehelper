/**
 * 同步管理器
 * 负责管理整个同步流程
 */

import { logger } from '../utils/logger';
import { Article, SyncResult } from '../utils/types';
import { PluginSettings } from '../settings';
import { getItems } from '../api';
import { FileHandler } from './fileHandler';
import { templateNeedsContent } from '../settings/template';
import { checkAndUpdate } from '../updater';

/**
 * 同步管理器类
 */
export class SyncManager {
    private plugin: any;  // SiYuan Plugin instance
    private settings: PluginSettings;
    private fileHandler: FileHandler;
    private isSyncing: boolean = false;

    constructor(plugin: any, settings: PluginSettings) {
        this.plugin = plugin;
        this.settings = settings;
        this.fileHandler = new FileHandler(plugin, settings);
    }

    /**
     * 执行同步
     */
    async sync(): Promise<SyncResult> {
        // 检查插件更新（不阻塞同步流程）
        checkAndUpdate().catch(() => {});

        if (this.isSyncing) {
            logger.warn('Sync already in progress');
            return {
                success: false,
                count: 0,
                errors: ['Sync already in progress'],
            };
        }

        this.isSyncing = true;
        this.settings.syncing = true;

        try {
            logger.debug('Starting sync...');

            // 清除文档缓存，确保每次同步都是新的开始
            this.fileHandler.clearDocumentCache();

            // 检查 API 密钥
            if (!this.settings.apiKey) {
                throw new Error('API key is not configured');
            }

            // 获取目标笔记本 ID
            const { notebookId, isDefault } = await this.fileHandler.getTargetNotebook();
            if (!notebookId) {
                throw new Error('No notebook available');
            }

            // 如果使用默认笔记本，提示用户去设置
            if (isDefault) {
                logger.info('Target notebook not configured, using default notebook');
            }

            // 确定是否需要获取文章内容
            const includeContent = templateNeedsContent(this.settings.template);

            // 分批获取文章
            const allArticles: Article[] = [];
            const batchSize = 15;
            let hasMore = true;
            let offset = 0;

            while (hasMore) {
                logger.debug(`Fetching batch ${offset / batchSize + 1}...`);

                const [articles, hasNextPage] = await getItems(
                    this.settings.endpoint,
                    this.settings.apiKey,
                    offset,
                    batchSize,
                    this.settings.syncAt || undefined,
                    this.settings.customQuery || undefined,
                    includeContent
                );

                allArticles.push(...articles);
                hasMore = hasNextPage;
                offset += batchSize;

                // 防止无限循环
                if (offset > 1000) {
                    logger.warn('Reached maximum offset, stopping');
                    break;
                }
            }

            logger.debug(`Total articles to process: ${allArticles.length}`);

            // 处理每篇文章
            const errors: string[] = [];
            let skippedCount = 0;
            let createdCount = 0;

            for (const article of allArticles) {
                try {
                    const result = await this.fileHandler.processArticle(article, notebookId);
                    if (result.skipped) {
                        skippedCount++;
                    } else {
                        createdCount++;
                    }
                } catch (error) {
                    const errorMsg = `Failed to process article ${article.id}: ${error}`;
                    logger.error(errorMsg);
                    errors.push(errorMsg);
                }
            }

            // 更新同步时间（去掉毫秒以匹配服务端格式）
            const now = new Date();
            this.settings.syncAt = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
            await this.plugin.saveData(this.settings);

            logger.debug(`Sync completed. Created: ${createdCount}, Skipped: ${skippedCount}, Errors: ${errors.length}`);

            return {
                success: errors.length === 0,
                count: createdCount,
                skipped: skippedCount,
                errors: errors.length > 0 ? errors : undefined,
            };
        } catch (error) {
            logger.error('Sync failed:', error);
            return {
                success: false,
                count: 0,
                errors: [String(error)],
            };
        } finally {
            this.isSyncing = false;
            this.settings.syncing = false;
        }
    }

    /**
     * 重置同步时间
     */
    async resetSyncTime(): Promise<void> {
        this.settings.syncAt = '';
        await this.plugin.saveData(this.settings);
        logger.debug('Sync time reset');
    }

    /**
     * 启动定时同步
     */
    startScheduledSync(): void {
        this.stopScheduledSync();

        if (this.settings.frequency > 0) {
            const intervalMs = this.settings.frequency * 60 * 1000;
            this.settings.intervalId = window.setInterval(() => {
                logger.debug('Running scheduled sync...');
                this.sync();
            }, intervalMs) as unknown as number;

            logger.debug(`Scheduled sync started: every ${this.settings.frequency} minutes`);
        }
    }

    /**
     * 停止定时同步
     */
    stopScheduledSync(): void {
        if (this.settings.intervalId) {
            window.clearInterval(this.settings.intervalId);
            this.settings.intervalId = 0;
            logger.debug('Scheduled sync stopped');
        }
    }

    /**
     * 是否正在同步
     */
    isCurrentlySyncing(): boolean {
        return this.isSyncing;
    }

    /**
     * 获取所有未关闭的笔记本列表
     * @returns {Promise<Array<{id: string, name: string}>>} 笔记本列表
     */
    async getAllNotebooks(): Promise<Array<{id: string, name: string}>> {
        return this.fileHandler.getAllNotebooks();
    }

    /**
     * 获取目标笔记本
     * @returns {Promise<{notebookId: string, isDefault: boolean}>} 笔记本ID和是否为默认
     */
    async getTargetNotebook(): Promise<{notebookId: string, isDefault: boolean}> {
        return this.fileHandler.getTargetNotebook();
    }
}
