/**
 * 可复用的设置表单组件
 * 用于在不同容器中渲染设置表单
 */

import { PluginSettings, DEFAULT_SETTINGS, FRONT_MATTER_VARIABLES } from '../settings';

export class SettingsForm {
    /**
     * 渲染设置表单HTML
     * @param settings 当前设置对象
     * @param i18n 国际化对象
     * @param formatSyncTimeForInput 格式化同步时间的函数
     * @returns 设置表单HTML字符串
     */
    public static renderSettingsForm(
        settings: PluginSettings,
        i18n: any,
        formatSyncTimeForInput: () => string
    ): string {
        return `
            <div class="settings-form-container">
                <!-- 会员中心 -->
                <div class="b3-label">
                    <div class="fn__flex">
                        <div class="fn__flex-1" style="font-weight: bold;">
                            ${i18n.vipCenter || '会员中心'}
                        </div>
                    </div>
                </div>

                <div class="b3-label" id="vipStatusContainer" style="display: ${settings.apiKey ? 'block' : 'none'};">
                    <div class="vip-status-wrapper" style="display: flex; align-items: flex-start; gap: 16px; padding: 12px; background: var(--b3-theme-surface); border-radius: 8px;">
                        <div class="vip-status-left" style="flex: 1;">
                            <div class="vip-status-info" id="vipStatusInfo" style="font-size: 13px; color: var(--b3-theme-on-surface); margin-bottom: 8px;">
                                加载中...
                            </div>
                            <div class="vip-status-qr-label" id="vipQrLabel" style="font-size: 12px; color: var(--b3-theme-on-surface-light);">
                                加载中...
                            </div>
                        </div>
                        <div class="vip-status-qr" style="flex-shrink: 0;">
                            <img id="vipQrImage" src="" alt="二维码" style="width: 80px; height: 80px; border-radius: 4px;" />
                        </div>
                    </div>
                </div>

                <div class="fn__hr"></div>

                <!-- 文章管理 -->
                <div class="b3-label">
                    <div class="fn__flex">
                        <div class="fn__flex-1" style="font-weight: bold;">
                            ${i18n.articleManagement || '文章管理'}
                        </div>
                    </div>
                </div>

                <div class="b3-label">
                    <div class="fn__flex" style="align-items: center; gap: 8px;">
                        <span style="flex: 1; font-size: 13px;">${i18n.viewArticleCount || '云空间内容数量'}: <span id="articleCountDisplay">--</span></span>
                        <button class="b3-button b3-button--outline" id="refreshArticleCount" style="padding: 4px 12px; font-size: 12px;">
                            刷新
                        </button>
                        <button class="b3-button b3-button--outline" id="clearAllArticlesBtn" style="padding: 4px 12px; font-size: 12px; color: var(--b3-theme-error);">
                            清空云空间
                        </button>
                    </div>
                    <div class="b3-label__text" style="font-size: 11px;">${i18n.articleCountDesc || '显示云空间中文章和消息的总数量'}</div>
                </div>

                <div class="fn__hr"></div>

                <!-- 基础设置 -->
                <div class="b3-label">
                    <div class="fn__flex">
                        <div class="fn__flex-1" style="font-weight: bold;">
                            ${i18n.basicSettings}
                        </div>
                    </div>
                </div>

                <div class="b3-label">
                    <div class="fn__flex">
                        <span class="fn__flex-1">${i18n.apiKey}</span>
                    </div>
                    <div class="fn__flex">
                        <input class="b3-text-field fn__flex-1" id="apiKey" type="password" value="${settings.apiKey}" />
                    </div>
                    <div class="b3-label__text">${i18n.apiKeyDesc}</div>
                </div>

                <div class="fn__hr"></div>

                <!-- 同步设置 -->
                <div class="b3-label">
                    <div class="fn__flex">
                        <div class="fn__flex-1" style="font-weight: bold;">
                            ${i18n.syncSettings}
                        </div>
                    </div>
                </div>

                <div class="b3-label">
                    <div class="fn__flex">
                        <span class="fn__flex-1">${i18n.lastSyncTimeEdit}</span>
                    </div>
                    <div class="fn__flex">
                        <input class="b3-text-field fn__flex-1" type="datetime-local" id="syncAt" value="${formatSyncTimeForInput()}" />
                    </div>
                    <div class="b3-label__text">${i18n.lastSyncTimeEditDesc}</div>
                </div>

                <div class="b3-label">
                    <div class="fn__flex">
                        <span class="fn__flex-1">${i18n.frequency}</span>
                    </div>
                    <div class="fn__flex">
                        <input class="b3-text-field fn__flex-1" type="number" id="frequency" value="${settings.frequency}" min="0" />
                    </div>
                    <div class="b3-label__text">${i18n.frequencyDesc}</div>
                </div>

                <div class="b3-label">
                    <label class="fn__flex">
                        <input type="checkbox" id="syncOnStart" ${settings.syncOnStart ? 'checked' : ''} />
                        <span class="fn__space"></span>
                        <span>${i18n.syncOnStart}</span>
                    </label>
                    <div class="b3-label__text">${i18n.syncOnStartDesc}</div>
                </div>

                <div class="b3-label">
                    <div class="fn__flex">
                        <span class="fn__flex-1">${i18n.mergeMode}</span>
                    </div>
                    <div class="fn__flex">
                        <select class="b3-select fn__flex-1" id="mergeMode">
                            <option value="none" ${settings.mergeMode === 'none' ? 'selected' : ''}>${i18n.mergeModeNone}</option>
                            <option value="messages" ${settings.mergeMode === 'messages' ? 'selected' : ''}>${i18n.mergeModeMessages}</option>
                            <option value="all" ${settings.mergeMode === 'all' ? 'selected' : ''}>${i18n.mergeModeAll}</option>
                        </select>
                    </div>
                </div>

                <div class="b3-label">
                    <label class="fn__flex">
                        <input type="checkbox" id="refreshIndexAfterSync" ${settings.refreshIndexAfterSync ? 'checked' : ''} />
                        <span class="fn__space"></span>
                        <span>${i18n.refreshIndexAfterSync || '同步后刷新索引'}</span>
                    </label>
                    <div class="b3-label__text">${i18n.refreshIndexAfterSyncDesc || '勾选后同步完成时会强制刷新文件树索引，解决新笔记不显示的问题'}</div>
                </div>

                <div class="fn__hr"></div>

                <!-- 笔记同步位置 -->
                <div class="b3-label">
                    <div class="fn__flex">
                        <div class="fn__flex-1" style="font-weight: bold;">
                            ${i18n.folderSettings}
                        </div>
                    </div>
                </div>

                <div class="b3-label">
                    <div class="fn__flex">
                        <span class="fn__flex-1">${i18n.targetNotebook || '目标笔记本'}</span>
                    </div>
                    <div class="fn__flex">
                        <select class="b3-select fn__flex-1" id="targetNotebook">
                            <option value="">加载中...</option>
                        </select>
                    </div>
                    <div class="b3-label__text">${i18n.targetNotebookDesc || '选择同步内容保存到哪个笔记本'}</div>
                </div>

                <div class="b3-label">
                    <div class="fn__flex">
                        <span class="fn__flex-1">${i18n.folder}</span>
                    </div>
                    <div class="fn__flex">
                        <input class="b3-text-field fn__flex-1" id="folder" value="${settings.folder}" />
                    </div>
                    <div class="b3-label__text">${i18n.folderDesc}<br/><span style="color: var(--b3-theme-on-surface-light);">时间变量：{{{date}}}, {{{year}}}, {{{month}}}, {{{day}}}, {{{weekday}}}, {{{quarter}}}</span></div>
                </div>

                <div class="b3-label">
                    <div class="fn__flex">
                        <span class="fn__flex-1">${i18n.filename}</span>
                    </div>
                    <div class="fn__flex">
                        <input class="b3-text-field fn__flex-1" id="filename" value="${settings.filename}" />
                    </div>
                    <div class="b3-label__text">${i18n.filenameDesc}<br/><span style="color: var(--b3-theme-on-surface-light);">时间变量：{{{date}}}, {{{year}}}, {{{month}}}, {{{day}}}, {{{weekday}}}, {{{quarter}}}</span></div>
                </div>

                <div class="fn__hr"></div>

                <!-- 合并消息设置 -->
                <div class="b3-label">
                    <div class="fn__flex">
                        <div class="fn__flex-1" style="font-weight: bold;">
                            ${i18n.mergeSettings || '合并消息设置'}
                        </div>
                    </div>
                </div>

                <div class="b3-label">
                    <div class="fn__flex">
                        <span class="fn__flex-1">${i18n.mergeFolderTemplate || '合并消息路径模板'}</span>
                    </div>
                    <div class="fn__flex">
                        <input class="b3-text-field fn__flex-1" id="mergeFolderTemplate" value="${settings.mergeFolderTemplate}" />
                    </div>
                    <div class="b3-label__text">${i18n.mergeFolderTemplateDesc || '时间变量：{{{date}}}, {{{year}}}, {{{month}}}, {{{day}}}, {{{weekday}}}, {{{quarter}}}'}</div>
                </div>

                <div class="b3-label">
                    <div class="fn__flex">
                        <span class="fn__flex-1">${i18n.mergeMessageTemplate || '合并消息格式模板'}</span>
                    </div>
                    <div class="fn__flex">
                        <textarea class="b3-text-field fn__flex-1" id="mergeMessageTemplate" rows="4" style="resize: vertical;">${settings.mergeMessageTemplate}</textarea>
                    </div>
                    <div class="b3-label__text">${i18n.mergeMessageTemplateDesc || '支持 Mustache 变量：{{{dateSaved}}}, {{{content}}}。使用 --- 作为消息分隔符'}</div>
                </div>

                <div class="fn__hr"></div>

                <!-- 图片处理 -->
                <div class="b3-label">
                    <div class="fn__flex">
                        <div class="fn__flex-1" style="font-weight: bold;">
                            ${i18n.imageSettings || '图片处理'}
                        </div>
                    </div>
                </div>

                <div class="b3-label">
                    <div class="fn__flex">
                        <span class="fn__flex-1">${i18n.imageMode || '图片处理模式'}</span>
                    </div>
                    <div class="fn__flex">
                        <select class="b3-select fn__flex-1" id="imageMode">
                            <option value="remote" ${settings.imageMode === 'remote' ? 'selected' : ''}>${i18n.imageModeRemote || '保留原始链接（默认）'}</option>
                            <option value="local" ${settings.imageMode === 'local' ? 'selected' : ''}>${i18n.imageModeLocal || '本地缓存（下载到本地）'}</option>
                            <option value="proxy" ${settings.imageMode === 'proxy' ? 'selected' : ''}>${i18n.imageModeProxy || '使用在线图床'}</option>
                        </select>
                    </div>
                    <div class="b3-label__text">${i18n.imageModeDesc || '选择如何处理笔记中的图片'}</div>
                </div>

                <!-- 图片存储路径（仅 local 模式显示） -->
                <div id="imageLocalSettings" style="display: ${settings.imageMode === 'local' ? 'block' : 'none'};">
                    <div class="b3-label">
                        <div class="fn__flex">
                            <span class="fn__flex-1">${i18n.imageAttachmentFolder || '图片存储文件夹'}</span>
                        </div>
                        <div class="fn__flex" style="gap: 8px;">
                            <input class="b3-text-field fn__flex-1" id="imageAttachmentFolder" value="${settings.imageAttachmentFolder}" />
                            <button class="b3-button b3-button--outline" id="resetImageFolder" title="恢复默认值">↺</button>
                        </div>
                        <div class="b3-label__text">${i18n.imageAttachmentFolderDesc || '本地缓存模式下图片的存储路径。时间变量：{{{date}}}, {{{year}}}, {{{month}}}, {{{day}}}'}</div>
                    </div>
                </div>

                <!-- 在线图床警告提示 -->
                <div id="proxyWarning" style="display: ${settings.imageMode === 'proxy' ? 'block' : 'none'};">
                    <div class="b3-label" style="background: var(--b3-card-warning-background, #fff3cd); padding: 8px; border-radius: 4px; margin-top: 4px;">
                        <span style="color: var(--b3-card-warning-color, #856404);">${i18n.imageModeProxyWarning || '⚠️ 开启后需要海外网络环境才能正常加载图片'}</span>
                    </div>
                </div>

                <div class="fn__hr"></div>

                <!-- 附件设置 -->
                <div class="b3-label">
                    <div class="fn__flex">
                        <div class="fn__flex-1" style="font-weight: bold;">
                            ${i18n.attachmentSettings || '附件设置'}
                        </div>
                    </div>
                </div>

                <div class="b3-label">
                    <div class="fn__flex">
                        <span class="fn__flex-1">${i18n.attachmentFolder || '附件存储位置'}</span>
                    </div>
                    <div class="fn__flex" style="gap: 8px;">
                        <input class="b3-text-field fn__flex-1" id="attachmentFolder" value="${settings.attachmentFolder}" />
                        <button class="b3-button b3-button--outline" id="resetAttachmentFolder" title="恢复默认值">↺</button>
                    </div>
                    <div class="b3-label__text">${i18n.attachmentFolderDesc || '文件附件的默认存储路径'}</div>
                </div>

                <div class="fn__hr"></div>

                <!-- 高级设置（可折叠） -->
                <details class="advanced-settings-details">
                    <summary class="b3-label" style="cursor: pointer; user-select: none;">
                        <div class="fn__flex">
                            <div class="fn__flex-1" style="font-weight: bold;">
                                ${i18n.advancedSettings || '高级设置'}
                                <span style="font-size: 11px; color: var(--b3-theme-on-surface-light); margin-left: 8px;">点击展开</span>
                            </div>
                        </div>
                    </summary>

                    <div class="advanced-settings-content" style="padding-top: 8px;">
                        <!-- 笔记自定义属性 -->
                        <div class="b3-label">
                            <div class="fn__flex" style="align-items: center;">
                                <span class="fn__flex-1">${i18n.frontMatterVariables || '笔记自定义属性'}</span>
                            </div>
                            <div class="fn__flex">
                                <textarea class="b3-text-field fn__flex-1" id="frontMatterVariables" rows="2" style="resize: vertical;">${settings.frontMatterVariables.join(',')}</textarea>
                            </div>
                            <div class="b3-label__text">${i18n.frontMatterVariablesDesc || '自定义思源文档属性。默认包含 note-helper（笔记同步助手）和 note-helper-type（链接/消息）'}</div>
                        </div>

                        <!-- 文章模板 -->
                        <div class="b3-label">
                            <div class="fn__flex" style="align-items: center;">
                                <span class="fn__flex-1">${i18n.template || '文章模板'}</span>
                                <button class="b3-button b3-button--outline" id="resetTemplate" style="padding: 2px 8px; font-size: 11px;">
                                    重置
                                </button>
                            </div>
                            <div class="fn__flex">
                                <textarea class="b3-text-field fn__flex-1" id="template" rows="10" style="resize: vertical; font-family: monospace;">${settings.template}</textarea>
                            </div>
                            <div class="b3-label__text">${i18n.templateDesc || '使用 Mustache 语法自定义文章渲染模板'}</div>
                        </div>

                        <!-- 企微消息模板 -->
                        <div class="b3-label">
                            <div class="fn__flex" style="align-items: center;">
                                <span class="fn__flex-1">${i18n.wechatMessageTemplate || '企微消息模板'}</span>
                                <button class="b3-button b3-button--outline" id="resetWechatTemplate" style="padding: 2px 8px; font-size: 11px;">
                                    重置
                                </button>
                            </div>
                            <div class="fn__flex">
                                <textarea class="b3-text-field fn__flex-1" id="wechatMessageTemplate" rows="3" style="resize: vertical; font-family: monospace;">${settings.wechatMessageTemplate}</textarea>
                            </div>
                            <div class="b3-label__text">${i18n.wechatMessageTemplateDesc || '可用变量：{{{dateSaved}}}, {{{content}}}, {{{title}}}, {{{id}}}'}</div>
                        </div>

                        <!-- 前置元数据模板（已禁用）
                        <div class="b3-label">
                            <div class="fn__flex" style="align-items: center;">
                                <span class="fn__flex-1">${i18n.frontMatterTemplate || '前置元数据模板'}</span>
                                <button class="b3-button b3-button--outline" id="resetFrontMatterTemplate" style="padding: 2px 8px; font-size: 11px;">
                                    重置
                                </button>
                            </div>
                            <div class="fn__flex">
                                <textarea class="b3-text-field fn__flex-1" id="frontMatterTemplate" rows="5" style="resize: vertical; font-family: monospace;">${settings.frontMatterTemplate}</textarea>
                            </div>
                            <div class="b3-label__text">${i18n.frontMatterTemplateDesc || '输入 YAML 模板来渲染前置元数据'}</div>
                        </div>
                        -->

                        <!-- 保存日期格式 -->
                        <div class="b3-label">
                            <div class="fn__flex">
                                <span class="fn__flex-1">${i18n.dateSavedFormat || '保存日期格式'}</span>
                            </div>
                            <div class="fn__flex">
                                <input class="b3-text-field fn__flex-1" id="dateSavedFormat" value="${settings.dateSavedFormat}" />
                            </div>
                            <div class="b3-label__text">${i18n.dateSavedFormatDesc || 'dateSaved 变量的日期格式'}</div>
                        </div>

                        <!-- 模板变量参考 -->
                        <div class="b3-label" style="background: var(--b3-theme-surface); border-radius: 8px; padding: 12px; margin-top: 8px;">
                            <div class="fn__flex" style="margin-bottom: 8px;">
                                <span class="fn__flex-1" style="font-weight: bold;">📋 模板变量参考</span>
                            </div>
                            <div style="font-size: 12px; line-height: 1.8; color: var(--b3-theme-on-surface);">
                                <div style="margin-bottom: 8px;">
                                    <strong>时间变量</strong>（用于路径和文件名）<br/>
                                    <code style="background: var(--b3-theme-background); padding: 2px 4px; border-radius: 3px;">{{{date}}}</code> 格式化日期 &nbsp;
                                    <code style="background: var(--b3-theme-background); padding: 2px 4px; border-radius: 3px;">{{{year}}}</code> 年份 &nbsp;
                                    <code style="background: var(--b3-theme-background); padding: 2px 4px; border-radius: 3px;">{{{month}}}</code> 月份 &nbsp;
                                    <code style="background: var(--b3-theme-background); padding: 2px 4px; border-radius: 3px;">{{{day}}}</code> 日期<br/>
                                    <code style="background: var(--b3-theme-background); padding: 2px 4px; border-radius: 3px;">{{{hour}}}</code> 小时 &nbsp;
                                    <code style="background: var(--b3-theme-background); padding: 2px 4px; border-radius: 3px;">{{{minute}}}</code> 分钟 &nbsp;
                                    <code style="background: var(--b3-theme-background); padding: 2px 4px; border-radius: 3px;">{{{weekday}}}</code> 周几 &nbsp;
                                    <code style="background: var(--b3-theme-background); padding: 2px 4px; border-radius: 3px;">{{{quarter}}}</code> 季度
                                </div>
                                <div style="margin-bottom: 8px;">
                                    <strong>文章变量</strong>（用于模板）<br/>
                                    <code style="background: var(--b3-theme-background); padding: 2px 4px; border-radius: 3px;">{{{title}}}</code> 标题 &nbsp;
                                    <code style="background: var(--b3-theme-background); padding: 2px 4px; border-radius: 3px;">{{{content}}}</code> 正文 &nbsp;
                                    <code style="background: var(--b3-theme-background); padding: 2px 4px; border-radius: 3px;">{{{author}}}</code> 作者 &nbsp;
                                    <code style="background: var(--b3-theme-background); padding: 2px 4px; border-radius: 3px;">{{{originalUrl}}}</code> 原文链接<br/>
                                    <code style="background: var(--b3-theme-background); padding: 2px 4px; border-radius: 3px;">{{{dateSaved}}}</code> 保存日期 &nbsp;
                                    <code style="background: var(--b3-theme-background); padding: 2px 4px; border-radius: 3px;">{{{datePublished}}}</code> 发布日期 &nbsp;
                                    <code style="background: var(--b3-theme-background); padding: 2px 4px; border-radius: 3px;">{{{siteName}}}</code> 站点名<br/>
                                    <code style="background: var(--b3-theme-background); padding: 2px 4px; border-radius: 3px;">{{{description}}}</code> 描述 &nbsp;
                                    <code style="background: var(--b3-theme-background); padding: 2px 4px; border-radius: 3px;">{{{note}}}</code> 笔记 &nbsp;
                                    <code style="background: var(--b3-theme-background); padding: 2px 4px; border-radius: 3px;">{{{wordsCount}}}</code> 字数 &nbsp;
                                    <code style="background: var(--b3-theme-background); padding: 2px 4px; border-radius: 3px;">{{{labels}}}</code> 标签
                                </div>
                                <div style="color: var(--b3-theme-on-surface-light); font-size: 11px;">
                                    示例：<code style="background: var(--b3-theme-background); padding: 2px 4px; border-radius: 3px;">笔记/{{{year}}}/{{{month}}}</code> → 笔记/2025/01
                                </div>
                            </div>
                        </div>
                    </div>
                </details>

                <!-- 版本信息（已禁用）
                <div class="fn__hr"></div>
                <div class="b3-label" id="versionInfoContainer">
                    <div class="fn__flex" style="align-items: center; gap: 8px;">
                        <span style="font-size: 12px; color: var(--b3-theme-on-surface-light);">
                            ${i18n.currentVersion || '当前版本'}: <span id="currentVersionDisplay">${settings.version || '1.0.0'}</span>
                        </span>
                        <button class="b3-button b3-button--outline" id="checkUpdateBtn" style="padding: 2px 8px; font-size: 11px;">
                            ${i18n.checkUpdate || '检查更新'}
                        </button>
                        <span id="updateStatusDisplay" style="font-size: 11px; color: var(--b3-theme-on-surface-light);"></span>
                    </div>
                </div>
                -->
            </div>
        `;
    }

