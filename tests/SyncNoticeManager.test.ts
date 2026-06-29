import { showMessage } from 'siyuan';
import { SyncNoticeManager } from '../src/sync/SyncNoticeManager';

jest.mock('siyuan');
const mockShowMessage = showMessage as jest.MockedFunction<typeof showMessage>;

beforeEach(() => {
    mockShowMessage.mockClear();
});

describe('SyncNoticeManager', () => {
    test('startSync shows progress with 1 filled block', () => {
        const mgr = new SyncNoticeManager();
        mgr.startSync();
        expect(mockShowMessage).toHaveBeenCalledTimes(1);
        const msg = mockShowMessage.mock.calls[0][0];
        expect(msg).toContain('■');
        expect(msg).toContain('拉取数据');
    });

    test('onBatchProcessed updates progress', () => {
        const mgr = new SyncNoticeManager();
        mgr.startSync();
        mockShowMessage.mockClear();
        mgr.onBatchProcessed(15, true);
        expect(mockShowMessage).toHaveBeenCalledTimes(1);
        const msg = mockShowMessage.mock.calls[0][0];
        expect(msg).toContain('处理文章 15');
    });

    test('completeSync fills all blocks with timeout', () => {
        const mgr = new SyncNoticeManager();
        mgr.startSync();
        mgr.onBatchProcessed(15, false);
        mockShowMessage.mockClear();
        mgr.completeSync(15);
        const msg = mockShowMessage.mock.calls[0][0];
        expect(msg).toContain('同步完成');
        expect(msg).toContain('15');
        expect(msg).not.toContain('□');
        // Completion auto-dismisses (timeout=5000, not 0)
        expect(mockShowMessage.mock.calls[0][1]).toBe(5000);
    });

    test('showNoArticles shows message', () => {
        const mgr = new SyncNoticeManager();
        mgr.showNoArticles();
        expect(mockShowMessage).toHaveBeenCalledWith(
            expect.stringContaining('没有新文章'), 3000, 'info', 'notehelper-sync-progress'
        );
    });

    test('showError classifies 401 as API key error', () => {
        const mgr = new SyncNoticeManager();
        mgr.showError({ status: 401 });
        expect(mockShowMessage.mock.calls[0][0]).toContain('密钥无效');
    });

    test('showError classifies network error (no status)', () => {
        const mgr = new SyncNoticeManager();
        mgr.showError(new TypeError('Failed to fetch'));
        expect(mockShowMessage.mock.calls[0][0]).toContain('网络连接失败');
    });

    test('showError handles generic errors', () => {
        const mgr = new SyncNoticeManager();
        mgr.showError({ status: 500 });
        expect(mockShowMessage.mock.calls[0][0]).toContain('同步失败');
    });

    test('progress bar reserves 1 block when hasNextPage', () => {
        const mgr = new SyncNoticeManager();
        mgr.startSync();
        mgr.onBatchProcessed(25, true);
        const msg = mockShowMessage.mock.calls[mockShowMessage.mock.calls.length - 1][0];
        expect(msg).toContain('□');
    });

    test('showNoArticles reuses PROGRESS_ID so the lingering progress bar is replaced', () => {
        const mgr = new SyncNoticeManager();
        mgr.startSync();            // 留下 timeout=0 的常驻进度条
        mockShowMessage.mockClear();
        mgr.showNoArticles();
        // 必须带 PROGRESS_ID（第 4 个参数）才能替换掉常驻进度条，否则角落里会一直挂着
        expect(mockShowMessage).toHaveBeenCalledWith(
            expect.stringContaining('没有新文章'), 3000, 'info', 'notehelper-sync-progress'
        );
    });
});

describe('SyncNoticeManager — silent (auto-sync) mode', () => {
    test('startSync shows nothing', () => {
        const mgr = new SyncNoticeManager(true);
        mgr.startSync();
        expect(mockShowMessage).not.toHaveBeenCalled();
    });

    test('onBatchProcessed shows nothing', () => {
        const mgr = new SyncNoticeManager(true);
        mgr.startSync();
        mgr.onBatchProcessed(15, true);
        mgr.onBatchProcessed(15, false);
        expect(mockShowMessage).not.toHaveBeenCalled();
    });

    test('showNoArticles is silent (no spam when there are no new notes)', () => {
        const mgr = new SyncNoticeManager(true);
        mgr.showNoArticles();
        expect(mockShowMessage).not.toHaveBeenCalled();
    });

    test('completeSync with 0 new notes is silent (dedup-only auto sync)', () => {
        const mgr = new SyncNoticeManager(true);
        mgr.startSync();
        mgr.completeSync(0);
        expect(mockShowMessage).not.toHaveBeenCalled();
    });

    test('completeSync still notifies when real new notes arrived', () => {
        const mgr = new SyncNoticeManager(true);
        mgr.startSync();
        mgr.completeSync(3);
        expect(mockShowMessage).toHaveBeenCalledTimes(1);
        expect(mockShowMessage.mock.calls[0][0]).toContain('同步完成');
        expect(mockShowMessage.mock.calls[0][0]).toContain('3');
    });

    test('showError always notifies, even on auto sync', () => {
        const mgr = new SyncNoticeManager(true);
        mgr.showError({ status: 401 });
        expect(mockShowMessage).toHaveBeenCalledTimes(1);
        expect(mockShowMessage.mock.calls[0][0]).toContain('密钥无效');
    });

    test('showPartialFailure always notifies, even on auto sync (errors are never silent)', () => {
        const mgr = new SyncNoticeManager(true);
        mgr.startSync();
        mgr.showPartialFailure(0, 2);
        expect(mockShowMessage).toHaveBeenCalledTimes(1);
        const [text, , type] = mockShowMessage.mock.calls[0];
        expect(text).toContain('2 篇同步失败');
        expect(type).toBe('error');
    });

    test('showPartialFailure includes synced count when some succeeded', () => {
        const mgr = new SyncNoticeManager(true);
        mgr.showPartialFailure(3, 1);
        expect(mockShowMessage.mock.calls[0][0]).toContain('已同步 3 篇');
        expect(mockShowMessage.mock.calls[0][0]).toContain('1 篇同步失败');
    });
});
