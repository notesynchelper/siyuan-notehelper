/**
 * 笔记同步助手 - 思源笔记插件
 * 主入口文件
 */

import {
    Plugin,
    showMessage,
    confirm,
    Dialog,
    Menu,
    Setting,
} from 'siyuan';
import './index.scss';

import { logger, LogLevel } from './utils/logger';
import { PluginSettings, DEFAULT_SETTINGS } from './settings';
import { SyncManager } from './sync/syncManager';
import { ImageLocalizer } from './imageLocalizer/imageLocalizer';
import { getArticleCount, clearAllArticles, fetchVipStatus, getQrCodeUrl, VipStatus } from './api';
import { formatDate } from './utils/util';
import { SettingsForm } from './ui/SettingsForm';
import { checkAndUpdate } from './updater';

const SETTINGS_KEY = 'notehelper-settings';
const DOCK_TYPE = 'notehelper_sync_dock';

// 中文文本定义（替代i18n）
const zhCN = {
    name: "笔记同步助手",  // SiYuan 可能期望的 name 属性
    pluginName: "笔记同步助手",
    pluginDescription: "从微信同步到思源笔记,支持文字、图片、聊天记录、文章",

    sync: "同步",
    syncing: "同步中...",
    syncComplete: "同步完成",
    syncFailed: "同步失败",
    syncNow: "立即同步",
    resetSync: "重置同步时间",
    resetSyncConfirm: "确认重置同步时间？这将在下次同步时获取所有文章。",
    lastSyncAt: "上次同步时间",
    noSyncYet: "尚未同步",

    settings: "设置",
    save: "保存",
    cancel: "取消",
    delete: "删除",
    confirm: "确认",

    basicSettings: "基础设置",
    apiKey: "API 密钥",
    apiKeyDesc: "你的笔记同步服务 API 密钥",
    endpoint: "服务端点",
    endpointDesc: "笔记同步服务器地址",
    filter: "过滤器",
    filterDesc: "同步文章的过滤条件",
    customQuery: "自定义查询",
    customQueryDesc: "高级用户可以自定义 GraphQL 查询",

    syncSettings: "同步设置",
    lastSyncTimeEdit: "最后同步时间",
    lastSyncTimeEditDesc: "手动设置最后同步时间，影响增量同步起点",
    frequency: "定时同步频率",
    frequencyDesc: "自动同步间隔（分钟），0 表示禁用",
    syncOnStart: "启动时同步",
    syncOnStartDesc: "思源笔记启动时自动同步",
    mergeMode: "合并模式",
    mergeModeNone: "不合并（每篇文章独立文件）",
    mergeModeMessages: "仅合并企微消息",
    mergeModeAll: "合并所有文章到单个文件",

    folderSettings: "笔记同步位置",
    targetNotebook: "目标笔记本",
    targetNotebookDesc: "选择同步内容保存到哪个笔记本",
    folder: "目标文件夹",
    folderDesc: "文章保存的文件夹路径（支持模板变量）",
    folderDateFormat: "文件夹日期格式",
    filename: "文件名模板",
    filenameDesc: "文件名格式（支持模板变量）",
    filenameDateFormat: "文件名日期格式",
    singleFileName: "单文件模式文件名",
    singleFileDateFormat: "单文件日期格式",
    attachmentFolder: "附件文件夹",

    mergeSettings: "合并消息设置",
    mergeFolderTemplate: "合并消息路径模板",
    mergeFolderTemplateDesc: "支持 {{{date}}} 占位符，日期格式根据 mergeFolderDateFormat 设置",
    mergeMessageTemplate: "合并消息格式模板",
    mergeMessageTemplateDesc: "支持 Mustache 变量：{{{dateSaved}}}, {{{content}}}。使用 --- 作为消息分隔符",

    templateSettings: "模板设置",
    template: "内容模板",
    templateDesc: "使用 Mustache 语法自定义文章渲染模板",
    frontMatterTemplate: "前言模板",
    frontMatterVariables: "笔记自定义属性",
    wechatMessageTemplate: "企微消息模板",
    sectionSeparator: "消息分隔符开始",
    sectionSeparatorEnd: "消息分隔符结束",

    dateSettings: "日期和时间",
    dateHighlightedFormat: "高亮日期格式",
    dateSavedFormat: "保存日期格式",

    highlightSettings: "高亮设置",
    highlightOrder: "高亮排序",
    highlightOrderLocation: "按文章中的位置",
    highlightOrderTime: "按更新时间",
    enableHighlightColorRender: "启用高亮颜色渲染",
    highlightColorMapping: "高亮颜色映射",

    imageSettings: "图片处理",
    imageMode: "图片处理模式",
    imageModeLocal: "本地缓存（下载到本地）",
    imageModeRemote: "保留原始链接（默认）",
    imageModeDisabled: "禁用（注释掉图片）",
    imageModeProxy: "使用在线图床",
    imageModeDesc: "选择如何处理笔记中的图片",
    imageModeProxyWarning: "⚠️ 开启后需要海外网络环境才能正常加载图片",
    imageAttachmentFolder: "图片存储文件夹",
    enablePngToJpeg: "PNG 转 JPEG",
    jpegQuality: "JPEG 质量",
    imageDownloadRetries: "图片下载重试次数",
    imageAttachmentFolderDesc: "本地缓存模式下图片的存储路径，支持 {{{date}}} 变量",

    // 附件设置
    attachmentSettings: "附件设置",
    attachmentFolder: "附件存储位置",
    attachmentFolderDesc: "文件附件的默认存储路径",

    articleManagement: "文章管理",
    viewArticleCount: "查看云空间文章数量",
    articleCount: "云空间共有 {count} 篇文章",
    deleteCurrentArticle: "删除当前文章",
    deleteCurrentArticleConfirm: "确认从云空间删除当前文章？",
    clearAllArticles: "清空云空间所有文章",
    clearAllArticlesConfirm: "确认清空云空间的所有文章？此操作不可恢复！",

    errors: {
        noApiKey: "请先在设置中配置 API 密钥",
        syncInProgress: "同步正在进行中，请稍后再试",
        networkError: "网络错误，请检查网络连接",
        apiError: "API 调用失败",
        fileError: "文件操作失败",
        imageDownloadFailed: "图片下载失败",
        templateError: "模板渲染错误"
    },

    success: {
        settingsSaved: "设置已保存",
        syncCompleted: "同步完成，共处理 {count} 篇文章",
        articleDeleted: "文章已删除",
        articlesCleared: "云空间已清空"
    },

    commands: {
        sync: "同步笔记",
        resetSync: "重置同步时间",
        openSettings: "打开设置"
    },

    dock: {
        title: "同步",
        status: "状态",
        quickSync: "立即同步"
    },

    tips: {
        templateVariables: "可用变量：{title}、{content}、{author}、{date}、{tags} 等",
        dateFormat: "日期格式使用 Luxon 语法，如：yyyy-MM-dd HH:mm:ss",
        mergeMode: "合并模式决定如何组织文章：独立文件、按日期合并企微消息、或全部合并",
        wechatMessage: "企微消息格式：同步助手_yyyyMMdd_xxx_类型"
    },

    // 新增：会员中心
    vipCenter: "会员中心",
    vipStatusLoading: "加载中...",
    vipBuyLabel: "购买高级权益",
    vipGroupLabel: "加入交流群",

    // 新增：文章管理增强
    articleCountDesc: "显示云空间中文章和消息的总数量",
    refreshing: "刷新中...",
    clearing: "清空中...",

    // 新增：高级设置
    advancedSettings: "高级设置",
    frontMatterVariablesDesc: "自定义思源文档属性。默认包含 note-helper（笔记同步助手）和 note-helper-type（链接/消息）",
    wechatMessageTemplateDesc: "可用变量：{{{dateSaved}}}, {{{content}}}, {{{title}}}, {{{id}}}",
    frontMatterTemplateDesc: "输入 YAML 模板来渲染前置元数据",
    dateSavedFormatDesc: "dateSaved 变量的日期格式",

    // 新增：图片处理
    imageModeDesc: "选择如何处理笔记中的图片",
    enablePngToJpegDesc: "将PNG图片转换为JPEG格式以节省空间",
    jpegQualityDesc: "设置JPEG压缩质量（0-100），默认85",
    imageDownloadRetriesDesc: "图片下载失败时的重试次数",
    imageAttachmentFolderDesc: "本地化图片的存储路径，支持 {{{date}}} 变量",

    // 新增：版本检查
    currentVersion: "当前版本",
    checkUpdate: "检查更新",
    checkingUpdate: "检查中...",
    latestVersion: "已是最新版本",
    newVersionAvailable: "发现新版本",
    updateCheckFailed: "检查失败"
};

