import { shouldRunSyncOnStart, markAutoSyncStarted } from '../src/sync/syncOnStartGate';

// testEnvironment 是 node，没有 window/localStorage，这里装一个最小内存版。
const store = new Map<string, string>();
beforeEach(() => {
    store.clear();
    (global as any).window = {
        localStorage: {
            getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
            setItem: (k: string, v: string) => { store.set(k, String(v)); },
            removeItem: (k: string) => { store.delete(k); },
        },
    };
});

describe('syncOnStartGate — 跨重载冷却闸', () => {
    test('首次启动（无时间戳）应允许同步', () => {
        expect(shouldRunSyncOnStart()).toBe(true);
    });

    test('刚自动同步过 → 冷却期内回前台重载应跳过', () => {
        const t0 = 1_000_000_000_000;
        markAutoSyncStarted(t0);
        // 1 分钟后（< 5 分钟冷却）切回前台 → 跳过
        expect(shouldRunSyncOnStart(t0 + 60_000)).toBe(false);
    });

    test('超过冷却期后应再次允许同步', () => {
        const t0 = 1_000_000_000_000;
        markAutoSyncStarted(t0);
        // 6 分钟后（> 5 分钟冷却）→ 允许
        expect(shouldRunSyncOnStart(t0 + 6 * 60_000)).toBe(true);
    });

    test('边界：恰好达到冷却时长应允许（不足才跳过）', () => {
        const t0 = 1_000_000_000_000;
        markAutoSyncStarted(t0);
        expect(shouldRunSyncOnStart(t0 + 5 * 60_000)).toBe(true);
    });

    test('自定义冷却时长生效', () => {
        const t0 = 1_000_000_000_000;
        markAutoSyncStarted(t0);
        expect(shouldRunSyncOnStart(t0 + 30_000, 60_000)).toBe(false); // 30s < 60s
        expect(shouldRunSyncOnStart(t0 + 90_000, 60_000)).toBe(true);  // 90s > 60s
    });

    test('时间戳是脏数据时不阻塞同步', () => {
        store.set('notehelper-last-autosync-at', 'not-a-number');
        expect(shouldRunSyncOnStart()).toBe(true);
    });

    test('模拟手机端连续回前台：多次重载只在冷却外才放行', () => {
        const t0 = 1_000_000_000_000;
        // 真冷启动：放行 + 打点
        expect(shouldRunSyncOnStart(t0)).toBe(true);
        markAutoSyncStarted(t0);
        // 后台↔前台快速切 3 次（都在 5 分钟内）→ 全部跳过
        expect(shouldRunSyncOnStart(t0 + 10_000)).toBe(false);
        expect(shouldRunSyncOnStart(t0 + 120_000)).toBe(false);
        expect(shouldRunSyncOnStart(t0 + 290_000)).toBe(false);
        // 5 分钟后再回前台 → 放行
        expect(shouldRunSyncOnStart(t0 + 5 * 60_000 + 1)).toBe(true);
    });
});
