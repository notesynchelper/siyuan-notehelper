/**
 * 通知函数注入（浏览器=siyuan showMessage；kernel=日志/广播，见 src/kernel/runtime.ts）。
 * 不再静态 import 'siyuan'：kernel bundle 不能携带前端 SDK（见 scripts/check-kernel-bundle.js）。
 */
export type NoticeFn = (message: string, timeout?: number, type?: 'info' | 'error', id?: string) => void;

const PROGRESS_ID = 'notehelper-sync-progress';

export class SyncNoticeManager {
    private totalBlocks: number = 5;
    private filledBlocks: number = 0;
    private processedCount: number = 0;
    // silent = 自动/定时同步模式。此模式下抑制「拉取数据/处理文章」进度条与
    // 「没有新文章需要同步」提示——它们每个同步周期都弹会刷屏（尤其没有新笔记时）。
    // 仅保留两类用户真正关心的提示：① 真有新笔记入库（completeSync count>0）；
    // ② 抛错（showError，网络/鉴权失败）。手动同步（silent=false）保留完整反馈。
    private readonly silent: boolean;
    private readonly notify: NoticeFn | null;

    constructor(silent: boolean = false, notify: NoticeFn | null = null) {
        this.silent = silent;
        this.notify = notify;
    }

    private showMessage(message: string, timeout: number, type: 'info' | 'error'): void {
        if (!this.notify) return; // kernel 静默模式（无 UI）
        this.notify(message, timeout, type, PROGRESS_ID);
    }

    startSync(): void {
        this.totalBlocks = 5;
        this.filledBlocks = 1;
        this.processedCount = 0;
        if (this.silent) return;
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

        if (this.silent) return;
        this.showProgress(`处理文章 ${this.processedCount}...`);
    }

    completeSync(successCount: number): void {
        // 自动同步只在真有新笔记入库时提示；0 篇（无新文章 / 仅去重跳过）保持静默。
        if (this.silent && successCount <= 0) return;
        this.filledBlocks = this.totalBlocks;
        const filled = '■ '.repeat(this.filledBlocks).trim();
        this.showMessage(`${filled}  同步完成！${successCount} 篇文章`, 5000, 'info');
    }

    showNoArticles(): void {
        if (this.silent) return;
        // 复用 PROGRESS_ID + 有限超时，替换掉 startSync 留下的常驻（timeout=0）进度条，
        // 避免「拉取数据…」一直挂在角落不消失（手动同步路径上的旧 bug）。
        this.showMessage('没有新文章需要同步', 3000, 'info');
    }

    /**
     * 本次同步有文章处理失败（游标已保持不前进、下轮自动重试）。
     * 即使自动同步也提示——「出错时提示」是用户要求，且失败被静默会让卡住的同步
     * 永远无人知晓（区别于「没有新文章」那种无错静默场景，不算刷屏）。
     */
    showPartialFailure(successCount: number, errorCount: number): void {
        const prefix = successCount > 0 ? `已同步 ${successCount} 篇，` : '';
        this.showMessage(`${prefix}${errorCount} 篇同步失败，将自动重试`, 5000, 'error');
    }

    showError(error: unknown): void {
        const err = error as any;
        if (err?.status === 401) {
            this.showMessage('API 密钥无效，请前往「笔记同步助手」公众号重新获取', 10000, 'error');
        } else if (error instanceof TypeError || !err?.status) {
            this.showMessage('网络连接失败，请检查网络后重试', 5000, 'error');
        } else {
            this.showMessage('同步失败，请稍后重试', 5000, 'error');
        }
    }

    private showProgress(label: string): void {
        const filled = '■ '.repeat(this.filledBlocks).trim();
        const empty = '□ '.repeat(this.totalBlocks - this.filledBlocks).trim();
        const bar = [filled, empty].filter(Boolean).join(' ');
        this.showMessage(`${bar}  ${label}`, 0, 'info');
    }
}