export default class NoteHelperPlugin extends Plugin {

    private settings: PluginSettings;
    private syncManager: SyncManager;
    private imageLocalizer: ImageLocalizer;
    private statusBarElement: HTMLElement;
    private dockElement: HTMLElement;

    // 初始化 i18n - 在类定义时就设置，避免 SiYuan 访问时为 null
    public i18n = {
        zh_CN: zhCN
    };

    async onload() {
        // 先设置默认日志级别（生产环境使用INFO）
        logger.setLevel(LogLevel.INFO);
        logger.debug('Loading Note Sync Helper plugin...');

        // 注册自定义图标 - 使用"同"字
        this.addIcons(`
<symbol id="iconNoteSync" viewBox="0 0 32 32">
  <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
        font-size="30" font-weight="bold" font-family="system-ui, -apple-system, sans-serif"
        fill="currentColor">同</text>
</symbol>
`);

        // 加载设置
        await this.loadSettings();

        // 根据设置更新日志级别
        this.updateLogLevel();

        // 初始化管理器
        this.syncManager = new SyncManager(this, this.settings);
        this.imageLocalizer = new ImageLocalizer(this, this.settings);

        // 注册命令
        this.registerCommands();

        // 启动时同步 - 延长延迟时间，减少启动时的资源占用
        if (this.settings.syncOnStart) {
            setTimeout(() => {
                this.performSync();
            }, 10000); // 延长到10秒，让思源笔记先完成启动
        }

        // 启动定时同步
        if (this.settings.frequency > 0) {
            this.syncManager.startScheduledSync();
        }

        logger.debug('Note Sync Helper plugin loaded successfully');
    }

