/**
 * 笔记同步助手 - 思源笔记插件
 * 主入口文件
 */

import {
    Plugin,
    showMessage,
    confirm,
    Dialog,
} from 'siyuan';
import './index.scss';

import { logger, LogLevel } from './utils/logger';
import { PluginSettings, DEFAULT_SETTINGS, createDefaultSettings } from './settings';
import { SyncManager } from './sync/syncManager';
import { ImageLocalizer } from './imageLocalizer/imageLocalizer';
import { getArticleCount, clearAllArticles, fetchVipStatus, getQrCodeUrl, VipStatus } from './api';
import { formatDate } from './utils/util';
import { SettingsForm } from './ui/SettingsForm';
import { checkAndUpdate, getRemoteVersion, getLocalVersion, compareVersions, performUpdate } from './updater';
import { validateTemplate, validateDateFormat, validateNumberRange } from './settings/validation';
import { shouldRunSyncOnStart } from './sync/syncOnStartGate';

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
    messageSortOrder: "消息排序",
    messageSortOrderDesc: "合并文件中消息的排序方式",
    messageSortOrderAsc: "正序（旧消息在前）",
    messageSortOrderDesc2: "倒序（新消息在前）",

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

    // 同步种入默认值：onload 必须在第一个 await 之前就注册 dock（见 onload 注释），
    // 那一刻 dock init 可能已经读 this.settings，所以这里保证它从一开始就是合法对象。
    // 用 createDefaultSettings() 深拷贝（不是浅拷贝），避免共享 DEFAULT_SETTINGS 的嵌套对象被原地写污染。
    // loadSettings() 之后用 Object.assign 原地更新，保持引用稳定（SyncManager/FileHandler 持有同一引用）。
    private settings: PluginSettings = createDefaultSettings();
    private syncManager: SyncManager;
    private imageLocalizer: ImageLocalizer;
    private dockElement: HTMLElement;
    // 幂等标记：确保本插件对同一实例只调用一次 addDock。
    // 注意它只约束「本插件不会重复注册」；SiYuan 的侧栏 dock 区按 type 唯一，
    // 同 type 重复注册会覆盖而非叠加（这也是 dock 不像顶栏那样会刷出一排重复图标的原因）。
    private syncDockAdded = false;
    // settings 是否已从磁盘加载完成。dock init 可能早于 onload 的 await loadSettings()
    // 完成（SiYuan loader 不 await onload），此时绝不能用默认值渲染设置表单——否则用户
    // 随后的任意改动会经 extractFormValues 把默认值整张存回、覆盖真实配置（数据丢失）。
    private settingsLoaded = false;
    // dock 设置表单是否已渲染绑定，幂等防止 init 与 onload 两条补渲染路径重复绑定。
    private dockFormRendered = false;

    // 初始化 i18n - 在类定义时就设置，避免 SiYuan 访问时为 null
    public i18n = {
        zh_CN: zhCN
    };

    async onload() {
        // 先设置默认日志级别（生产环境使用INFO）
        logger.setLevel(LogLevel.INFO);
        logger.debug('Loading Note Sync Helper plugin...');

        // ⚠️ 顺序要求：下面这一段（addIcons → 构造管理器 → addSyncDock）必须全部
        // 跑在 onload 的【第一个 await 之前】，即同步阶段完成。
        // 原因：SiYuan 启动 loadPlugins(init=true) 不 await onload，插件实例在
        // `await plugin.onload()` 之前就被 push 进 app.plugins；随后布局阶段
        // afterLoadPlugin() 会遍历 plugin.docks 调 genButton() 画侧栏按钮。
        // 若把 addDock 放在 `await loadSettings()` 之后，冷启动时按钮生成可能先于
        // dock 注册 → 「同」字图标缺失。所以这里在任何 await 之前同步注册。

        // 注册自定义图标 - 使用"同"字（dock 引用 #iconNoteSync，需先于 addDock）
        this.addIcons(`
<symbol id="iconNoteSync" viewBox="0 0 32 32">
  <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
        font-size="30" font-weight="bold" font-family="system-ui, -apple-system, sans-serif"
        fill="currentColor">同</text>
</symbol>
`);

        // 同步构造管理器：this.settings 已 seed 默认值，管理器持有其稳定引用，
        // dock init 里的 loadNotebookOptions() 会用到 this.syncManager，必须先就位。
        this.syncManager = new SyncManager(this, this.settings);
        this.imageLocalizer = new ImageLocalizer(this, this.settings);

        // 注册左侧栏「同」字 dock —— 插件唯一入口图标，且是仅有的一个。
        // 顶栏图标已彻底移除：addTopBar 每次调用都会向 #barPlugins 追加新 DOM、不去重，
        // onLayoutReady/afterLoadPlugin 被重复触发时会叠加出一排重复图标（本次修复的 bug）。
        this.addSyncDock();

        // —— 以下为异步/可后置阶段 ——

        // 加载设置（原地更新已 seed 的 this.settings）
        await this.loadSettings();
        this.settingsLoaded = true;

        // 冷启动竞态兜底：若 dock init 已先于 loadSettings 跑完（此时只渲染了「加载设置中」），
        // 现在设置已就绪，补渲染设置表单 + 刷新状态。正常情况下 init 晚于此处、由 init 自己渲染。
        if (this.dockElement) {
            this.populateDockSettingsForm();
            this.updateDockStatus();
        }

        // 根据设置更新日志级别
        this.updateLogLevel();

        // 注册命令
        this.registerCommands();

        // 启动时同步 - 延长延迟时间，减少启动时的资源占用
        // ⚠️ 手机端（尤其安卓）从后台切回前台会重载 webview → 重跑 onload，等于把
        // 「启动时同步」变成「每次回前台都同步」。用跨重载冷却闸去抖：距上次自动同步
        // 不足冷却期就跳过本次 syncOnStart，频繁切前后台不再反复同步。
        // 冷却时间戳由 syncManager.sync 在同步【真正开跑】时写入（不是在这里调度时写），
        // 这样若用户开 App 后 10s 内就切后台导致定时器被取消、同步从未发生，下次回前台
        // 不会因为一个「没跑成的同步」而被误判跳过——避免丢掉启动同步。
        if (this.settings.syncOnStart && shouldRunSyncOnStart()) {
            setTimeout(() => {
                this.performSync(true);
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
        // dock 已在 onload 注册；此处不再注册任何图标，避免重复。
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
     * 添加左侧栏同步dock（插件唯一入口图标，"同"字）
     * 在 onload 同步阶段调用；幂等标记确保单实例内只 addDock 一次。
     */
    private addSyncDock() {
        if (this.syncDockAdded) {
            logger.debug('Sync dock already registered, skip duplicate registration');
            return;
        }
        this.syncDockAdded = true;

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

                // 仅在设置已加载完成时才渲染设置表单；否则保持「加载设置中」，
                // 等 onload 的 loadSettings() 完成后由 onload 补渲染（见 onload 末尾）。
                // 绝不能在设置未加载时渲染表单 —— 默认值会被用户的后续改动整张存回、覆盖真实配置。
                if (this.settingsLoaded) {
                    this.populateDockSettingsForm();
                }
            },
        });
    }

    /**
     * 渲染 dock 设置表单并绑定交互/自动保存事件。
     * 必须在 this.settingsLoaded === true（设置已从磁盘加载）之后调用。
     * 幂等：两条触发路径（dock init 时 settingsLoaded 已 true；或 onload loadSettings 完成后
     * dock 已挂载）只会真正渲染一次。
     */
    private populateDockSettingsForm() {
        if (this.dockFormRendered) return;
        if (!this.dockElement) return;
        const settingsArea = this.dockElement.querySelector('#settingsFormArea');
        if (!settingsArea) return;
        this.dockFormRendered = true;

        settingsArea.innerHTML = `
            <div style="margin-bottom: 8px; font-weight: bold; color: var(--b3-theme-on-surface);">
                ${this.i18n.zh_CN.settings}
            </div>
            ${SettingsForm.renderSettingsForm(this.settings, this.i18n.zh_CN, () => this.formatSyncTimeForInput())}
        `;

        // 从磁盘读取实际版本号（而非内存 manifest，更新后无需重启即可显示新版本）
        getLocalVersion().then(v => {
            SettingsForm.setCurrentVersion(settingsArea as HTMLElement, v);
        });

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
            onCheckUpdate: async () => {
                await this.checkForUpdates(settingsArea as HTMLElement);
            },
            onManualUpdate: async () => {
                await this.manualUpdate(settingsArea as HTMLElement);
            },
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

        // 需要校验的字段映射
        const templateFields = new Set(['folder', 'filename', 'mergeFolder', 'singleFileName', 'mergeFolderTemplate', 'template', 'wechatMessageTemplate', 'mergeMessageTemplate']);
        const dateFormatFields = new Set(['folderDateFormat', 'filenameDateFormat', 'singleFileDateFormat', 'mergeFolderDateFormat', 'dateSavedFormat']);
        const numberFields: Record<string, { name: string; min: number; max: number; allowZero?: boolean }> = {
            frequency: { name: '同步频率（分钟）', min: 15, max: 1440, allowZero: true },
            jpegQuality: { name: 'JPEG 质量', min: 1, max: 100 },
            imageDownloadRetries: { name: '重试次数', min: 0, max: 10 },
        };

        const fieldNameMap: Record<string, string> = {
            folder: '文章文件夹', filename: '文件名', mergeFolder: '合并文件夹',
            singleFileName: '单文件名', mergeFolderTemplate: '合并路径模板',
            template: '内容模板', wechatMessageTemplate: '企微消息模板',
            mergeMessageTemplate: '合并消息模板',
            folderDateFormat: '文件夹日期格式', filenameDateFormat: '文件名日期格式',
            singleFileDateFormat: '单文件日期格式', mergeFolderDateFormat: '合并文件夹日期格式',
            dateSavedFormat: '保存日期格式',
        };

        let saveTimeout: any = null;
        const formInputs = settingsArea.querySelectorAll('input, select, textarea');
        formInputs.forEach((input) => {
            const el = input as HTMLInputElement;
            const fieldId = el.id;

            // 缓存原始值用于校验失败时恢复
            el.addEventListener('focus', () => {
                el.dataset.prevValue = el.value;
            });

            // 需要校验的字段用 blur 事件
            if (templateFields.has(fieldId) || dateFormatFields.has(fieldId) || numberFields[fieldId]) {
                el.addEventListener('blur', () => {
                    let valid = true;
                    if (templateFields.has(fieldId)) {
                        valid = validateTemplate(el.value, fieldNameMap[fieldId] || fieldId);
                    } else if (dateFormatFields.has(fieldId)) {
                        valid = validateDateFormat(el.value, fieldNameMap[fieldId] || fieldId);
                    } else if (numberFields[fieldId]) {
                        const cfg = numberFields[fieldId];
                        valid = validateNumberRange(el.value, cfg.name, cfg.min, cfg.max, cfg.allowZero);
                    }

                    if (!valid) {
                        el.value = el.dataset.prevValue || '';
                        return;
                    }

                    if (saveTimeout) clearTimeout(saveTimeout);
                    saveTimeout = setTimeout(async () => {
                        await this.saveSettingsFromContainer(this.dockElement);
                        this.syncManager.stopScheduledSync();
                        if (this.settings.frequency > 0) {
                            this.syncManager.startScheduledSync();
                        }
                    }, 500);
                });
            }

            // 不需要校验的字段保持 change 事件
            el.addEventListener('change', async () => {
                if (templateFields.has(fieldId) || dateFormatFields.has(fieldId) || numberFields[fieldId]) {
                    return; // 已由 blur 处理
                }
                if (saveTimeout) clearTimeout(saveTimeout);
                saveTimeout = setTimeout(async () => {
                    await this.saveSettingsFromContainer(this.dockElement);
                    this.syncManager.stopScheduledSync();
                    if (this.settings.frequency > 0) {
                        this.syncManager.startScheduledSync();
                    }
                }, 500);
            });
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
    private async performSync(isAutoSync: boolean = false) {
        if (this.syncManager.isCurrentlySyncing()) {
            showMessage(this.i18n.zh_CN.errors?.syncInProgress || 'Sync in progress', 3000, 'info');
            return;
        }
        if (!this.settings.apiKey) {
            showMessage(this.i18n.zh_CN.errors?.noApiKey || 'No API key configured', 5000, 'error');
            return;
        }
        try {
            this.updateDockStatus();
            if (!this.settings.targetNotebook) {
                showMessage('请在设置中选择目标笔记本，当前使用默认笔记本', 5000, 'info');
            }
            await this.syncManager.sync(isAutoSync);
        } catch (error) {
            logger.error('Sync error:', error);
        } finally {
            this.settings.syncing = false;
            this.updateDockStatus();
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
                    this.updateDockStatus();
                    showMessage(this.i18n.zh_CN.success?.settingsSaved || 'Settings saved', 3000, 'info');
                }).catch((error) => {
                    logger.error('Failed to reset sync time:', error);
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
        this.updateDockStatus();
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
        // 原地更新已 seed 的 this.settings，不要重新赋值——否则 onload 早期
        // 构造的 SyncManager / FileHandler / 已挂载的 dock 会持有旧引用。
        // 用 createDefaultSettings()（深拷贝）做基底，避免把 DEFAULT_SETTINGS 的嵌套对象引用 assign 进来被污染。
        Object.assign(this.settings, createDefaultSettings(), savedSettings || {});
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
        const updateBtn = container.querySelector('#manualUpdateBtn') as HTMLButtonElement;
        if (checkBtn) {
            checkBtn.disabled = true;
            checkBtn.textContent = this.i18n.zh_CN.checkingUpdate || '检查中...';
        }

        SettingsForm.updateVersionStatus(container, '检查中...');

        try {
            const latestVersion = await getRemoteVersion();
            if (!latestVersion) {
                throw new Error('无法获取远程版本号');
            }

            const currentVersion = await getLocalVersion();

            if (compareVersions(latestVersion, currentVersion)) {
                SettingsForm.updateVersionStatus(container, `${this.i18n.zh_CN.newVersionAvailable}: ${latestVersion}`);
                if (updateBtn) {
                    updateBtn.style.display = '';
                }
            } else {
                SettingsForm.updateVersionStatus(container, this.i18n.zh_CN.latestVersion);
                if (updateBtn) {
                    updateBtn.style.display = 'none';
                }
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
     * 手动触发更新
     */
    private async manualUpdate(container: HTMLElement) {
        const updateBtn = container.querySelector('#manualUpdateBtn') as HTMLButtonElement;
        if (updateBtn) {
            updateBtn.disabled = true;
            updateBtn.textContent = '更新中...';
        }

        try {
            await performUpdate();
            // 更新完成后刷新显示的版本号
            const newVersion = await getLocalVersion();
            SettingsForm.setCurrentVersion(container, newVersion);
            SettingsForm.updateVersionStatus(container, '更新完成，重启思源笔记后生效');
            showMessage('插件更新完成，重启思源笔记后生效。', 6000);
            if (updateBtn) {
                updateBtn.style.display = 'none';
            }
        } catch (error) {
            logger.error('Manual update failed:', error);
            SettingsForm.updateVersionStatus(container, '更新失败，请重试');
            if (updateBtn) {
                updateBtn.disabled = false;
                updateBtn.textContent = '立即更新';
            }
        }
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
