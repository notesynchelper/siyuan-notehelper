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

const SETTINGS_KEY = 'notehelper-settings';

export default class NoteHelperPlugin extends Plugin {

    private settings: PluginSettings;
    private syncManager: SyncManager;
    private imageLocalizer: ImageLocalizer;
    private statusBarElement: HTMLElement;

    async onload() {
        logger.setLevel(LogLevel.INFO);
        logger.info('Loading Note Sync Helper plugin...');

        // 加载设置
        await this.loadSettings();

        // 初始化管理器
        this.syncManager = new SyncManager(this, this.settings);
        this.imageLocalizer = new ImageLocalizer(this, this.settings);

        // 注册命令
        this.registerCommands();

        // 启动时同步
        if (this.settings.syncOnStart) {
            setTimeout(() => {
                this.performSync();
            }, 2000);
        }

        // 启动定时同步
        if (this.settings.frequency > 0) {
            this.syncManager.startScheduledSync();
        }

        logger.info('Note Sync Helper plugin loaded successfully');
    }

    async onLayoutReady() {
        logger.info('Layout ready');

        // 添加顶栏图标
        this.addTopBarIcon();

        // 添加状态栏
        this.addStatusBarIcon();
    }

    async onunload() {
        logger.info('Unloading Note Sync Helper plugin...');

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
                    message += `, skipped ${result.skipped} duplicate${result.skipped > 1 ? 's' : ''}`;
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
     * 打开设置
     */
    private openSettings() {
        const dialog = new Dialog({
            title: this.i18n.settings,
            content: '<div id="noteHelperSettings" class="b3-dialog__content" style="padding: 20px;"></div>',
            width: '800px',
            height: '600px',
        });

        const container = dialog.element.querySelector('#noteHelperSettings');
        if (container) {
            this.createSettingsPanel(container as HTMLElement, dialog);
        }
    }

    /**
     * 创建设置面板
     */
    private createSettingsPanel(container: HTMLElement, dialog: Dialog) {
        container.innerHTML = '';

        // 创建表单容器
        const formHTML = `
            <div class="b3-label">
                <div class="fn__flex">
                    <div class="fn__flex-1">
                        ${this.i18n.basicSettings}
                    </div>
                </div>
            </div>

            <div class="b3-label">
                <div class="fn__flex">
                    <span class="fn__flex-1">${this.i18n.apiKey}</span>
                </div>
                <div class="fn__flex">
                    <input class="b3-text-field fn__flex-1" id="apiKey" type="password" value="${this.settings.apiKey}" />
                </div>
                <div class="b3-label__text">${this.i18n.apiKeyDesc}</div>
            </div>

            <div class="b3-label">
                <div class="fn__flex">
                    <span class="fn__flex-1">${this.i18n.endpoint}</span>
                </div>
                <div class="fn__flex">
                    <input class="b3-text-field fn__flex-1" id="endpoint" value="${this.settings.endpoint}" />
                </div>
                <div class="b3-label__text">${this.i18n.endpointDesc}</div>
            </div>

            <div class="fn__hr"></div>

            <div class="b3-label">
                <div class="fn__flex">
                    <div class="fn__flex-1">
                        ${this.i18n.syncSettings}
                    </div>
                </div>
            </div>

            <div class="b3-label">
                <div class="fn__flex">
                    <span class="fn__flex-1">${this.i18n.frequency}</span>
                </div>
                <div class="fn__flex">
                    <input class="b3-text-field fn__flex-1" type="number" id="frequency" value="${this.settings.frequency}" min="0" />
                </div>
                <div class="b3-label__text">${this.i18n.frequencyDesc}</div>
            </div>

            <div class="b3-label">
                <label class="fn__flex">
                    <input type="checkbox" id="syncOnStart" ${this.settings.syncOnStart ? 'checked' : ''} />
                    <span class="fn__space"></span>
                    <span>${this.i18n.syncOnStart}</span>
                </label>
                <div class="b3-label__text">${this.i18n.syncOnStartDesc}</div>
            </div>

            <div class="b3-label">
                <div class="fn__flex">
                    <span class="fn__flex-1">${this.i18n.mergeMode}</span>
                </div>
                <div class="fn__flex">
                    <select class="b3-select fn__flex-1" id="mergeMode">
                        <option value="none" ${this.settings.mergeMode === 'none' ? 'selected' : ''}>${this.i18n.mergeModeNone}</option>
                        <option value="messages" ${this.settings.mergeMode === 'messages' ? 'selected' : ''}>${this.i18n.mergeModeMessages}</option>
                        <option value="all" ${this.settings.mergeMode === 'all' ? 'selected' : ''}>${this.i18n.mergeModeAll}</option>
                    </select>
                </div>
            </div>

            <div class="fn__hr"></div>

            <div class="b3-label">
                <div class="fn__flex">
                    <div class="fn__flex-1">
                        ${this.i18n.folderSettings}
                    </div>
                </div>
            </div>

            <div class="b3-label">
                <div class="fn__flex">
                    <span class="fn__flex-1">${this.i18n.folder}</span>
                </div>
                <div class="fn__flex">
                    <input class="b3-text-field fn__flex-1" id="folder" value="${this.settings.folder}" />
                </div>
                <div class="b3-label__text">${this.i18n.folderDesc}</div>
            </div>

            <div class="b3-label">
                <div class="fn__flex">
                    <span class="fn__flex-1">${this.i18n.filename}</span>
                </div>
                <div class="fn__flex">
                    <input class="b3-text-field fn__flex-1" id="filename" value="${this.settings.filename}" />
                </div>
                <div class="b3-label__text">${this.i18n.filenameDesc}</div>
            </div>

            <div class="fn__hr"></div>

            <div class="b3-label">
                <div class="fn__flex">
                    <div class="fn__flex-1">
                        ${this.i18n.imageSettings}
                    </div>
                </div>
            </div>

            <div class="b3-label">
                <div class="fn__flex">
                    <span class="fn__flex-1">${this.i18n.imageMode}</span>
                </div>
                <div class="fn__flex">
                    <select class="b3-select fn__flex-1" id="imageMode">
                        <option value="local" ${this.settings.imageMode === 'local' ? 'selected' : ''}>${this.i18n.imageModeLocal}</option>
                        <option value="remote" ${this.settings.imageMode === 'remote' ? 'selected' : ''}>${this.i18n.imageModeRemote}</option>
                        <option value="disabled" ${this.settings.imageMode === 'disabled' ? 'selected' : ''}>${this.i18n.imageModeDisabled}</option>
                    </select>
                </div>
            </div>

            <div class="fn__hr"></div>

            <div class="b3-dialog__action">
                <button class="b3-button b3-button--cancel">${this.i18n.cancel}</button>
                <div class="fn__space"></div>
                <button class="b3-button b3-button--text" id="saveSettings">${this.i18n.save}</button>
            </div>
        `;

        container.innerHTML = formHTML;

        // 绑定保存按钮
        const saveBtn = container.querySelector('#saveSettings') as HTMLButtonElement;
        const cancelBtn = container.querySelector('.b3-button--cancel') as HTMLButtonElement;

        saveBtn?.addEventListener('click', async () => {
            await this.saveSettingsFromDialog(container);
            dialog.destroy();
            showMessage(this.i18n.success?.settingsSaved || 'Settings saved', 3000, 'info');

            // 重启定时同步
            this.syncManager.stopScheduledSync();
            if (this.settings.frequency > 0) {
                this.syncManager.startScheduledSync();
            }
        });

        cancelBtn?.addEventListener('click', () => {
            dialog.destroy();
        });
    }

    /**
     * 从对话框保存设置
     */
    private async saveSettingsFromDialog(container: HTMLElement) {
        const apiKeyInput = container.querySelector('#apiKey') as HTMLInputElement;
        const endpointInput = container.querySelector('#endpoint') as HTMLInputElement;
        const frequencyInput = container.querySelector('#frequency') as HTMLInputElement;
        const syncOnStartInput = container.querySelector('#syncOnStart') as HTMLInputElement;
        const mergeModeSelect = container.querySelector('#mergeMode') as HTMLSelectElement;
        const folderInput = container.querySelector('#folder') as HTMLInputElement;
        const filenameInput = container.querySelector('#filename') as HTMLInputElement;
        const imageModeSelect = container.querySelector('#imageMode') as HTMLSelectElement;

        if (apiKeyInput) this.settings.apiKey = apiKeyInput.value;
        if (endpointInput) this.settings.endpoint = endpointInput.value;
        if (frequencyInput) this.settings.frequency = parseInt(frequencyInput.value) || 0;
        if (syncOnStartInput) this.settings.syncOnStart = syncOnStartInput.checked;
        if (mergeModeSelect) this.settings.mergeMode = mergeModeSelect.value as any;
        if (folderInput) this.settings.folder = folderInput.value;
        if (filenameInput) this.settings.filename = filenameInput.value;
        if (imageModeSelect) this.settings.imageMode = imageModeSelect.value as any;

        await this.saveSettings();
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
        logger.info('Settings loaded');
    }

    /**
     * 保存设置
     */
    async saveSettings() {
        await this.saveData(SETTINGS_KEY, this.settings);
        logger.info('Settings saved');
    }
}