    async onLayoutReady() {
        logger.debug('Layout ready');

        // 添加顶栏图标
        this.addTopBarIcon();

        // 添加状态栏
        this.addStatusBarIcon();

        // 立即添加左侧栏同步dock
        this.addSyncDock();
    }

    async onunload() {
        logger.debug('Unloading Note Sync Helper plugin...');

        // 停止定时同步
        this.syncManager.stopScheduledSync();
    }

    /**
     * 卸载插件时的清理操作
     * 删除插件配置数据
     */
    async uninstall() {
        logger.debug('Uninstalling Note Sync Helper plugin...');

        // 删除插件配置文件
        await this.removeData(SETTINGS_KEY);

        logger.info('Plugin configuration removed');
    }

    /**
     * 添加顶栏图标
     */
    private addTopBarIcon() {
        const topBarElement = this.addTopBar({
            icon: 'iconRefresh',
            title: this.i18n.zh_CN.sync,
            position: 'right',
            callback: () => {
                let rect = topBarElement.getBoundingClientRect();
                // 如果被隐藏，则使用更多按钮
                if (rect.width === 0) {
                    rect = document.querySelector('#barMore')?.getBoundingClientRect();
                }
                if (rect.width === 0) {
                    rect = document.querySelector('#barPlugins')?.getBoundingClientRect();
                }
                this.showMenu(rect);
            },
        });
    }

    /**
     * 添加状态栏图标
     */
    private addStatusBarIcon() {
        const statusElement = document.createElement('div');
        statusElement.className = 'toolbar__item ariaLabel';
        this.statusBarElement = statusElement;

        this.statusBarElement.addEventListener('click', () => {
            this.openSettings();
        });

        this.addStatusBar({
            element: this.statusBarElement,
            position: 'right',
        });

        this.updateStatusBar();
    }

    /**
     * 更新状态栏
     */
    private updateStatusBar() {
        if (!this.statusBarElement) return;

        if (this.settings.syncing) {
            this.statusBarElement.textContent = this.i18n.zh_CN.syncing;
            this.statusBarElement.setAttribute('aria-label', this.i18n.zh_CN.syncing);
        } else if (this.settings.syncAt) {
            const lastSync = formatDate(this.settings.syncAt, 'yyyy-MM-dd HH:mm');
            this.statusBarElement.textContent = `${this.i18n.zh_CN.lastSyncAt}: ${lastSync}`;
            this.statusBarElement.setAttribute('aria-label', `${this.i18n.zh_CN.lastSyncAt}: ${lastSync}`);
        } else {
            this.statusBarElement.textContent = this.i18n.zh_CN.noSyncYet;
            this.statusBarElement.setAttribute('aria-label', this.i18n.zh_CN.noSyncYet);
        }

        // 同时更新dock状态
        this.updateDockStatus();
    }

