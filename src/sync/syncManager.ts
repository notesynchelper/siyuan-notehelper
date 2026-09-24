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
import { computeEffectiveSyncAt } from './syncCursorAdjust';
import { SyncNoticeManager, NoticeFn } from './SyncNoticeManager';
import { getRuntime } from './runtimeAdapter';
import { SyncState, SyncStateAccess, createRuntimeStateAccess } from './syncState';

/**
 * 同步管理器类
 */
export interface SyncManagerDeps {
    /** 浏览器=siyuan showMessage；kernel=注入日志版（null=全静默） */
    notify?: NoticeFn | null;
    /** 自动同步开跑回调（浏览器端用于刷新 syncOnStart 冷却戳） */
    onAutoSyncStart?: () => void;
    /** 同步状态访问器（游标等）；缺省时经 runtime adapter 现场建立 */
    stateAccess?: SyncStateAccess;
    canWriteState?: () => boolean;
}

export class SyncManager {
    private plugin: any;  // SiYuan Plugin instance
    private settings: PluginSettings;
    private fileHandler: FileHandler;
    private isSyncing: boolean = false;
    private deps: SyncManagerDeps;
    private stateAccess: SyncStateAccess | null = null;

    constructor(plugin: any, settings: PluginSettings, deps: SyncManagerDeps = {}) {
        this.plugin = plugin;
        this.settings = settings;
        this.deps = deps;
        this.stateAccess = deps.stateAccess ?? null;
        this.fileHandler = new FileHandler(plugin, settings);
    }

    /** 入口在 onload 建好状态访问器后回填（避免首次 sync 才冷启动迁移） */
    setStateAccess(access: SyncStateAccess | null): void {
        this.stateAccess = access;
    }

    /** 惰性建状态访问器（constructor 期 runtime 可能尚未注入） */
    private async getStateAccess(): Promise<SyncStateAccess> {
        if (this.deps.canWriteState && !this.deps.canWriteState()) throw new Error('Local state ownership unavailable');
        if (!this.stateAccess) {
            const rt = getRuntime();
            this.stateAccess = await createRuntimeStateAccess(
                this.settings,
                (key: string) => rt.readFile(key),
                (key: string, content: string) => {
                    if (this.deps.canWriteState && !this.deps.canWriteState()) throw new Error('Local state ownership unavailable');
                    return rt.writeFile(key, content);
                },
            );
        }
        return this.stateAccess;
    }

