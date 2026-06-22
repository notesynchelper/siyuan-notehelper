/**
 * 同步管理器
 * 负责管理整个同步流程
 */

import { logger } from '../utils/logger';
import { Article, SyncResult } from '../utils/types';
import { PluginSettings } from '../settings';
import { getItems } from '../api';
import { FileHandler } from './fileHandler';
import { IdIndex } from './idIndex';
import { templateNeedsContent } from '../settings/template';
import { checkAndUpdate } from '../updater';
import { computeEffectiveSyncAt } from './syncCursorAdjust';
import { SyncNoticeManager } from './SyncNoticeManager';

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
    async sync(isAutoSync: boolean = false): Promise<SyncResult> {
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
        const notice = new SyncNoticeManager();

        try {
            logger.debug('Starting sync...');
            notice.startSync();

            // 清除文档缓存，确保每次同步都是新的开始
            this.fileHandler.clearDocumentCache();

            // 构建全局 ID 索引（用于跨设备去重）
            const idIndex = new IdIndex();
            await idIndex.build();
            this.fileHandler.setIdIndex(idIndex);

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

            // 获取当前设备的同步游标（优先设备级，回退全局）
            const deviceId = this.getDeviceId();
            const rawSyncAt = this.settings.deviceSyncCursors?.[deviceId]
                || this.settings.syncAt
                || '';

            // 计算有效的同步时间（三重回退叠加）
            const effectiveSyncAt = computeEffectiveSyncAt(rawSyncAt, {
                syncTimeOffset: this.settings.syncTimeOffset,
                initialSyncCompleted: this.settings.initialSyncCompleted,
                frequency: this.settings.frequency,
                isAutoSync,
            });
            if (effectiveSyncAt) {
                logger.debug(`有效同步时间: ${rawSyncAt} -> ${effectiveSyncAt}`);
            }

            // 分批获取并处理文章
            const batchSize = 15;
            let hasMore = true;
            let offset = 0;
            const errors: string[] = [];
            let skippedCount = 0;
            let createdCount = 0;

            while (hasMore) {
                logger.debug(`Fetching batch ${offset / batchSize + 1}...`);

                const [articles, hasNextPage] = await getItems(
                    this.settings.endpoint,
                    this.settings.apiKey,
                    offset,
                    batchSize,
                    effectiveSyncAt,
                    this.settings.customQuery || undefined,
                    includeContent
                );

                // 批量处理本页文章（合并类排序后写入）
                const batchResult = await this.fileHandler.processArticleBatch(articles, notebookId);
                createdCount += batchResult.created;
                skippedCount += batchResult.skipped;
                errors.push(...batchResult.errors);

                notice.onBatchProcessed(articles.length, hasNextPage);
                hasMore = hasNextPage;
                offset += batchSize;

                if (offset > 1000) {
                    logger.warn('Reached maximum offset, stopping');
                    break;
                }
            }

            logger.debug(`Total processed. Created: ${createdCount}, Skipped: ${skippedCount}`);

            if (createdCount === 0 && skippedCount === 0 && errors.length === 0) {
                notice.showNoArticles();
            } else {
                notice.completeSync(createdCount);
            }

            // 更新同步时间（去掉毫秒以匹配服务端格式）
            const now = new Date();
            const nowStr = now.toISOString().replace(/\.\d{3}Z$/, 'Z');

            // ⚠️ 数据安全：仅当本次【没有任何错误】时才推进游标 + 标记首次同步完成。
            // 若有文章处理失败（典型：表格片段追加失败已回滚删除半成品文档），保持游标
            // 不前进，下次同步重新拉取同一窗口重试失败文章——否则游标越过失败文章 +
            // 半成品已被回滚删除 = 永久丢失该文章（绝不丢数据）。已成功的文章下轮会被
            // 去重跳过，冗余但不会重复/不会丢；新文章因窗口仍向后开放，照常拉取不被阻塞。
            if (errors.length === 0) {
                // 标记首次同步已完成——必须同样门控在「无错误」下。否则错误首跑就置位，
                // 会丢掉 computeEffectiveSyncAt 给初始同步的 1 天重叠窗口，导致重试漏掉
                // 只落在该重叠窗口里的失败文章。
                if (!this.settings.initialSyncCompleted) {
                    this.settings.initialSyncCompleted = true;
                    logger.debug('首次同步已完成，标记 initialSyncCompleted = true');
                }

                // 更新全局游标（向后兼容）
                this.settings.syncAt = nowStr;

                // 更新设备级游标
                if (!this.settings.deviceSyncCursors) {
                    this.settings.deviceSyncCursors = {};
                }
                this.settings.deviceSyncCursors[deviceId] = nowStr;
            } else {
                logger.warn(`[Sync] 本次有 ${errors.length} 个错误，保持游标不前进、不标记首次同步完成，下次重试失败文章（避免越过 → 永久丢失）`);
            }

            // 清理过期的设备游标
            this.cleanStaleDeviceCursors();

            await this.plugin.saveSettings();

            // 刷新文件树，确保新笔记立即显示
            await this.refreshFiletree();

            logger.debug(`Sync completed. Created: ${createdCount}, Skipped: ${skippedCount}, Errors: ${errors.length}`);

            return {
                success: errors.length === 0,
                count: createdCount,
                skipped: skippedCount,
                errors: errors.length > 0 ? errors : undefined,
            };
        } catch (error) {
            logger.error('Sync failed:', error);
            notice.showError(error);
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
     * 重置同步时间（同时重置当前设备游标）
     */
    async resetSyncTime(): Promise<void> {
        this.settings.syncAt = '';

        const deviceId = this.getDeviceId();
        if (this.settings.deviceSyncCursors) {
            this.settings.deviceSyncCursors[deviceId] = '';
        }
        this.settings.initialSyncCompleted = false;

        await this.plugin.saveSettings();
        logger.debug('Sync time reset (including device cursor)');
    }

    /**
     * 获取当前设备的唯一标识
     * 使用 localStorage 持久化（不跨设备同步，每台设备独有）
     */
    private getDeviceId(): string {
        const STORAGE_KEY = 'notehelper-device-id';
        try {
            let id = window.localStorage.getItem(STORAGE_KEY);
            if (!id) {
                const siyuanWindow = window as any;
                const os = siyuanWindow.siyuan?.config?.system?.os;
                const platform = (os === 'android' || os === 'ios') ? 'mobile' : 'desktop';
                id = `${platform}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
                window.localStorage.setItem(STORAGE_KEY, id);
                logger.info(`[SyncManager] 生成新设备ID: ${id}`);
            }
            return id;
        } catch {
            return `temp-${Math.random().toString(36).substring(2, 8)}`;
        }
    }

    /**
     * 清理超过 30 天未更新的设备游标
     */
    private cleanStaleDeviceCursors(): void {
        const cursors = this.settings.deviceSyncCursors;
        if (!cursors) return;

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        for (const [deviceId, cursor] of Object.entries(cursors)) {
            if (!cursor) continue;
            try {
                const cursorTime = new Date(cursor);
                if (!isNaN(cursorTime.getTime()) && cursorTime < thirtyDaysAgo) {
                    delete cursors[deviceId];
                    logger.debug(`[SyncManager] 清理过期设备游标: ${deviceId}`);
                }
            } catch {
                delete cursors[deviceId];
            }
        }
    }

    /**
     * 刷新文件树，确保新创建的笔记立即显示
     */
    private async refreshFiletree(): Promise<void> {
        try {
            if (this.settings.refreshIndexAfterSync) {
                // 方案2：强制刷新索引（用户勾选了"同步后刷新索引"）
                // 第一次刷新文件树
                await fetch('/api/filetree/refreshFiletree', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });

                // 等待一小段时间让索引完成
                await new Promise(resolve => setTimeout(resolve, 500));

                // 重新加载文件树 UI
                await fetch('/api/ui/reloadFiletree', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });

                logger.debug('Filetree refreshed with reloadFiletree');
            } else {
                // 方案1：默认只刷新文件树（不勾选）
                await fetch('/api/filetree/refreshFiletree', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });

                logger.debug('Filetree refreshed');
            }
        } catch (error) {
            logger.warn('Failed to refresh filetree:', error);
        }
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
                this.sync(true);
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