    /**
     * 添加左侧栏同步dock
     */
    private addSyncDock() {
        this.addDock({
            config: {
                position: "LeftTop",
                size: { width: 300, height: 0 },
                icon: "iconNoteSync",
                title: "笔记同步助手",
            },
            data: {},
            type: DOCK_TYPE,
            init: (dock) => {
                this.dockElement = dock.element;

                // 检查插件更新
                checkAndUpdate();

                // 先渲染基础UI，延迟加载设置表单
                dock.element.innerHTML = `
                    <div class="fn__flex-1 fn__flex-column" style="padding: 8px; overflow-y: auto;">
                        <div class="block__icons">
                            <div class="block__logo">
                                <svg class="block__logoicon"><use xlink:href="#iconNoteSync"></use></svg>
                                笔记同步助手
                            </div>
                        </div>

                        <!-- 同步状态和操作区域 -->
                        <div style="padding: 12px 8px; border-bottom: 1px solid var(--b3-border-color);">
                            <div style="margin-bottom: 12px;">
                                <div style="color: var(--b3-theme-on-surface); margin-bottom: 4px; font-size: 12px;">
                                    ${this.i18n.zh_CN.dock?.status || "状态"}:
                                </div>
                                <div id="dockSyncStatus" style="font-size: 12px; color: var(--b3-theme-on-background);">
                                    ${this.i18n.zh_CN.noSyncYet}
                                </div>
                            </div>
                            <button class="b3-button b3-button--outline fn__block" id="dockQuickSync">
                                <svg class="b3-button__icon"><use xlink:href="#iconNoteSync"></use></svg>
                                ${this.i18n.zh_CN.dock?.quickSync || "立即同步"}
                            </button>
                        </div>

                        <!-- 设置表单区域 - 初始为加载中状态 -->
                        <div id="settingsFormArea" style="padding: 12px 8px;">
                            <div style="text-align: center; color: var(--b3-theme-on-surface-light);">
                                加载设置中...
                            </div>
                        </div>
                    </div>
                `;

                // 绑定快速同步按钮
                const quickSyncBtn = dock.element.querySelector('#dockQuickSync') as HTMLButtonElement;
                quickSyncBtn?.addEventListener('click', () => {
                    this.performSync();
                });

                // 初始化状态显示
                this.updateDockStatus();

                // 立即加载设置表单
                const settingsArea = dock.element.querySelector('#settingsFormArea');
                if (settingsArea) {
                    settingsArea.innerHTML = `
                        <div style="margin-bottom: 8px; font-weight: bold; color: var(--b3-theme-on-surface);">
                            ${this.i18n.zh_CN.settings}
                        </div>
                        ${SettingsForm.renderSettingsForm(this.settings, this.i18n.zh_CN, () => this.formatSyncTimeForInput())}
                    `;

                    // 设置当前版本（已禁用）
                    // SettingsForm.setCurrentVersion(settingsArea as HTMLElement, this.manifest?.version || '1.0.0');

                    // 绑定动态交互事件
                    SettingsForm.bindEvents(settingsArea as HTMLElement, {
                        onApiKeyChange: async (apiKey: string) => {
                            await this.updateVipStatusDisplay(settingsArea as HTMLElement);
                        },
                        onRefreshArticleCount: async () => {
                            await this.refreshArticleCount(settingsArea as HTMLElement);
                        },
                        onClearAllArticles: async () => {
                            await this.handleClearAllArticles(settingsArea as HTMLElement);
                        },
                        // onCheckUpdate: async () => {  // 检查更新已禁用
                        //     await this.checkForUpdates(settingsArea as HTMLElement);
                        // },
                        onResetTemplate: (type) => {
                            this.resetTemplate(settingsArea as HTMLElement, type);
                        }
                    });

                    // 初始化VIP状态
                    if (this.settings.apiKey) {
                        this.updateVipStatusDisplay(settingsArea as HTMLElement);
                    }

                    // 加载笔记本列表
                    this.loadNotebookOptions(settingsArea as HTMLElement);

                    // 为所有输入框添加自动保存功能（使用防抖减少频繁保存）
                    let saveTimeout: any = null;
                    const formInputs = settingsArea.querySelectorAll('input, select, textarea');
                    formInputs.forEach((input) => {
                        input.addEventListener('change', async () => {
                            // 清除之前的定时器
                            if (saveTimeout) {
                                clearTimeout(saveTimeout);
                            }

                            // 设置新的定时器，延迟500ms保存
                            saveTimeout = setTimeout(async () => {
                                await this.saveSettingsFromContainer(dock.element);

                                // 重启定时同步
                                this.syncManager.stopScheduledSync();
                                if (this.settings.frequency > 0) {
                                    this.syncManager.startScheduledSync();
                                }
                            }, 500);
                        });
                    });
                }
            },
        });
    }