    /**
     * 从容器中提取表单值
     * @param container 包含表单的HTML容器
     * @returns 表单值对象
     */
    public static extractFormValues(container: HTMLElement): Partial<PluginSettings> {
        const apiKeyInput = container.querySelector('#apiKey') as HTMLInputElement;
        const syncAtInput = container.querySelector('#syncAt') as HTMLInputElement;
        const frequencyInput = container.querySelector('#frequency') as HTMLInputElement;
        const syncOnStartInput = container.querySelector('#syncOnStart') as HTMLInputElement;
        const refreshIndexAfterSyncInput = container.querySelector('#refreshIndexAfterSync') as HTMLInputElement;
        const mergeModeSelect = container.querySelector('#mergeMode') as HTMLSelectElement;
        const targetNotebookSelect = container.querySelector('#targetNotebook') as HTMLSelectElement;
        const folderInput = container.querySelector('#folder') as HTMLInputElement;
        const filenameInput = container.querySelector('#filename') as HTMLInputElement;
        const mergeFolderTemplateInput = container.querySelector('#mergeFolderTemplate') as HTMLInputElement;
        const mergeMessageTemplateInput = container.querySelector('#mergeMessageTemplate') as HTMLTextAreaElement;

        // 图片处理相关
        const imageModeSelect = container.querySelector('#imageMode') as HTMLSelectElement;
        const imageAttachmentFolderInput = container.querySelector('#imageAttachmentFolder') as HTMLInputElement;

        // 附件相关
        const attachmentFolderInput = container.querySelector('#attachmentFolder') as HTMLInputElement;

        // 高级设置相关
        const frontMatterVariablesInput = container.querySelector('#frontMatterVariables') as HTMLTextAreaElement;
        const templateInput = container.querySelector('#template') as HTMLTextAreaElement;
        const wechatMessageTemplateInput = container.querySelector('#wechatMessageTemplate') as HTMLTextAreaElement;
        const frontMatterTemplateInput = container.querySelector('#frontMatterTemplate') as HTMLTextAreaElement;
        const dateSavedFormatInput = container.querySelector('#dateSavedFormat') as HTMLInputElement;

        const values: Partial<PluginSettings> = {};

        if (apiKeyInput) values.apiKey = apiKeyInput.value;

        // 处理最后同步时间（转换为服务端支持的格式：去掉毫秒）
        if (syncAtInput) {
            if (syncAtInput.value) {
                try {
                    const date = new Date(syncAtInput.value);
                    // 转换为 ISO 格式并去掉毫秒，匹配服务端格式
                    values.syncAt = date.toISOString().replace(/\.\d{3}Z$/, 'Z');
                } catch (e) {
                    console.error('Failed to parse sync time:', e);
                }
            } else {
                values.syncAt = '';
            }
        }

        if (frequencyInput) values.frequency = parseInt(frequencyInput.value) || 0;
        if (syncOnStartInput) values.syncOnStart = syncOnStartInput.checked;
        if (refreshIndexAfterSyncInput) values.refreshIndexAfterSync = refreshIndexAfterSyncInput.checked;
        if (mergeModeSelect) values.mergeMode = mergeModeSelect.value as any;
        if (targetNotebookSelect) values.targetNotebook = targetNotebookSelect.value;
        if (folderInput) values.folder = folderInput.value;
        if (filenameInput) values.filename = filenameInput.value;
        if (mergeFolderTemplateInput) values.mergeFolderTemplate = mergeFolderTemplateInput.value;
        if (mergeMessageTemplateInput) values.mergeMessageTemplate = mergeMessageTemplateInput.value;

        // 图片处理
        if (imageModeSelect) values.imageMode = imageModeSelect.value as any;
        if (imageAttachmentFolderInput) values.imageAttachmentFolder = imageAttachmentFolderInput.value;

        // 附件
        if (attachmentFolderInput) values.attachmentFolder = attachmentFolderInput.value;

        // 高级设置
        if (frontMatterVariablesInput) {
            values.frontMatterVariables = frontMatterVariablesInput.value
                .split(',')
                .map(v => v.trim())
                .filter(v => v && FRONT_MATTER_VARIABLES.includes(v.split('::')[0]));
        }
        if (templateInput) values.template = templateInput.value || DEFAULT_SETTINGS.template;
        if (wechatMessageTemplateInput) values.wechatMessageTemplate = wechatMessageTemplateInput.value || DEFAULT_SETTINGS.wechatMessageTemplate;
        if (frontMatterTemplateInput) values.frontMatterTemplate = frontMatterTemplateInput.value;
        if (dateSavedFormatInput) values.dateSavedFormat = dateSavedFormatInput.value;

        return values;
    }

