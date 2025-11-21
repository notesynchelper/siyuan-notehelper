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
import { getArticleCount, clearAllArticles } from './api';
import { formatDate } from './utils/util';
import { SettingsForm } from './ui/SettingsForm';

const SETTINGS_KEY = 'notehelper-settings';
const DOCK_TYPE = 'notehelper_sync_dock';

// 中文文本定义（替代i18n）
const zhCN = {
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

    folderSettings: "文件夹和文件名",
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
    frontMatterVariables: "前言变量",
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
    imageMode: "图片模式",
    imageModeLocal: "本地缓存（下载到本地）",
    imageModeRemote: "远程保留（保留原始链接）",
    imageModeDisabled: "禁用（注释掉图片）",
    imageAttachmentFolder: "图片存储文件夹",
    enablePngToJpeg: "PNG 转 JPEG",
    jpegQuality: "JPEG 质量",
    imageDownloadRetries: "图片下载重试次数",

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
    }
};

export default class NoteHelperPlugin extends Plugin {

    private settings: PluginSettings;
    private syncManager: SyncManager;
    private imageLocalizer: ImageLocalizer;
    private statusBarElement: HTMLElement;
    private dockElement: HTMLElement;
    private i18n: typeof zhCN = zhCN; // 使用中文文本对象

