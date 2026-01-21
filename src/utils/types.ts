/**
 * 类型定义文件
 */

// 高亮颜色枚举
export enum HighlightColors {
    Yellow = 'yellow',
    Red = 'red',
    Blue = 'blue',
    Green = 'green',
}

// 过滤器枚举
export enum Filter {
    ALL = '同步所有文章',
}

// 高亮排序方式
export enum HighlightOrder {
    LOCATION = 'LOCATION',  // 按位置
    TIME = 'TIME',          // 按时间
}

// 高亮管理器 ID
export enum HighlightManagerId {
    HIGHLIGHTR = 'hltr',
    OMNIVORE = 'omni',
}

// 图片模式
export enum ImageMode {
    LOCAL = 'local',        // 本地缓存（保留但不在UI展示）
    REMOTE = 'remote',      // 远程保留（默认）
    DISABLED = 'disabled',  // 禁用（保留但不在UI展示）
    PROXY = 'proxy',        // 使用在线图床代理
}

// 合并模式
export enum MergeMode {
    NONE = 'none',          // 不合并
    MESSAGES = 'messages',  // 仅合并企微消息
    ALL = 'all',            // 合并所有
}

// 高亮颜色映射类型
export type HighlightColorMapping = {
    [key in HighlightColors]: string;
};

// 文章项接口
export interface Article {
    id: string;
    title: string;
    author?: string;
    content: string;
    url: string;
    savedAt: string;
    publishedAt?: string;
    highlights?: Highlight[];
    labels?: Label[];
    note?: string;
    description?: string;
    siteName?: string;
    image?: string;
    wordsCount?: number;
    readLength?: number;
    state?: string;
    archivedAt?: string;
    type?: string;
}

// 高亮接口
export interface Highlight {
    id: string;
    quote: string;
    annotation?: string;
    color?: HighlightColors;
    highlightedAt: string;
    updatedAt?: string;
    patch?: string;
    prefix?: string;
    suffix?: string;
}

// 标签接口
export interface Label {
    id: string;
    name: string;
    color?: string;
    description?: string;
}

// 文件附件接口
export interface Attachment {
    id: string;
    url: string;
    contentType: string;
    filename: string;
}

// 同步结果接口
export interface SyncResult {
    success: boolean;
    count: number;
    skipped?: number;  // 跳过的重复文章数量
    errors?: string[];
}

// API 响应接口
export interface ApiResponse<T> {
    code: number;
    msg: string;
    data: T;
}

// 思源笔记本接口
export interface Notebook {
    id: string;
    name: string;
    icon: string;
    closed: boolean;
}

// 思源文档接口
export interface Document {
    id: string;
    name: string;
    notebook: string;
    path: string;
    hPath: string;
}
