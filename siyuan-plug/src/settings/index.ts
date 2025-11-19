/**
 * 设置定义文件
 */

import {
    Filter,
    HighlightColors,
    HighlightColorMapping,
    HighlightManagerId,
    HighlightOrder,
    ImageMode,
    MergeMode,
} from '../utils/types';
import { DEFAULT_TEMPLATE } from './template';

// 前言可用变量
export const FRONT_MATTER_VARIABLES = [
    'title',
    'author',
    'tags',
    'date_saved',
    'date_published',
    'site_name',
    'original_url',
    'description',
    'note',
    'type',
    'date_read',
    'words_count',
    'read_length',
    'state',
    'date_archived',
    'image',
];

// 插件设置接口
export interface PluginSettings {
    // 基础设置
    apiKey: string;
    endpoint: string;
    filter: string;
    customQuery: string;

    // 同步设置
    syncAt: string;  // 最后同步时间
    frequency: number;  // 定时同步频率（分钟）
    syncOnStart: boolean;  // 启动时同步
    mergeMode: MergeMode;  // 合并模式
    syncing: boolean;  // 同步中标志
    intervalId: number;  // 定时器 ID

    // 文件夹和文件名
    folder: string;  // 目标文件夹
    folderDateFormat: string;  // 文件夹日期格式
    filename: string;  // 文件名模板
    filenameDateFormat: string;  // 文件名日期格式
    singleFileName: string;  // 单文件模式文件名
    singleFileDateFormat: string;  // 单文件日期格式
    attachmentFolder: string;  // 附件文件夹

    // 模板设置
    template: string;  // 内容模板
    frontMatterTemplate: string;  // 前言模板
    frontMatterVariables: string[];  // 前言变量列表
    wechatMessageTemplate: string;  // 企微消息模板
    sectionSeparator: string;  // 消息分隔符开始
    sectionSeparatorEnd: string;  // 消息分隔符结束

    // 日期格式
    dateHighlightedFormat: string;  // 高亮日期格式
    dateSavedFormat: string;  // 保存日期格式

    // 高亮设置
    highlightOrder: string;  // 高亮排序
    enableHighlightColorRender: boolean;  // 启用高亮颜色渲染
    highlightManagerId: HighlightManagerId;  // 高亮管理器 ID
    highlightColorMapping: HighlightColorMapping;  // 高亮颜色映射

    // 图片处理
    imageMode: ImageMode;  // 图片模式
    imageAttachmentFolder: string;  // 图片存储文件夹
    enablePngToJpeg: boolean;  // PNG 转 JPEG
    jpegQuality: number;  // JPEG 质量
    imageDownloadRetries: number;  // 图片下载重试次数

    // 其他
    version: string;  // 插件版本
}

// 默认设置
export const DEFAULT_SETTINGS: PluginSettings = {
    // 基础设置
    apiKey: '',
    endpoint: 'https://siyuan.notebooksyncer.com/api/graphql',
    filter: Filter.ALL,
    customQuery: '',

    // 同步设置
    syncAt: '',
    frequency: 0,
    syncOnStart: false,
    mergeMode: MergeMode.MESSAGES,
    syncing: false,
    intervalId: 0,

    // 文件夹和文件名
    folder: '笔记同步助手/{{{date}}}',
    folderDateFormat: 'yyyy-MM-dd',
    filename: '{{{title}}}',
    filenameDateFormat: 'yyyy-MM-dd',
    singleFileName: '同步助手_{{{date}}}',
    singleFileDateFormat: 'yyyy-MM-dd',
    attachmentFolder: '笔记同步助手/attachments',

    // 模板设置
    template: DEFAULT_TEMPLATE,
    frontMatterTemplate: '',
    frontMatterVariables: [],
    wechatMessageTemplate: '---\n## 📅 {{{dateSaved}}}\n{{{content}}}',
    sectionSeparator: '%%{{{dateSaved}}}_start%%',
    sectionSeparatorEnd: '%%{{{dateSaved}}}_end%%',

    // 日期格式
    dateHighlightedFormat: 'yyyy-MM-dd HH:mm:ss',
    dateSavedFormat: 'yyyy-MM-dd HH:mm:ss',

    // 高亮设置
    highlightOrder: HighlightOrder.LOCATION,
    enableHighlightColorRender: false,
    highlightManagerId: HighlightManagerId.OMNIVORE,
    highlightColorMapping: {
        [HighlightColors.Yellow]: '#fff3a3',
        [HighlightColors.Red]: '#ff5582',
        [HighlightColors.Blue]: '#adccff',
        [HighlightColors.Green]: '#bbfabb',
    },

    // 图片处理
    imageMode: ImageMode.LOCAL,
    imageAttachmentFolder: '笔记同步助手/images/{{{date}}}',
    enablePngToJpeg: false,
    jpegQuality: 85,
    imageDownloadRetries: 3,

    // 其他
    version: '0.1.0',
};
