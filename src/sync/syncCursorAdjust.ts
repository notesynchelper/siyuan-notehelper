const HIGH_FREQ_THRESHOLD_MINUTES = 5;
const HIGH_FREQ_ROLLBACK_MS = 120_000;

interface CursorAdjustOptions {
    syncTimeOffset: number;
    initialSyncCompleted: boolean;
    frequency: number;
    isAutoSync: boolean;
}

export function computeEffectiveSyncAt(
    rawSyncAt: string,
    options: CursorAdjustOptions
): string | undefined {
    if (!rawSyncAt) return undefined;

    const syncDate = new Date(rawSyncAt);

    const offsetHours = options.syncTimeOffset || 0;
    if (offsetHours > 0) {
        syncDate.setHours(syncDate.getHours() - offsetHours);
    }

    if (!options.initialSyncCompleted) {
        syncDate.setDate(syncDate.getDate() - 1);
    }

    if (options.isAutoSync && options.frequency > 0 && options.frequency < HIGH_FREQ_THRESHOLD_MINUTES) {
        syncDate.setTime(syncDate.getTime() - HIGH_FREQ_ROLLBACK_MS);
    }

    return syncDate.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
