import { computeEffectiveSyncAt } from '../src/sync/syncCursorAdjust';

describe('computeEffectiveSyncAt', () => {
    const baseTime = '2026-03-24T12:00:00Z';

    test('returns undefined when rawSyncAt is empty', () => {
        expect(computeEffectiveSyncAt('', { syncTimeOffset: 12, initialSyncCompleted: true, frequency: 0, isAutoSync: false })).toBeUndefined();
    });

    test('applies only syncTimeOffset when no other rollbacks apply', () => {
        const result = computeEffectiveSyncAt(baseTime, {
            syncTimeOffset: 12, initialSyncCompleted: true, frequency: 0, isAutoSync: false,
        });
        expect(result).toBe('2026-03-24T00:00:00Z');
    });

    test('no rollback when syncTimeOffset is 0 and sync completed', () => {
        const result = computeEffectiveSyncAt(baseTime, {
            syncTimeOffset: 0, initialSyncCompleted: true, frequency: 0, isAutoSync: false,
        });
        expect(result).toBe(baseTime);
    });

    test('initial sync rollback adds 1 day', () => {
        const result = computeEffectiveSyncAt(baseTime, {
            syncTimeOffset: 0, initialSyncCompleted: false, frequency: 0, isAutoSync: false,
        });
        expect(result).toBe('2026-03-23T12:00:00Z');
    });

    test('high-frequency auto-sync rollback adds 120s', () => {
        const result = computeEffectiveSyncAt(baseTime, {
            syncTimeOffset: 0, initialSyncCompleted: true, frequency: 3, isAutoSync: true,
        });
        expect(result).toBe('2026-03-24T11:58:00Z');
    });

    test('high-frequency rollback does NOT apply to manual sync', () => {
        const result = computeEffectiveSyncAt(baseTime, {
            syncTimeOffset: 0, initialSyncCompleted: true, frequency: 3, isAutoSync: false,
        });
        expect(result).toBe(baseTime);
    });

    test('high-frequency rollback does NOT apply when frequency >= 5', () => {
        const result = computeEffectiveSyncAt(baseTime, {
            syncTimeOffset: 0, initialSyncCompleted: true, frequency: 5, isAutoSync: true,
        });
        expect(result).toBe(baseTime);
    });

    test('all three rollbacks stack independently', () => {
        const result = computeEffectiveSyncAt(baseTime, {
            syncTimeOffset: 12, initialSyncCompleted: false, frequency: 2, isAutoSync: true,
        });
        expect(result).toBe('2026-03-22T23:58:00Z');
    });
});