    /**
     * 更新dock状态显示
     */
    private updateDockStatus() {
        if (!this.dockElement) return;

        const statusElement = this.dockElement.querySelector('#dockSyncStatus');
        if (!statusElement) return;

        if (this.settings.syncing) {
            statusElement.textContent = this.i18n.zh_CN.syncing;
        } else if (this.settings.syncAt) {
            const lastSync = formatDate(this.settings.syncAt, 'yyyy-MM-dd HH:mm');
            statusElement.textContent = `${this.i18n.zh_CN.lastSyncAt}: ${lastSync}`;
        } else {
            statusElement.textContent = this.i18n.zh_CN.noSyncYet;
        }

        // 同时更新设置表单中的同步时间输入框
        const syncAtInput = this.dockElement.querySelector('#syncAt') as HTMLInputElement;
        if (syncAtInput) {
            syncAtInput.value = this.formatSyncTimeForInput();
        }
    }

    /**
     * 显示菜单
     */
    private showMenu(rect: DOMRect) {
        const menu = new Menu('noteHelperMenu');

        menu.addItem({
            icon: 'iconRefresh',
            label: this.i18n.zh_CN.syncNow,
            click: () => {
                this.performSync();
            },
        });

        menu.addItem({
            icon: 'iconUndo',
            label: this.i18n.zh_CN.resetSync,
            click: () => {
                this.resetSyncTime();
            },
        });

        menu.addSeparator();

        menu.addItem({
            icon: 'iconInfo',
            label: this.i18n.zh_CN.viewArticleCount,
            click: () => {
                this.viewArticleCount();
            },
        });

        menu.addItem({
            icon: 'iconTrash',
            label: this.i18n.zh_CN.clearAllArticles,
            click: () => {
                this.clearAllArticles();
            },
        });

        menu.addSeparator();

        menu.addItem({
            icon: 'iconSettings',
            label: this.i18n.zh_CN.settings,
            click: () => {
                this.openSettings();
            },
        });

        menu.open({
            x: rect.right,
            y: rect.bottom,
            isLeft: true,
        });
    }

    /**
     * 注册命令
     */
    private registerCommands() {
        // 同步命令
        this.addCommand({
            langKey: 'sync',
            hotkey: '⌘⇧S',
            callback: () => {
                this.performSync();
            },
        });

        // 重置同步时间
        this.addCommand({
            langKey: 'resetSync',
            hotkey: '',
            callback: () => {
                this.resetSyncTime();
            },
        });

        // 打开设置
        this.addCommand({
            langKey: 'openSettings',
            hotkey: '',
            callback: () => {
                this.openSettings();
            },
        });
    }

