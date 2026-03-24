import { showMessage } from 'siyuan';

const PROGRESS_ID = 'notehelper-sync-progress';

export class SyncNoticeManager {
    private totalBlocks: number = 5;
    private filledBlocks: number = 0;
    private processedCount: number = 0;

    startSync(): void {
        this.totalBlocks = 5;
        this.filledBlocks = 1;
        this.processedCount = 0;
        this.showProgress('拉取数据...');
    }

    onBatchProcessed(count: number, hasNextPage: boolean): void {
        this.processedCount += count;
        this.totalBlocks = Math.min(Math.max(Math.ceil(this.processedCount / 5), 5), 10);

        if (hasNextPage) {
            this.filledBlocks = Math.min(
                Math.ceil(this.processedCount / 5),
                this.totalBlocks - 1
            );
        } else {
            this.filledBlocks = this.totalBlocks;
        }
        this.filledBlocks = Math.max(this.filledBlocks, 1);

        this.showProgress(`处理文章 ${this.processedCount}...`);
    }

    completeSync(successCount: number): void {
        this.filledBlocks = this.totalBlocks;
        const filled = '■ '.repeat(this.filledBlocks).trim();
        showMessage(`${filled}  同步完成！${successCount} 篇文章`, 5000, 'info', PROGRESS_ID);
    }

    showNoArticles(): void {
        showMessage('没有新文章需要同步', 3000, 'info');
    }

    showError(error: unknown): void {
        const err = error as any;
        if (err?.status === 401) {
            showMessage('API 密钥无效，请前往「笔记同步助手」公众号重新获取', 10000, 'error');
        } else if (error instanceof TypeError || !err?.status) {
            showMessage('网络连接失败，请检查网络后重试', 5000, 'error');
        } else {
            showMessage('同步失败，请稍后重试', 5000, 'error');
        }
    }

    private showProgress(label: string): void {
        const filled = '■ '.repeat(this.filledBlocks).trim();
        const empty = '□ '.repeat(this.totalBlocks - this.filledBlocks).trim();
        const bar = [filled, empty].filter(Boolean).join(' ');
        showMessage(`${bar}  ${label}`, 0, 'info', PROGRESS_ID);
    }
}
