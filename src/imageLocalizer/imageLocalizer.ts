/**
 * 图片本地化器
 * 负责处理图片下载和本地化
 */

import { logger } from '../utils/logger';
import { ImageMode } from '../utils/types';
import { PluginSettings } from '../settings';
import { ImageDownloadTask, ImageDownloadResult } from './types';

/**
 * 图片本地化器类
 */
export class ImageLocalizer {
    private plugin: any;
    private settings: PluginSettings;
    private queue: ImageDownloadTask[] = [];
    private processing: boolean = false;

    constructor(plugin: any, settings: PluginSettings) {
        this.plugin = plugin;
        this.settings = settings;
    }

    /**
     * 添加文档到处理队列
     */
    addToQueue(docId: string, content: string): void {
        if (this.settings.imageMode !== ImageMode.LOCAL) {
            return;
        }

        // 提取图片 URL
        const imageUrls = this.extractImageUrls(content);

        // 添加到队列
        imageUrls.forEach(url => {
            this.queue.push({
                url,
                docId,
                retries: this.settings.imageDownloadRetries,
            });
        });

        logger.debug(`Added ${imageUrls.length} images to queue for doc ${docId}`);
    }

    /**
     * 处理队列中的所有图片
     */
    async processQueue(): Promise<void> {
        if (this.processing || this.queue.length === 0) {
            return;
        }

        this.processing = true;
        logger.debug(`Processing ${this.queue.length} images...`);

        while (this.queue.length > 0) {
            const task = this.queue.shift();
            if (task) {
                await this.processImage(task);
            }
        }

        this.processing = false;
        logger.debug('Image processing completed');
    }

    /**
     * 处理单个图片
     */
    private async processImage(task: ImageDownloadTask): Promise<void> {
        try {
            const result = await this.downloadImage(task.url);

            if (result.success && result.localPath) {
                // 更新文档中的图片链接
                await this.updateImageReference(task.docId, task.url, result.localPath);
            } else if (task.retries > 0) {
                // 重试
                this.queue.push({
                    ...task,
                    retries: task.retries - 1,
                });
            }
        } catch (error) {
            logger.error(`Failed to process image ${task.url}:`, error);
        }
    }

    /**
     * 下载图片
     */
    private async downloadImage(url: string): Promise<ImageDownloadResult> {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                return {
                    success: false,
                    originalUrl: url,
                    error: `HTTP ${response.status}`,
                };
            }

            const blob = await response.blob();
            const arrayBuffer = await blob.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);

            // 上传到思源
            const localPath = await this.uploadToSiyuan(uint8Array, url);

            return {
                success: true,
                originalUrl: url,
                localPath,
            };
        } catch (error) {
            logger.error(`Image download failed: ${url}`, error);
            return {
                success: false,
                originalUrl: url,
                error: String(error),
            };
        }
    }

    /**
     * 上传图片到思源
     */
    private async uploadToSiyuan(data: Uint8Array, originalUrl: string): Promise<string> {
        // 生成文件名
        const filename = this.generateFilename(originalUrl);

        // 使用思源 API 上传
        const formData = new FormData();
        const blob = new Blob([data]);
        formData.append('file[]', blob, filename);
        formData.append('assetsDirPath', this.settings.imageAttachmentFolder);

        const response = await fetch('/api/asset/upload', {
            method: 'POST',
            body: formData,
        });

        const result = await response.json();

        if (result.code !== 0) {
            throw new Error(`Upload failed: ${result.msg}`);
        }

        return result.data.succMap[filename];
    }

    /**
     * 更新文档中的图片引用
     */
    private async updateImageReference(
        docId: string,
        oldUrl: string,
        newPath: string
    ): Promise<void> {
        try {
            // 获取文档内容
            const response = await fetch('/api/block/getBlockKramdown', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: docId }),
            });

            const data = await response.json();
            if (data.code !== 0) {
                throw new Error('Failed to get document content');
            }

            // 替换图片 URL
            const content = data.data.kramdown;
            const updatedContent = content.replace(oldUrl, newPath);

            // 更新文档
            const updateResponse = await fetch('/api/block/updateBlock', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    dataType: 'markdown',
                    data: updatedContent,
                    id: docId,
                }),
            });

            const updateData = await updateResponse.json();
            if (updateData.code !== 0) {
                throw new Error('Failed to update document');
            }

            logger.debug(`Updated image reference in doc ${docId}`);
        } catch (error) {
            logger.error('Failed to update image reference:', error);
        }
    }

    /**
     * 提取内容中的图片 URL
     */
    private extractImageUrls(content: string): string[] {
        const urls: string[] = [];
        const regex = /!\[.*?\]\((https?:\/\/[^\)]+)\)/g;
        let match;

        while ((match = regex.exec(content)) !== null) {
            urls.push(match[1]);
        }

        return urls;
    }

    /**
     * 生成文件名
     */
    private generateFilename(url: string): string {
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            const filename = pathname.split('/').pop() || 'image.jpg';
            return filename;
        } catch {
            return `image-${Date.now()}.jpg`;
        }
    }
}