    async onload() {
        // 先设置默认日志级别（生产环境使用INFO）
        logger.setLevel(LogLevel.INFO);
        logger.debug('Loading Note Sync Helper plugin...');

        // 注册自定义图标
        this.addIcons(`
<symbol id="iconNoteSync" viewBox="0 0 32 32">
  <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" font-size="30" font-weight="bold" fill="currentColor">同</text>
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

        // 延迟添加左侧栏同步dock，减少启动时的负载
        setTimeout(() => {
            this.addSyncDock();
        }, 3000); // 延迟3秒加载dock面板
    }

    async onunload() {
        logger.debug('Unloading Note Sync Helper plugin...');

        // 停止定时同步
        this.syncManager.stopScheduledSync();
    }

    /**
     * 添加顶栏图标
     */
    private addTopBarIcon() {
        const topBarElement = this.addTopBar({
            icon: 'iconRefresh',
            title: this.i18n.sync,
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
            this.statusBarElement.textContent = this.i18n.syncing;
            this.statusBarElement.setAttribute('aria-label', this.i18n.syncing);
        } else if (this.settings.syncAt) {
            const lastSync = formatDate(this.settings.syncAt, 'yyyy-MM-dd HH:mm');
            this.statusBarElement.textContent = `${this.i18n.lastSyncAt}: ${lastSync}`;
            this.statusBarElement.setAttribute('aria-label', `${this.i18n.lastSyncAt}: ${lastSync}`);
        } else {
            this.statusBarElement.textContent = this.i18n.noSyncYet;
            this.statusBarElement.setAttribute('aria-label', this.i18n.noSyncYet);
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
                                    ${this.i18n.dock?.status || "状态"}:
                                </div>
                                <div id="dockSyncStatus" style="font-size: 12px; color: var(--b3-theme-on-background);">
                                    ${this.i18n.noSyncYet}
                                </div>
                            </div>
                            <button class="b3-button b3-button--outline fn__block" id="dockQuickSync">
                                <svg class="b3-button__icon"><use xlink:href="#iconNoteSync"></use></svg>
                                ${this.i18n.dock?.quickSync || "立即同步"}
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

                // 延迟加载设置表单，减少初始化负载
                setTimeout(() => {
                    const settingsArea = dock.element.querySelector('#settingsFormArea');
                    if (settingsArea) {
                        settingsArea.innerHTML = `
                            <div style="margin-bottom: 8px; font-weight: bold; color: var(--b3-theme-on-surface);">
                                ${this.i18n.settings}
                            </div>
                            ${SettingsForm.renderSettingsForm(this.settings, this.i18n, () => this.formatSyncTimeForInput())}
                        `;

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
                }, 1000); // 延迟1秒加载设置表单
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
            statusElement.textContent = this.i18n.syncing;
        } else if (this.settings.syncAt) {
            const lastSync = formatDate(this.settings.syncAt, 'yyyy-MM-dd HH:mm');
            statusElement.textContent = `${this.i18n.lastSyncAt}: ${lastSync}`;
        } else {
            statusElement.textContent = this.i18n.noSyncYet;
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
            label: this.i18n.syncNow,
            click: () => {
                this.performSync();
            },
        });

        menu.addItem({
            icon: 'iconUndo',
            label: this.i18n.resetSync,
            click: () => {
                this.resetSyncTime();
            },
        });

        menu.addSeparator();

        menu.addItem({
            icon: 'iconInfo',
            label: this.i18n.viewArticleCount,
            click: () => {
                this.viewArticleCount();
            },
        });

        menu.addItem({
            icon: 'iconTrash',
            label: this.i18n.clearAllArticles,
            click: () => {
                this.clearAllArticles();
            },
        });

        menu.addSeparator();

        menu.addItem({
            icon: 'iconSettings',
            label: this.i18n.settings,
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
            showMessage(this.i18n.errors?.syncInProgress || 'Sync in progress', 3000, 'info');
            return;
        }

        if (!this.settings.apiKey) {
            showMessage(this.i18n.errors?.noApiKey || 'No API key configured', 5000, 'error');
            return;
        }

        try {
            this.updateStatusBar();
            showMessage(this.i18n.syncing, 3000, 'info');

            const result = await this.syncManager.sync();

            if (result.success) {
                let message = (this.i18n.success?.syncCompleted || 'Sync completed, processed {count} articles')
                    .replace('{count}', String(result.count));

                // 添加跳过数量信息
                if (result.skipped && result.skipped > 0) {
                    message += `，跳过 ${result.skipped} 个重复`;
                }

                showMessage(message, 5000, 'info');
            } else {
                showMessage(
                    this.i18n.syncFailed + ': ' + (result.errors?.join(', ') || ''),
                    5000,
                    'error'
                );
            }

            this.updateStatusBar();
        } catch (error) {
            logger.error('Sync error:', error);
            showMessage(this.i18n.syncFailed + ': ' + error, 5000, 'error');
            this.updateStatusBar();
        }
    }

    /**
     * 重置同步时间
     */
    private async resetSyncTime() {
        const confirmed = await confirm(
            this.i18n.confirm,
            this.i18n.resetSyncConfirm,
            null
        );

        if (confirmed) {
            await this.syncManager.resetSyncTime();
            this.updateStatusBar();
            showMessage(this.i18n.success?.settingsSaved || 'Settings saved', 3000, 'info');
        }
    }

    /**
     * 查看文章数量
     */
    private async viewArticleCount() {
        if (!this.settings.apiKey) {
            showMessage(this.i18n.errors?.noApiKey || 'No API key configured', 5000, 'error');
            return;
        }

        try {
            const count = await getArticleCount(
                this.settings.endpoint,
                this.settings.apiKey
            );

            const message = (this.i18n.articleCount || 'Total {count} articles in cloud')
                .replace('{count}', String(count));
            showMessage(message, 5000, 'info');
        } catch (error) {
            logger.error('Failed to get article count:', error);
            showMessage(this.i18n.errors?.apiError || 'API call failed', 5000, 'error');
        }
    }

    /**
     * 清空所有文章
     */
    private async clearAllArticles() {
        const confirmed = await confirm(
            this.i18n.confirm,
            this.i18n.clearAllArticlesConfirm,
            null
        );

        if (!confirmed) return;

        if (!this.settings.apiKey) {
            showMessage(this.i18n.errors?.noApiKey || 'No API key configured', 5000, 'error');
            return;
        }

        try {
            await clearAllArticles(this.settings.endpoint, this.settings.apiKey);
            showMessage(this.i18n.success?.articlesCleared || 'Articles cleared', 5000, 'info');
        } catch (error) {
            logger.error('Failed to clear articles:', error);
            showMessage(this.i18n.errors?.apiError || 'API call failed', 5000, 'error');
        }
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
}