    /**
     * 执行同步
     */
    async sync(isAutoSync: boolean = false): Promise<SyncResult> {
        // 插件更新检查已移至浏览器入口（performSync），kernel 无此副作用

        if (this.deps.canWriteState && !this.deps.canWriteState()) {
            return { success: false, count: 0, errors: ['Local state ownership unavailable'] };
        }
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

        // 自动同步（syncOnStart 触发 + 定时同步）刷新冷却时间戳，供下次 onload 的
        // shouldRunSyncOnStart 判定：手机端回前台重载若距此不足冷却期则跳过 syncOnStart，
        // 避免「每次切到前台都同步」。放在开头：即便本次同步中途失败，冷却也已生效，
        // 不会让失败的自动同步在每次回前台时反复重试刷屏。
        if (isAutoSync) {
            this.deps.onAutoSyncStart?.();
        }

        // 自动同步走静默模式：只在真有新笔记 / 抛错时提示，不再每周期弹进度条和
        // 「没有新文章需要同步」（v1.7.36 起的刷屏回归）。手动同步保留完整反馈。
        const notice = new SyncNoticeManager(isAutoSync, this.deps.notify ?? null);

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

            // 获取当前设备的同步游标（优先设备级，回退全局）——游标在 state 文件（方案 §5）
            const rt = getRuntime();
            const deviceId = await rt.getDeviceId();
            const syncState = await this.getStateAccess();
            const rawSyncAt = syncState.get().deviceSyncCursors[deviceId]
                || syncState.get().syncAt
                || '';

            // 计算有效的同步时间（三重回退叠加）
            const effectiveSyncAt = computeEffectiveSyncAt(rawSyncAt, {
                syncTimeOffset: this.settings.syncTimeOffset,
                initialSyncCompleted: syncState.get().initialSyncCompleted,
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
            // 合并类文章（微信/企微消息）先攒着，等所有分页拉完再统一排序写入。
            // 服务端按 updated_at DESC 分页，而合并是往文档尾部追加，只在页内排序会让跨页
            // 的同一天消息落成「段内升序、段间倒序」的乱序。攒的只有消息（体量小），
            // 普通文章仍逐页流式写入。
            const pendingMerges: Article[] = [];

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

                // 批量处理本页文章（合并类推迟到整轮拉完后统一排序写入）
                const batchResult = await this.fileHandler.processArticleBatch(
                    articles,
                    notebookId,
                    pendingMerges
                );
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

            // 所有分页拉完了，现在才写合并消息——排序作用域是「本轮全部消息」。
            if (pendingMerges.length > 0) {
                logger.debug(`[Sync] 统一写入 ${pendingMerges.length} 条合并消息（跨分页排序）`);
                const mergeResult = await this.fileHandler.processMergedArticles(pendingMerges, notebookId);
                createdCount += mergeResult.created;
                skippedCount += mergeResult.skipped;
                errors.push(...mergeResult.errors);
            }

            logger.debug(`Total processed. Created: ${createdCount}, Skipped: ${skippedCount}`);

            if (errors.length > 0) {
                // 有文章处理失败：即使自动同步也提示（游标已保持不前进、下轮重试），
                // 不被静默模式吞掉——失败的定时/启动同步若全程无声会让用户以为一切正常。
                notice.showPartialFailure(createdCount, errors.length);
            } else if (createdCount === 0 && skippedCount === 0) {
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
                if (!syncState.get().initialSyncCompleted) {
                    logger.debug('首次同步已完成，标记 initialSyncCompleted = true');
                }

                await syncState.commit((st: SyncState) => {
                    st.initialSyncCompleted = true;
                    // 全局游标 + 设备级游标（向后兼容字段）
                    st.syncAt = nowStr;
                    st.deviceSyncCursors[deviceId] = nowStr;
                    // 清理超过 30 天未更新的设备游标
                    this.cleanStaleDeviceCursorsInto(st);
                });
            } else {
                logger.warn(`[Sync] 本次有 ${errors.length} 个错误，保持游标不前进、不标记首次同步完成，下次重试失败文章（避免越过 → 永久丢失）`);
            }

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
            if (this.stateAccess) {
                const st = this.stateAccess.get();
                this.settings.syncAt = st.syncAt;
                this.settings.initialSyncCompleted = st.initialSyncCompleted;
            }
            this.isSyncing = false;
            this.settings.syncing = false;
        }
    }

    /**
     * 重置同步时间（同时重置当前设备游标）。
     * docker+kernel 模式下由前端改调 notehelperResetSyncCursor RPC（重置全部设备游标）；
     * 本地模式（桌面/手机）沿用「重置全局 + 当前设备」语义，落在 state 文件。
     */
    async resetSyncTime(): Promise<void> {
        await this.updateSyncCursor('');
        logger.debug('Sync time reset (including device cursor)');
    }

    /** 手工编辑全局和当前设备游标，避免旧设备游标覆盖用户输入。 */
    async updateSyncCursor(syncAt: string): Promise<void> {
        if (this.isSyncing) throw new Error('Sync in progress');
        if (syncAt && !Number.isFinite(Date.parse(syncAt))) throw new Error('Invalid sync cursor');
        this.isSyncing = true;
        try {
            const syncState = await this.getStateAccess();
            const deviceId = await getRuntime().getDeviceId();
            await syncState.commit((st: SyncState) => {
                st.syncAt = syncAt;
                st.deviceSyncCursors[deviceId] = syncAt;
                if (!syncAt) st.initialSyncCompleted = false;
            });
            this.settings.syncAt = syncState.get().syncAt;
            this.settings.initialSyncCompleted = syncState.get().initialSyncCompleted;
        } finally {
            this.isSyncing = false;
        }
    }

    /**
     * 清理超过 30 天未更新的设备游标（直接改入 state，调用方负责 commit）
     */
    private cleanStaleDeviceCursorsInto(st: SyncState): void {
        const cursors = st.deviceSyncCursors;
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
                await getRuntime().kernel('/api/filetree/refreshFiletree', {
                    method: 'POST',
                    body: JSON.stringify({})
                });

                // 等待一小段时间让索引完成
                await new Promise(resolve => setTimeout(resolve, 500));

                // 重新加载文件树 UI
                await getRuntime().kernel('/api/ui/reloadFiletree', {
                    method: 'POST',
                    body: JSON.stringify({})
                });

                logger.debug('Filetree refreshed with reloadFiletree');
            } else {
                // 方案1：默认只刷新文件树（不勾选）
                await getRuntime().kernel('/api/filetree/refreshFiletree', {
                    method: 'POST',
                    body: JSON.stringify({})
                });

                logger.debug('Filetree refreshed');
            }
        } catch (error) {
            logger.warn('Failed to refresh filetree:', error);
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
