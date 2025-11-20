/**
 * 图片本地化相关类型定义
 */

export interface ImageDownloadTask {
    url: string;
    docId: string;
    retries: number;
}

export interface ImageDownloadResult {
    success: boolean;
    originalUrl: string;
    localPath?: string;
    error?: string;
}