    /**
     * 绑定动态交互事件
     * @param container 容器元素
     * @param callbacks 回调函数集合
     */
    public static bindEvents(
        container: HTMLElement,
        callbacks: {
            onApiKeyChange?: (apiKey: string) => void;
            onRefreshArticleCount?: () => void;
            onClearAllArticles?: () => void;
            onCheckUpdate?: () => void;
            onResetTemplate?: (type: 'template' | 'wechatMessageTemplate' | 'frontMatterTemplate') => void;
        }
    ): void {
        // API密钥变化时更新VIP状态
        const apiKeyInput = container.querySelector('#apiKey') as HTMLInputElement;
        if (apiKeyInput && callbacks.onApiKeyChange) {
            apiKeyInput.addEventListener('change', () => {
                callbacks.onApiKeyChange!(apiKeyInput.value);
            });
        }

        // 刷新文章数量
        const refreshBtn = container.querySelector('#refreshArticleCount') as HTMLButtonElement;
        if (refreshBtn && callbacks.onRefreshArticleCount) {
            refreshBtn.addEventListener('click', () => {
                callbacks.onRefreshArticleCount!();
            });
        }

        // 清空云空间
        const clearBtn = container.querySelector('#clearAllArticlesBtn') as HTMLButtonElement;
        if (clearBtn && callbacks.onClearAllArticles) {
            clearBtn.addEventListener('click', () => {
                callbacks.onClearAllArticles!();
            });
        }

        // 检查更新（已禁用）
        // const checkUpdateBtn = container.querySelector('#checkUpdateBtn') as HTMLButtonElement;
        // if (checkUpdateBtn && callbacks.onCheckUpdate) {
        //     checkUpdateBtn.addEventListener('click', () => {
        //         callbacks.onCheckUpdate!();
        //     });
        // }

        // 重置模板按钮
        const resetTemplateBtn = container.querySelector('#resetTemplate') as HTMLButtonElement;
        if (resetTemplateBtn && callbacks.onResetTemplate) {
            resetTemplateBtn.addEventListener('click', () => {
                callbacks.onResetTemplate!('template');
            });
        }

        const resetWechatTemplateBtn = container.querySelector('#resetWechatTemplate') as HTMLButtonElement;
        if (resetWechatTemplateBtn && callbacks.onResetTemplate) {
            resetWechatTemplateBtn.addEventListener('click', () => {
                callbacks.onResetTemplate!('wechatMessageTemplate');
            });
        }

        // 前置元数据模板重置按钮已禁用
        // const resetFrontMatterTemplateBtn = container.querySelector('#resetFrontMatterTemplate') as HTMLButtonElement;
        // if (resetFrontMatterTemplateBtn && callbacks.onResetTemplate) {
        //     resetFrontMatterTemplateBtn.addEventListener('click', () => {
        //         callbacks.onResetTemplate!('frontMatterTemplate');
        //     });
        // }

        // 图片模式变化时显示/隐藏相关设置
        const imageModeSelect = container.querySelector('#imageMode') as HTMLSelectElement;
        const proxyWarning = container.querySelector('#proxyWarning') as HTMLElement;
        const imageLocalSettings = container.querySelector('#imageLocalSettings') as HTMLElement;
        if (imageModeSelect) {
            imageModeSelect.addEventListener('change', () => {
                // 显示/隐藏 proxy 警告
                if (proxyWarning) {
                    proxyWarning.style.display = imageModeSelect.value === 'proxy' ? 'block' : 'none';
                }
                // 显示/隐藏 local 模式的图片路径设置
                if (imageLocalSettings) {
                    imageLocalSettings.style.display = imageModeSelect.value === 'local' ? 'block' : 'none';
                }
            });
        }

        // 恢复默认值按钮事件
        const resetImageFolderBtn = container.querySelector('#resetImageFolder') as HTMLButtonElement;
        const imageAttachmentFolderInput = container.querySelector('#imageAttachmentFolder') as HTMLInputElement;
        if (resetImageFolderBtn && imageAttachmentFolderInput) {
            resetImageFolderBtn.addEventListener('click', () => {
                imageAttachmentFolderInput.value = 'assets/笔记同步助手/images/{{{date}}}';
            });
        }

        const resetAttachmentFolderBtn = container.querySelector('#resetAttachmentFolder') as HTMLButtonElement;
        const attachmentFolderInput = container.querySelector('#attachmentFolder') as HTMLInputElement;
        if (resetAttachmentFolderBtn && attachmentFolderInput) {
            resetAttachmentFolderBtn.addEventListener('click', () => {
                attachmentFolderInput.value = 'assets/笔记同步助手/attachments';
            });
        }
    }

