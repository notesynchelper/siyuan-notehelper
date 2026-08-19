import { waitForSiyuanSyncSettled, SiyuanSyncEvent } from '../src/sync/siyuanSyncGate';

/** 可手动推进的假定时器，避免测试真的去睡 25 秒。 */
function makeHarness(syncEnabled: boolean) {
    const listeners = new Map<SiyuanSyncEvent, Set<() => void>>();
    const timers: Array<{ id: number; fn: () => void; at: number; live: boolean }> = [];
    let clock = 0;
    let nextId = 1;
    let offCalls = 0;

    const deps = {
        isSyncEnabled: () => syncEnabled,
        on: (type: SiyuanSyncEvent, cb: () => void) => {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type)!.add(cb);
            return () => { offCalls++; listeners.get(type)!.delete(cb); };
        },
        setTimer: (fn: () => void, ms: number) => {
            const t = { id: nextId++, fn, at: clock + ms, live: true };
            timers.push(t);
            return t.id;
        },
        clearTimer: (h: unknown) => {
            const t = timers.find((x) => x.id === h);
            if (t) t.live = false;
        },
    };

    return {
        deps,
        emit: (type: SiyuanSyncEvent) => { listeners.get(type)?.forEach((cb) => cb()); },
        advance: (ms: number) => {
            clock += ms;
            timers.filter((t) => t.live && t.at <= clock).forEach((t) => { t.live = false; t.fn(); });
        },
        activeListeners: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
        offCalls: () => offCalls,
    };
}

describe('siyuanSyncGate — 启动前等思源同步落地', () => {
    test('思源没开云同步 → 立刻放行，不等静默期', async () => {
        const h = makeHarness(false);
        await expect(waitForSiyuanSyncSettled(h.deps)).resolves.toBe('sync-disabled');
        expect(h.activeListeners()).toBe(0); // 压根没订阅
    });

    test('静默期内没有任何同步动静 → 放行（覆盖「挂监听时同步早跑完了」）', async () => {
        const h = makeHarness(true);
        const p = waitForSiyuanSyncSettled(h.deps, { quietMs: 25_000, maxWaitMs: 300_000 });
        h.advance(25_000);
        await expect(p).resolves.toBe('no-sync-observed');
    });

    test('等到 sync-end → 立刻放行', async () => {
        const h = makeHarness(true);
        const p = waitForSiyuanSyncSettled(h.deps, { quietMs: 25_000, maxWaitMs: 300_000 });
        h.advance(1_000);
        h.emit('sync-end');
        await expect(p).resolves.toBe('sync-finished');
    });

    test('sync-fail 也放行——否则同步失败后插件永远不同步', async () => {
        const h = makeHarness(true);
        const p = waitForSiyuanSyncSettled(h.deps, { quietMs: 25_000, maxWaitMs: 300_000 });
        h.emit('sync-fail');
        await expect(p).resolves.toBe('sync-finished');
    });

    test('sync-start 会撤掉静默期，一直等到 sync-end（这是防重复的关键分支）', async () => {
        const h = makeHarness(true);
        const p = waitForSiyuanSyncSettled(h.deps, { quietMs: 25_000, maxWaitMs: 300_000 });
        h.advance(5_000);
        h.emit('sync-start');
        h.advance(60_000);           // 远超静默期，但同步还在跑 → 不能放行
        let settled = false;
        p.then(() => { settled = true; });
        await Promise.resolve();
        expect(settled).toBe(false);
        h.emit('sync-end');
        await expect(p).resolves.toBe('sync-finished');
    });

    test('同步迟迟不结束 → maxWait 超时兜底放行，绝不把同步永远卡住', async () => {
        const h = makeHarness(true);
        const p = waitForSiyuanSyncSettled(h.deps, { quietMs: 25_000, maxWaitMs: 300_000 });
        h.emit('sync-start');
        h.advance(300_000);
        await expect(p).resolves.toBe('timeout');
    });

    test('放行后必定取消订阅、不留监听器', async () => {
        const h = makeHarness(true);
        const p = waitForSiyuanSyncSettled(h.deps, { quietMs: 25_000, maxWaitMs: 300_000 });
        h.emit('sync-end');
        await p;
        expect(h.activeListeners()).toBe(0);
        expect(h.offCalls()).toBe(3); // sync-start / sync-end / sync-fail
    });

    test('事件与超时同时到达也只结算一次', async () => {
        const h = makeHarness(true);
        const p = waitForSiyuanSyncSettled(h.deps, { quietMs: 25_000, maxWaitMs: 300_000 });
        h.emit('sync-end');
        h.emit('sync-end');
        h.advance(300_000);
        await expect(p).resolves.toBe('sync-finished');
    });

    test('isSyncEnabled 抛错时当作没开同步，不阻塞启动同步', async () => {
        const h = makeHarness(true);
        (h.deps as any).isSyncEnabled = () => { throw new Error('siyuan config unavailable'); };
        await expect(waitForSiyuanSyncSettled(h.deps)).resolves.toBe('sync-disabled');
    });
});

describe('siyuanSyncGate — 卸载时取消', () => {
    test('registerCancel 交出的句柄能立刻收摊，并退订全部监听', async () => {
        const listeners = new Map<string, Set<() => void>>();
        let offCalls = 0;
        let cancel: (() => void) | null = null;
        const deps = {
            isSyncEnabled: () => true,
            on: (type: any, cb: () => void) => {
                if (!listeners.has(type)) listeners.set(type, new Set());
                listeners.get(type)!.add(cb);
                return () => { offCalls++; listeners.get(type)!.delete(cb); };
            },
            setTimer: () => 1,
            clearTimer: () => {},
            registerCancel: (c: () => void) => { cancel = c; },
        };
        const p = waitForSiyuanSyncSettled(deps as any, { quietMs: 25_000, maxWaitMs: 300_000 });
        expect(cancel).toBeInstanceOf(Function);
        cancel!();
        await expect(p).resolves.toBe('cancelled');
        expect([...listeners.values()].reduce((n, s) => n + s.size, 0)).toBe(0);
        expect(offCalls).toBe(3);
    });

    test('取消之后再来事件不会二次结算', async () => {
        let cancel: (() => void) | null = null;
        const listeners = new Map<string, Set<() => void>>();
        const deps = {
            isSyncEnabled: () => true,
            on: (type: any, cb: () => void) => {
                if (!listeners.has(type)) listeners.set(type, new Set());
                listeners.get(type)!.add(cb);
                return () => listeners.get(type)!.delete(cb);
            },
            setTimer: () => 1,
            clearTimer: () => {},
            registerCancel: (c: () => void) => { cancel = c; },
        };
        const p = waitForSiyuanSyncSettled(deps as any, { quietMs: 25_000, maxWaitMs: 300_000 });
        cancel!();
        listeners.get('sync-end')?.forEach((cb) => cb());   // 已退订，不该有影响
        await expect(p).resolves.toBe('cancelled');
    });

    test('没开云同步时不注册取消句柄（压根没进等待）', async () => {
        let registered = false;
        await expect(waitForSiyuanSyncSettled({
            isSyncEnabled: () => false,
            on: () => () => {},
            registerCancel: () => { registered = true; },
        } as any)).resolves.toBe('sync-disabled');
        expect(registered).toBe(false);
    });
});
