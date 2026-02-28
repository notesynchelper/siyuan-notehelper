/**
 * 全局 ID 索引
 * 在同步开始前一次性构建，用于跨设备去重
 *
 * 通过两条 SQL 查询加载所有已同步文章的 source-id 和 merged-ids，
 * 构建 articleId → blockId 的内存索引，避免多设备同步时创建重复文档。
 */

import { logger } from '../utils/logger';

export class IdIndex {
    private index: Map<string, string> = new Map();

    /**
     * 从思源数据库构建索引
     */
    async build(): Promise<void> {
        const startTime = Date.now();

        await Promise.all([
            this.loadSourceIds(),
            this.loadMergedIds(),
        ]);

        logger.info(
            `[IdIndex] 索引构建完成: ${this.index.size} 个 ID, ` +
            `耗时 ${Date.now() - startTime}ms`
        );
    }

    /**
     * 查询所有 custom-source-id 属性（独立文件模式的去重标识）
     */
    private async loadSourceIds(): Promise<void> {
        const sql = `SELECT block_id, value FROM attributes WHERE name='custom-source-id'`;
        try {
            const response = await fetch('/api/query/sql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ stmt: sql }),
            });
            const result = await response.json();
            if (result.code === 0 && Array.isArray(result.data)) {
                for (const row of result.data) {
                    if (row.value && row.block_id) {
                        this.index.set(row.value, row.block_id);
                    }
                }
                logger.debug(`[IdIndex] 加载了 ${result.data.length} 个 source-id`);
            }
        } catch (error) {
            logger.warn('[IdIndex] 加载 source-id 失败:', error);
        }
    }

    /**
     * 查询所有 custom-merged-ids 属性并展开（合并模式的去重标识）
     */
    private async loadMergedIds(): Promise<void> {
        const sql = `SELECT block_id, value FROM attributes WHERE name='custom-merged-ids'`;
        try {
            const response = await fetch('/api/query/sql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ stmt: sql }),
            });
            const result = await response.json();
            if (result.code === 0 && Array.isArray(result.data)) {
                let count = 0;
                for (const row of result.data) {
                    if (!row.value || !row.block_id) continue;
                    try {
                        const ids = JSON.parse(row.value);
                        if (Array.isArray(ids)) {
                            for (const id of ids) {
                                this.index.set(String(id), row.block_id);
                                count++;
                            }
                        }
                    } catch {
                        logger.warn(`[IdIndex] 解析 merged-ids 失败, block: ${row.block_id}`);
                    }
                }
                logger.debug(`[IdIndex] 加载了 ${count} 个 merged-id`);
            }
        } catch (error) {
            logger.warn('[IdIndex] 加载 merged-ids 失败:', error);
        }
    }

    /**
     * 通过文章 ID 查找对应的块 ID
     */
    findBlockId(articleId: string): string | undefined {
        return this.index.get(articleId);
    }

    get size(): number {
        return this.index.size;
    }
}