    /**
     * 更新VIP状态显示
     * @param container 容器元素
     * @param vipStatus VIP状态对象
     * @param qrCodeUrl 二维码URL
     * @param qrLabel 二维码标签文字
     */
    public static updateVipStatus(
        container: HTMLElement,
        vipStatus: { displayText: string; isValid: boolean; vipType: string },
        qrCodeUrl: string,
        qrLabel: string
    ): void {
        const vipStatusContainer = container.querySelector('#vipStatusContainer') as HTMLElement;
        const vipStatusInfo = container.querySelector('#vipStatusInfo') as HTMLElement;
        const vipQrLabel = container.querySelector('#vipQrLabel') as HTMLElement;
        const vipQrImage = container.querySelector('#vipQrImage') as HTMLImageElement;

        if (vipStatusContainer) {
            vipStatusContainer.style.display = 'block';
        }

        if (vipStatusInfo) {
            vipStatusInfo.textContent = vipStatus.displayText;
        }

        if (vipQrLabel) {
            vipQrLabel.textContent = qrLabel;
        }

        if (vipQrImage) {
            vipQrImage.src = qrCodeUrl;
        }
    }

    /**
     * 更新文章数量显示
     * @param container 容器元素
     * @param count 文章数量
     */
    public static updateArticleCount(container: HTMLElement, count: number | string): void {
        const articleCountDisplay = container.querySelector('#articleCountDisplay') as HTMLElement;
        if (articleCountDisplay) {
            articleCountDisplay.textContent = String(count);
        }
    }