    /**
     * 执行同步
     */
    private async performSync() {
        if (this.syncManager.isCurrentlySyncing()) {
            showMessage(this.i18n.zh_CN.errors?.syncInProgress || 'Sync in progress', 3000, 'info');
            return;
        }

        if (!this.settings.apiKey) {
            showMessage(this.i18n.zh_CN.errors?.noApiKey || 'No API key configured', 5000, 'error');
            return;
        }

        try {
            this.updateStatusBar();

            // 检查是否设置了目标笔记本
            if (!this.settings.targetNotebook) {
                showMessage('请在设置中选择目标笔记本，当前使用默认笔记本', 5000, 'info');
            }

            showMessage(this.i18n.zh_CN.syncing, 3000, 'info');

            const result = await this.syncManager.sync();

            if (result.success) {
                let message = (this.i18n.zh_CN.success?.syncCompleted || 'Sync completed, processed {count} articles')
                    .replace('{count}', String(result.count));

                // 添加跳过数量信息
                if (result.skipped && result.skipped > 0) {
                    message += `，跳过 ${result.skipped} 个重复`;
                }

                showMessage(message, 5000, 'info');
            } else {
                showMessage(
                    this.i18n.zh_CN.syncFailed + ': ' + (result.errors?.join(', ') || ''),
                    5000,
                    'error'
                );
            }

            this.updateStatusBar();
        } catch (error) {
            logger.error('Sync error:', error);
            showMessage(this.i18n.zh_CN.syncFailed + ': ' + error, 5000, 'error');
            this.updateStatusBar();
        }
    }

    /**
     * 重置同步时间
     */
    private resetSyncTime() {
        confirm(
            this.i18n.zh_CN.confirm,
            this.i18n.zh_CN.resetSyncConfirm,
            () => {
                this.syncManager.resetSyncTime().then(() => {
                    this.updateStatusBar();
                    showMessage(this.i18n.zh_CN.success?.settingsSaved || 'Settings saved', 3000, 'info');
                }).catch((error) => {
                    logger.error('Failed to reset sync time:', error);
                    showMessage(this.i18n.zh_CN.errors?.apiError || 'API call failed', 5000, 'error');
                });
            }
        );
    }

    /**
     * 查看文章数量
     */
    private async viewArticleCount() {
        if (!this.settings.apiKey) {
            showMessage(this.i18n.zh_CN.errors?.noApiKey || 'No API key configured', 5000, 'error');
            return;
        }

        try {
            const count = await getArticleCount(
                this.settings.endpoint,
                this.settings.apiKey
            );

            const message = (this.i18n.zh_CN.articleCount || 'Total {count} articles in cloud')
                .replace('{count}', String(count));
            showMessage(message, 5000, 'info');
        } catch (error) {
            logger.error('Failed to get article count:', error);
            showMessage(this.i18n.zh_CN.errors?.apiError || 'API call failed', 5000, 'error');
        }
    }

    /**
     * 清空所有文章
     */
    private clearAllArticles() {
        confirm(
            this.i18n.zh_CN.confirm,
            this.i18n.zh_CN.clearAllArticlesConfirm,
            () => {
                if (!this.settings.apiKey) {
                    showMessage(this.i18n.zh_CN.errors?.noApiKey || 'No API key configured', 5000, 'error');
                    return;
                }

                clearAllArticles(this.settings.endpoint, this.settings.apiKey)
                    .then(() => {
                        showMessage(this.i18n.zh_CN.success?.articlesCleared || 'Articles cleared', 5000, 'info');
                    })
                    .catch((error) => {
                        logger.error('Failed to clear articles:', error);
                        showMessage(this.i18n.zh_CN.errors?.apiError || 'API call failed', 5000, 'error');
                    });
            }
        );
    }

    /**
     * 格式化同步时间为datetime-local输入框格式
     */
    private formatSyncTimeForInput(): string {
        if (!this.settings.syncAt) {
            return '';
        }
        try {
            const date = new Date(this.settings.syncAt);
            // 转换为本地时间的datetime-local格式: YYYY-MM-DDTHH:mm
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            return `${year}-${month}-${day}T${hours}:${minutes}`;
        } catch (e) {
            logger.error('Failed to format sync time:', e);
            return '';
        }
    }

    /**
     * 打开设置
     * 提示用户设置已移到dock面板
     */
    private openSettings() {
        showMessage(
            '设置已移到左侧栏的「笔记同步助手」面板中，请点击左侧栏的"同"字图标打开。\n\nSettings have been moved to the "Note Sync Helper" panel in the left sidebar. Please click the "同" icon in the left sidebar to open it.',
            7000,
            'info'
        );
    }

    /**
     * 创建设置面板（已废弃，保留用于兼容性）
     * @deprecated 设置已移到dock面板
     */
    private createSettingsPanel(container: HTMLElement, dialog: Dialog) {
        // 此方法已废弃，设置已移到dock面板
        // 保留此方法只为向后兼容
    }

