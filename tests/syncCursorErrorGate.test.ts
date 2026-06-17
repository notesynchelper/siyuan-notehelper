/**
 * sync() 游标错误门控测试（P1 数据安全）
 *
 * 验证：本次同步【有错误】时绝不推进 syncAt / deviceSyncCursors，
 * 以便下次重新拉取同一窗口重试失败文章（配合半成品文档回滚，避免永久丢失）；
 * 【无错误】时正常推进游标。
 */
import { SyncManager } from '../src/sync/syncManager';
import { FileHandler } from '../src/sync/fileHandler';
import { DEFAULT_SETTINGS, PluginSettings } from '../src/settings/index';
import { getItems } from '../src/api';

jest.mock('../src/api', () => ({ getItems: jest.fn() }));
jest.mock('../src/updater', () => ({ checkAndUpdate: jest.fn(() => Promise.resolve()) }));
jest.mock('../src/sync/idIndex', () => ({
    IdIndex: class { async build(): Promise<void> { /* no-op */ } findBlockId(): string | null { return null; } },
}));
jest.mock('../src/sync/SyncNoticeManager', () => ({
    SyncNoticeManager: class {
        startSync() {} onBatchProcessed() {} completeSync() {} showNoArticles() {} showError() {}
    },
}));

const OLD_CURSOR = '2026-06-01T00:00:00Z';

function makeSettings(overrides: Partial<PluginSettings> = {}): PluginSettings {
    return {
        ...DEFAULT_SETTINGS,
        apiKey: 'k',
        endpoint: 'https://example.com/api/graphql',
        refreshIndexAfterSync: false, // 跳过 refreshFiletree 的 fetch
        syncAt: OLD_CURSOR,
        deviceSyncCursors: {},
        initialSyncCompleted: false,
        ...overrides,
    };
}

describe('sync() 游标错误门控（P1 数据安全）', () => {
    let store: Map<string, string>;

    beforeEach(() => {
        jest.clearAllMocks();
        store = new Map([['notehelper-device-id', 'test-device']]);
        (global as unknown as { window: unknown }).window = {
            localStorage: {
                getItem: (k: string) => (store.has(k) ? store.get(k) : null),
                setItem: (k: string, v: string) => { store.set(k, v); },
                removeItem: (k: string) => { store.delete(k); },
            },
            siyuan: { config: { system: { os: 'linux' } } },
        };
        jest.spyOn(FileHandler.prototype, 'getTargetNotebook').mockResolvedValue({ notebookId: 'nb-1', isDefault: false });
        jest.spyOn(FileHandler.prototype, 'clearDocumentCache').mockImplementation(() => {});
        jest.spyOn(FileHandler.prototype, 'setIdIndex').mockImplementation(() => {});
        // 一页一篇文章，无下一页
        (getItems as jest.Mock).mockResolvedValue([[{ id: 'a1', title: 't', content: 'c', savedAt: OLD_CURSOR }], false]);
    });

    afterEach(() => { jest.restoreAllMocks(); });

    test('有错误 → syncAt / deviceSyncCursors 保持不变（不越过失败文章）', async () => {
        jest.spyOn(FileHandler.prototype, 'processArticleBatch').mockResolvedValue({ created: 0, skipped: 0, errors: ['boom'] });
        const settings = makeSettings();
        const sm = new SyncManager({ saveSettings: async () => {} }, settings);

        const result = await sm.sync(false);

        expect(result.success).toBe(false);
        expect(result.errors && result.errors.length).toBeGreaterThan(0);
        expect(settings.syncAt).toBe(OLD_CURSOR);                      // 游标未推进
        expect(settings.deviceSyncCursors?.['test-device']).toBeUndefined();
        expect(settings.initialSyncCompleted).toBe(false);             // 错误首跑不置位（保住初始 1 天重叠窗口）
    });

    test('无错误 → syncAt 正常推进', async () => {
        jest.spyOn(FileHandler.prototype, 'processArticleBatch').mockResolvedValue({ created: 1, skipped: 0, errors: [] });
        const settings = makeSettings();
        const sm = new SyncManager({ saveSettings: async () => {} }, settings);

        const result = await sm.sync(false);

        expect(result.success).toBe(true);
        expect(settings.syncAt).not.toBe(OLD_CURSOR);                  // 游标已推进
        expect(settings.deviceSyncCursors?.['test-device']).toBeTruthy();
        expect(settings.initialSyncCompleted).toBe(true);              // 无错误才标记首次同步完成
    });
});