    /**
     * 更新版本检查状态
     * @param container 容器元素
     * @param status 状态文字
     */
    public static updateVersionStatus(container: HTMLElement, status: string): void {
        const updateStatusDisplay = container.querySelector('#updateStatusDisplay') as HTMLElement;
        if (updateStatusDisplay) {
            updateStatusDisplay.textContent = status;
        }
    }

    /**
     * 设置当前版本显示
     * @param container 容器元素
     * @param version 版本号
     */
    public static setCurrentVersion(container: HTMLElement, version: string): void {
        const currentVersionDisplay = container.querySelector('#currentVersionDisplay') as HTMLElement;
        if (currentVersionDisplay) {
            currentVersionDisplay.textContent = version;
        }
    }

    /**
     * 更新笔记本下拉框选项
     * @param container 容器元素
     * @param notebooks 笔记本列表
     * @param selectedId 当前选中的笔记本ID
     */
    public static updateNotebookOptions(
        container: HTMLElement,
        notebooks: Array<{id: string, name: string}>,
        selectedId: string
    ): void {
        const select = container.querySelector('#targetNotebook') as HTMLSelectElement;
        if (!select) return;

        // 生成选项HTML
        select.innerHTML = notebooks.map(nb =>
            `<option value="${nb.id}" ${nb.id === selectedId ? 'selected' : ''}>${nb.name}</option>`
        ).join('');

        // 如果没有选中的值且有笔记本，默认选择第一个
        if (!selectedId && notebooks.length > 0) {
            select.value = notebooks[0].id;
        }
    }
}
