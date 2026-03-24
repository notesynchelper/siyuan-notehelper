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
            expect.stringContaining('没有新文章'), 3000, 'info'
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
});