    /**
     * 从对话框保存设置
     */
    /**
     * 从容器中保存设置（通用方法，可用于对话框或dock面板）
     */
    private async saveSettingsFromContainer(container: HTMLElement) {
        // 使用SettingsForm提取表单值
        const values = SettingsForm.extractFormValues(container);

        // 更新设置对象
        Object.assign(this.settings, values);

        // 保存到存储
        await this.saveSettings();

        // 更新状态栏显示
        this.updateStatusBar();
    }

    /**
     * @deprecated 使用 saveSettingsFromContainer 代替
     */
    private async saveSettingsFromDialog(container: HTMLElement) {
        await this.saveSettingsFromContainer(container);
    }

    /**
     * 加载设置
     */
    private async loadSettings() {
        const savedSettings = await this.loadData(SETTINGS_KEY);
        this.settings = {
            ...DEFAULT_SETTINGS,
            ...savedSettings,
        };
        logger.debug('Settings loaded');
    }

    /**
     * 保存设置
     */
    async saveSettings() {
        await this.saveData(SETTINGS_KEY, this.settings);
        logger.debug('Settings saved');
        // 更新日志级别
        this.updateLogLevel();
    }

    /**
     * 根据设置更新日志级别
     */
    private updateLogLevel() {
        const levelMap: { [key: string]: LogLevel } = {
            'DEBUG': LogLevel.DEBUG,
            'INFO': LogLevel.INFO,
            'WARN': LogLevel.WARN,
            'ERROR': LogLevel.ERROR,
        };

        const level = levelMap[this.settings.logLevel] || LogLevel.INFO;
        logger.setLevel(level);
        logger.debug(`Log level set to: ${this.settings.logLevel}`);
    }

    /**
     * 加载笔记本选项列表
     */
    private async loadNotebookOptions(container: HTMLElement) {
        try {
            const notebooks = await this.syncManager.getAllNotebooks();
            SettingsForm.updateNotebookOptions(
                container,
                notebooks,
                this.settings.targetNotebook
            );
        } catch (error) {
            logger.error('Failed to load notebooks:', error);
        }
    }

    /**
     * 更新VIP状态显示
     */
    private async updateVipStatusDisplay(container: HTMLElement) {
        if (!this.settings.apiKey) {
            return;
        }

        try {
            const vipStatus = await fetchVipStatus(this.settings.apiKey);

            // 根据VIP状态决定显示哪个二维码
            const qrType = vipStatus.isValid &&
                (vipStatus.vipType === 'obvip' || vipStatus.vipType === 'obvvip')
                ? 'group' : 'vip';

            const qrCodeUrl = getQrCodeUrl(qrType);
            const qrLabel = qrType === 'group'
                ? this.i18n.zh_CN.vipGroupLabel
                : this.i18n.zh_CN.vipBuyLabel;

            SettingsForm.updateVipStatus(container, vipStatus, qrCodeUrl, qrLabel);
        } catch (error) {
            logger.error('Failed to update VIP status:', error);
        }
    }

    /**
     * 刷新文章数量
     */
    private async refreshArticleCount(container: HTMLElement) {
        if (!this.settings.apiKey) {
            showMessage(this.i18n.zh_CN.errors?.noApiKey || 'No API key configured', 5000, 'error');
            return;
        }

        const refreshBtn = container.querySelector('#refreshArticleCount') as HTMLButtonElement;
        if (refreshBtn) {
            refreshBtn.disabled = true;
            refreshBtn.textContent = this.i18n.zh_CN.refreshing || '刷新中...';
        }

        try {
            const count = await getArticleCount(
                this.settings.endpoint,
                this.settings.apiKey
            );
            SettingsForm.updateArticleCount(container, count);
            showMessage(`当前有 ${count} 篇内容`, 3000, 'info');
        } catch (error) {
            logger.error('Failed to get article count:', error);
            SettingsForm.updateArticleCount(container, '获取失败');
            showMessage(this.i18n.zh_CN.errors?.apiError || 'API call failed', 5000, 'error');
        } finally {
            if (refreshBtn) {
                refreshBtn.disabled = false;
                refreshBtn.textContent = '刷新';
            }
        }
    }

