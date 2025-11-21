/**
 * 可复用的设置表单组件
 * 用于在不同容器中渲染设置表单
 */

import { PluginSettings } from '../settings';

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
                <div class="b3-label">
                    <div class="fn__flex">
                        <div class="fn__flex-1">
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

                <div class="b3-label">
                    <div class="fn__flex">
                        <div class="fn__flex-1">
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

                <div class="fn__hr"></div>

                <div class="b3-label">
                    <div class="fn__flex">
                        <div class="fn__flex-1">
                            ${i18n.folderSettings}
                        </div>
                    </div>
                </div>

                <div class="b3-label">
                    <div class="fn__flex">
                        <span class="fn__flex-1">${i18n.folder}</span>
                    </div>
                    <div class="fn__flex">
                        <input class="b3-text-field fn__flex-1" id="folder" value="${settings.folder}" />
                    </div>
                    <div class="b3-label__text">${i18n.folderDesc}</div>
                </div>

                <div class="b3-label">
                    <div class="fn__flex">
                        <span class="fn__flex-1">${i18n.filename}</span>
                    </div>
                    <div class="fn__flex">
                        <input class="b3-text-field fn__flex-1" id="filename" value="${settings.filename}" />
                    </div>
                    <div class="b3-label__text">${i18n.filenameDesc}</div>
                </div>

                <div class="fn__hr"></div>

                <div class="b3-label">
                    <div class="fn__flex">
                        <div class="fn__flex-1">
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
                    <div class="b3-label__text">${i18n.mergeFolderTemplateDesc || '支持 {{{date}}} 占位符，日期格式根据 mergeFolderDateFormat 设置'}</div>
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

                <!-- 图片处理部分暂时不上线 -->
                <!--
                <div class="b3-label">
                    <div class="fn__flex">
                        <div class="fn__flex-1">
                            ${i18n.imageSettings}
                        </div>
                    </div>
                </div>

                <div class="b3-label">
                    <div class="fn__flex">
                        <span class="fn__flex-1">${i18n.imageMode}</span>
                    </div>
                    <div class="fn__flex">
                        <select class="b3-select fn__flex-1" id="imageMode">
                            <option value="local" ${settings.imageMode === 'local' ? 'selected' : ''}>${i18n.imageModeLocal}</option>
                            <option value="remote" ${settings.imageMode === 'remote' ? 'selected' : ''}>${i18n.imageModeRemote}</option>
                            <option value="disabled" ${settings.imageMode === 'disabled' ? 'selected' : ''}>${i18n.imageModeDisabled}</option>
                        </select>
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
        const mergeModeSelect = container.querySelector('#mergeMode') as HTMLSelectElement;
        const folderInput = container.querySelector('#folder') as HTMLInputElement;
        const filenameInput = container.querySelector('#filename') as HTMLInputElement;
        const mergeFolderTemplateInput = container.querySelector('#mergeFolderTemplate') as HTMLInputElement;
        const mergeMessageTemplateInput = container.querySelector('#mergeMessageTemplate') as HTMLTextAreaElement;
        // 图片处理部分暂时不上线
        // const imageModeSelect = container.querySelector('#imageMode') as HTMLSelectElement;

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
                    // 使用 console.error 而不是 logger，因为这是 UI 层代码
                    console.error('Failed to parse sync time:', e);
                }
            } else {
                values.syncAt = '';
            }
        }

        if (frequencyInput) values.frequency = parseInt(frequencyInput.value) || 0;
        if (syncOnStartInput) values.syncOnStart = syncOnStartInput.checked;
        if (mergeModeSelect) values.mergeMode = mergeModeSelect.value as any;
        if (folderInput) values.folder = folderInput.value;
        if (filenameInput) values.filename = filenameInput.value;
        if (mergeFolderTemplateInput) values.mergeFolderTemplate = mergeFolderTemplateInput.value;
        if (mergeMessageTemplateInput) values.mergeMessageTemplate = mergeMessageTemplateInput.value;
        // 图片处理部分暂时不上线
        // if (imageModeSelect) values.imageMode = imageModeSelect.value as any;

        return values;
    }
}