    /**
     * 处理清空云空间
     */
    private handleClearAllArticles(container: HTMLElement) {
        confirm(
            this.i18n.zh_CN.confirm,
            this.i18n.zh_CN.clearAllArticlesConfirm,
            () => {
                if (!this.settings.apiKey) {
                    showMessage(this.i18n.zh_CN.errors?.noApiKey || 'No API key configured', 5000, 'error');
                    return;
                }

                const clearBtn = container.querySelector('#clearAllArticlesBtn') as HTMLButtonElement;
                if (clearBtn) {
                    clearBtn.disabled = true;
                    clearBtn.textContent = this.i18n.zh_CN.clearing || '清空中...';
                }

                clearAllArticles(this.settings.endpoint, this.settings.apiKey)
                    .then(() => {
                        SettingsForm.updateArticleCount(container, 0);
                        showMessage(this.i18n.zh_CN.success?.articlesCleared || 'Articles cleared', 5000, 'info');
                    })
                    .catch((error) => {
                        logger.error('Failed to clear articles:', error);
                        showMessage(this.i18n.zh_CN.errors?.apiError || 'API call failed', 5000, 'error');
                    })
                    .finally(() => {
                        if (clearBtn) {
                            clearBtn.disabled = false;
                            clearBtn.textContent = '清空云空间';
                        }
                    });
            }
        );
    }

    /**
     * 检查更新
     */
    private async checkForUpdates(container: HTMLElement) {
        const checkBtn = container.querySelector('#checkUpdateBtn') as HTMLButtonElement;
        if (checkBtn) {
            checkBtn.disabled = true;
            checkBtn.textContent = this.i18n.zh_CN.checkingUpdate || '检查中...';
        }

        SettingsForm.updateVersionStatus(container, '检查中...');

        try {
            const response = await fetch('https://siyuan.notebooksyncer.com/plugversion', {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            const latestVersion = data.version;
            const currentVersion = this.manifest?.version || '1.0.0';

            if (this.isNewerVersion(latestVersion, currentVersion)) {
                SettingsForm.updateVersionStatus(container, `${this.i18n.zh_CN.newVersionAvailable}: ${latestVersion}`);
                showMessage(`发现新版本 ${latestVersion}！`, 5000, 'info');
            } else {
                SettingsForm.updateVersionStatus(container, this.i18n.zh_CN.latestVersion);
            }
        } catch (error) {
            logger.error('Failed to check for updates:', error);
            SettingsForm.updateVersionStatus(container, this.i18n.zh_CN.updateCheckFailed);
        } finally {
            if (checkBtn) {
                checkBtn.disabled = false;
                checkBtn.textContent = this.i18n.zh_CN.checkUpdate;
            }
        }
    }

    /**
     * 比较版本号
     */
    private isNewerVersion(latestVersion: string, currentVersion: string): boolean {
        const parseVersion = (version: string) => {
            return version.split('.').map(num => parseInt(num, 10));
        };

        const latest = parseVersion(latestVersion);
        const current = parseVersion(currentVersion);

        for (let i = 0; i < Math.max(latest.length, current.length); i++) {
            const latestNum = latest[i] || 0;
            const currentNum = current[i] || 0;

            if (latestNum > currentNum) {
                return true;
            } else if (latestNum < currentNum) {
                return false;
            }
        }

        return false;
    }

    /**
     * 重置模板
     */
    private resetTemplate(container: HTMLElement, type: 'template' | 'wechatMessageTemplate' | 'frontMatterTemplate') {
        const templateMap: Record<string, { inputId: string; defaultValue: string; message: string }> = {
            template: {
                inputId: '#template',
                defaultValue: DEFAULT_SETTINGS.template,
                message: '文章模板已重置'
            },
            wechatMessageTemplate: {
                inputId: '#wechatMessageTemplate',
                defaultValue: DEFAULT_SETTINGS.wechatMessageTemplate,
                message: '企微消息模板已重置'
            },
            frontMatterTemplate: {
                inputId: '#frontMatterTemplate',
                defaultValue: DEFAULT_SETTINGS.frontMatterTemplate,
                message: '前置元数据模板已重置'
            }
        };

        const config = templateMap[type];
        if (!config) return;

        const input = container.querySelector(config.inputId) as HTMLTextAreaElement;
        if (input) {
            input.value = config.defaultValue;
            // 触发change事件以保存
            input.dispatchEvent(new Event('change'));
            showMessage(config.message, 3000, 'info');
        }
    }
}
