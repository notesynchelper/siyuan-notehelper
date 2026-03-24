# Five Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 5 features from obsidian-plug: sync notice optimization, batch message sorting, settings validation, initial sync rollback, high-frequency cursor rollback.

**Architecture:** Features are independent but share touchpoints in `syncManager.ts` and `settings/index.ts`. Tasks are ordered so cursor rollback (small, foundational) ships first, then SyncNoticeManager (new file), then batch sorting (biggest change), then validation (UI), then settings fields.

**Tech Stack:** TypeScript, SiYuan Plugin SDK (`showMessage`), Jest for tests, Mustache, Luxon.

**Spec:** `docs/superpowers/specs/2026-03-24-five-features-design.md`

---

### Task 1: Add new settings fields

**Files:**
- Modify: `src/settings/index.ts:37-99` (PluginSettings interface) and `src/settings/index.ts:102-169` (DEFAULT_SETTINGS)

- [ ] **Step 1: Add `messageSortOrder` and `initialSyncCompleted` to PluginSettings interface**

In `src/settings/index.ts`, add after line 52 (`refreshIndexAfterSync`):

```typescript
    messageSortOrder: string;  // 消息排序：'ASC' | 'DESC'
    initialSyncCompleted: boolean;  // 首次同步是否已完成
```

- [ ] **Step 2: Add defaults to DEFAULT_SETTINGS**

In `src/settings/index.ts`, add after line 117 (`refreshIndexAfterSync: true`):

```typescript
    messageSortOrder: 'ASC',
    initialSyncCompleted: false,
```

- [ ] **Step 3: Verify build**

Run: `cd /home/work/gate/siyuan-notehelper && npx webpack --mode development 2>&1 | tail -5`
Expected: no errors (new fields are unused so far, just declared)

- [ ] **Step 4: Commit**

```bash
git add src/settings/index.ts
git commit -m "feat: add messageSortOrder and initialSyncCompleted settings fields"
```

---

### Task 2: Sync cursor rollback (initial sync + high-frequency)

**Files:**
- Modify: `src/sync/syncManager.ts:33` (sync signature), `src/sync/syncManager.ts:86-150` (sync loop), `src/sync/syncManager.ts:197-207` (resetSyncTime), `src/sync/syncManager.ts:298-310` (startScheduledSync)
- Test: `tests/syncCursorRollback.test.ts`

- [ ] **Step 1: Write tests for cursor rollback logic**

Create `tests/syncCursorRollback.test.ts`:

```typescript
/**
 * Tests for sync cursor rollback logic.
 * The function computeEffectiveSyncAt applies three independent rollbacks:
 * 1. syncTimeOffset (hours)
 * 2. initialSyncCompleted=false → extra 1 day
 * 3. high-frequency auto-sync (freq < 5min) → extra 120s
 */

// We'll test the pure function extracted from SyncManager
import { computeEffectiveSyncAt } from '../src/sync/syncCursorAdjust';

describe('computeEffectiveSyncAt', () => {
    const baseTime = '2026-03-24T12:00:00Z';

    test('returns undefined when rawSyncAt is empty', () => {
        expect(computeEffectiveSyncAt('', { syncTimeOffset: 12, initialSyncCompleted: true, frequency: 0, isAutoSync: false })).toBeUndefined();
    });

    test('applies only syncTimeOffset when no other rollbacks apply', () => {
        const result = computeEffectiveSyncAt(baseTime, {
            syncTimeOffset: 12,
            initialSyncCompleted: true,
            frequency: 0,
            isAutoSync: false,
        });
        // 12:00 - 12h = 00:00
        expect(result).toBe('2026-03-24T00:00:00Z');
    });

    test('no rollback when syncTimeOffset is 0 and sync completed', () => {
        const result = computeEffectiveSyncAt(baseTime, {
            syncTimeOffset: 0,
            initialSyncCompleted: true,
            frequency: 0,
            isAutoSync: false,
        });
        expect(result).toBe(baseTime);
    });

    test('initial sync rollback adds 1 day', () => {
        const result = computeEffectiveSyncAt(baseTime, {
            syncTimeOffset: 0,
            initialSyncCompleted: false,
            frequency: 0,
            isAutoSync: false,
        });
        // 2026-03-24T12:00:00Z - 1 day = 2026-03-23T12:00:00Z
        expect(result).toBe('2026-03-23T12:00:00Z');
    });

    test('high-frequency auto-sync rollback adds 120s', () => {
        const result = computeEffectiveSyncAt(baseTime, {
            syncTimeOffset: 0,
            initialSyncCompleted: true,
            frequency: 3,  // < 5 minutes
            isAutoSync: true,
        });
        // 12:00:00 - 120s = 11:58:00
        expect(result).toBe('2026-03-24T11:58:00Z');
    });

    test('high-frequency rollback does NOT apply to manual sync', () => {
        const result = computeEffectiveSyncAt(baseTime, {
            syncTimeOffset: 0,
            initialSyncCompleted: true,
            frequency: 3,
            isAutoSync: false,
        });
        expect(result).toBe(baseTime);
    });

    test('high-frequency rollback does NOT apply when frequency >= 5', () => {
        const result = computeEffectiveSyncAt(baseTime, {
            syncTimeOffset: 0,
            initialSyncCompleted: true,
            frequency: 5,
            isAutoSync: true,
        });
        expect(result).toBe(baseTime);
    });

    test('all three rollbacks stack independently', () => {
        const result = computeEffectiveSyncAt(baseTime, {
            syncTimeOffset: 12,
            initialSyncCompleted: false,
            frequency: 2,
            isAutoSync: true,
        });
        // 12:00 - 12h = 00:00, - 1day = 2026-03-23T00:00:00, - 120s = 2026-03-22T23:58:00
        expect(result).toBe('2026-03-22T23:58:00Z');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/work/gate/siyuan-notehelper && npx jest tests/syncCursorRollback.test.ts --no-cache 2>&1 | tail -5`
Expected: FAIL — module `../src/sync/syncCursorAdjust` not found

- [ ] **Step 3: Create syncCursorAdjust.ts with the pure function**

Create `src/sync/syncCursorAdjust.ts`:

```typescript
/**
 * Pure function for computing effective sync cursor with rollbacks.
 * Extracted from SyncManager for testability.
 */

/** High-frequency sync threshold (minutes) */
const HIGH_FREQ_THRESHOLD_MINUTES = 5;

/** High-frequency rollback (milliseconds) = 120 seconds */
const HIGH_FREQ_ROLLBACK_MS = 120_000;

interface CursorAdjustOptions {
    syncTimeOffset: number;       // hours to rollback
    initialSyncCompleted: boolean;
    frequency: number;            // sync frequency in minutes
    isAutoSync: boolean;
}

/**
 * Compute effective sync cursor by applying three independent rollbacks:
 * 1. syncTimeOffset (hours) — always applied if > 0
 * 2. initialSyncCompleted === false — extra 1 day rollback
 * 3. high-frequency auto-sync (freq > 0 && freq < 5min && isAutoSync) — extra 120s
 *
 * @returns ISO string without milliseconds, or undefined if rawSyncAt is empty
 */
export function computeEffectiveSyncAt(
    rawSyncAt: string,
    options: CursorAdjustOptions
): string | undefined {
    if (!rawSyncAt) return undefined;

    const syncDate = new Date(rawSyncAt);

    // 1. Regular time offset rollback
    const offsetHours = options.syncTimeOffset || 0;
    if (offsetHours > 0) {
        syncDate.setHours(syncDate.getHours() - offsetHours);
    }

    // 2. Initial sync not completed: extra 1 day rollback
    if (!options.initialSyncCompleted) {
        syncDate.setDate(syncDate.getDate() - 1);
    }

    // 3. High-frequency auto-sync rollback
    if (
        options.isAutoSync &&
        options.frequency > 0 &&
        options.frequency < HIGH_FREQ_THRESHOLD_MINUTES
    ) {
        syncDate.setTime(syncDate.getTime() - HIGH_FREQ_ROLLBACK_MS);
    }

    return syncDate.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/work/gate/siyuan-notehelper && npx jest tests/syncCursorRollback.test.ts --no-cache 2>&1 | tail -10`
Expected: All 8 tests PASS

- [ ] **Step 5: Integrate into SyncManager**

Modify `src/sync/syncManager.ts`:

1. Add import at line 13:
```typescript
import { computeEffectiveSyncAt } from './syncCursorAdjust';
```

2. Change `sync()` signature at line 33:
```typescript
async sync(isAutoSync: boolean = false): Promise<SyncResult> {
```

3. Replace lines 86-128 (the fetch loop) — remove `allArticles` array, move `effectiveSyncAt` computation before the loop, process per-page. Replace the entire block from line 85 (`// 分批获取文章`) through line 150 (end of article processing loop) with:

```typescript
            // 计算有效的同步时间（三重回退叠加）
            const effectiveSyncAt = computeEffectiveSyncAt(rawSyncAt, {
                syncTimeOffset: this.settings.syncTimeOffset,
                initialSyncCompleted: this.settings.initialSyncCompleted,
                frequency: this.settings.frequency,
                isAutoSync,
            });
            if (effectiveSyncAt) {
                logger.debug(`有效同步时间: ${rawSyncAt} -> ${effectiveSyncAt}`);
            }

            // 分批获取并处理文章
            const batchSize = 15;
            let hasMore = true;
            let offset = 0;
            const errors: string[] = [];
            let skippedCount = 0;
            let createdCount = 0;

            while (hasMore) {
                logger.debug(`Fetching batch ${offset / batchSize + 1}...`);

                const [articles, hasNextPage] = await getItems(
                    this.settings.endpoint,
                    this.settings.apiKey,
                    offset,
                    batchSize,
                    effectiveSyncAt,
                    this.settings.customQuery || undefined,
                    includeContent
                );

                // 逐篇处理（批量处理在 Task 4 中实现）
                for (const article of articles) {
                    try {
                        const result = await this.fileHandler.processArticle(article, notebookId);
                        if (result.skipped) {
                            skippedCount++;
                        } else {
                            createdCount++;
                        }
                    } catch (error) {
                        const errorMsg = `Failed to process article ${article.id}: ${error}`;
                        logger.error(errorMsg);
                        errors.push(errorMsg);
                    }
                }

                hasMore = hasNextPage;
                offset += batchSize;

                if (offset > 1000) {
                    logger.warn('Reached maximum offset, stopping');
                    break;
                }
            }

            logger.debug(`Total processed. Created: ${createdCount}, Skipped: ${skippedCount}`);
```

4. Add `initialSyncCompleted` marking before the cursor update block (the "更新同步时间" section that starts with `const now = new Date()`):
```typescript
            // 标记首次同步已完成
            if (!this.settings.initialSyncCompleted) {
                this.settings.initialSyncCompleted = true;
                logger.debug('首次同步已完成，标记 initialSyncCompleted = true');
            }
```

5. In `resetSyncTime()` (line 197-207), add after line 202:
```typescript
        this.settings.initialSyncCompleted = false;
```

6. In `startScheduledSync()` (line 305), change `this.sync()` to `this.sync(true)`.

- [ ] **Step 6: Verify build**

Run: `cd /home/work/gate/siyuan-notehelper && npx webpack --mode development 2>&1 | tail -5`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/sync/syncCursorAdjust.ts src/sync/syncManager.ts tests/syncCursorRollback.test.ts
git commit -m "feat: add initial sync and high-frequency cursor rollback"
```

---

### Task 3: SyncNoticeManager

**Files:**
- Create: `src/sync/SyncNoticeManager.ts`
- Test: `tests/SyncNoticeManager.test.ts`
- Modify: `src/sync/syncManager.ts` (integrate)
- Modify: `src/index.ts:566-614` (remove showMessage calls from performSync, add isAutoSync param)

- [ ] **Step 1: Write tests for SyncNoticeManager**

Create `tests/SyncNoticeManager.test.ts`:

```typescript
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
        // No empty blocks
        expect(msg).not.toContain('□');
        // Completion message auto-dismisses (timeout > 0)
        expect(mockShowMessage.mock.calls[0][1]).toBe(5000);
    });

    test('showNoArticles shows message', () => {
        const mgr = new SyncNoticeManager();
        mgr.showNoArticles();
        expect(mockShowMessage).toHaveBeenCalledWith(
            expect.stringContaining('没有新文章'),
            3000,
            'info'
        );
    });

    test('showError classifies 401 as API key error', () => {
        const mgr = new SyncNoticeManager();
        const error = { status: 401 };
        mgr.showError(error);
        const msg = mockShowMessage.mock.calls[0][0];
        expect(msg).toContain('密钥无效');
    });

    test('showError classifies network error (no status)', () => {
        const mgr = new SyncNoticeManager();
        mgr.showError(new TypeError('Failed to fetch'));
        const msg = mockShowMessage.mock.calls[0][0];
        expect(msg).toContain('网络连接失败');
    });

    test('showError handles generic errors', () => {
        const mgr = new SyncNoticeManager();
        mgr.showError({ status: 500 });
        const msg = mockShowMessage.mock.calls[0][0];
        expect(msg).toContain('同步失败');
    });

    test('progress bar reserves 1 block when hasNextPage', () => {
        const mgr = new SyncNoticeManager();
        mgr.startSync();
        // 25 articles → ceil(25/5) = 5 blocks, but hasNextPage → fill max 4
        mgr.onBatchProcessed(25, true);
        const msg = mockShowMessage.mock.calls[mockShowMessage.mock.calls.length - 1][0];
        // Should have at least 1 empty block
        expect(msg).toContain('□');
    });

    test('progress bar fills all when last page', () => {
        const mgr = new SyncNoticeManager();
        mgr.startSync();
        mgr.onBatchProcessed(10, false);
        mockShowMessage.mockClear();
        mgr.completeSync(10);
        const msg = mockShowMessage.mock.calls[0][0];
        expect(msg).not.toContain('□');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/work/gate/siyuan-notehelper && npx jest tests/SyncNoticeManager.test.ts --no-cache 2>&1 | tail -5`
Expected: FAIL — module not found

- [ ] **Step 3: Implement SyncNoticeManager**

Create `src/sync/SyncNoticeManager.ts`:

```typescript
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
        // Ensure at least 1 filled
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/work/gate/siyuan-notehelper && npx jest tests/SyncNoticeManager.test.ts --no-cache 2>&1 | tail -10`
Expected: All 9 tests PASS

- [ ] **Step 5: Integrate SyncNoticeManager into SyncManager**

Modify `src/sync/syncManager.ts`:

1. Add import:
```typescript
import { SyncNoticeManager } from './SyncNoticeManager';
```

2. Inside `sync()`, after `logger.debug('Starting sync...')` (around line 50), add:
```typescript
            const notice = new SyncNoticeManager();
            notice.startSync();
```

3. Inside the while loop, after each page's article processing and before `hasMore = hasNextPage`, add:
```typescript
                notice.onBatchProcessed(articles.length, hasNextPage);
```

4. After the while loop completes (after all processing), replace the existing `logger.debug('Total processed...')` line. Add:
```typescript
            if (createdCount === 0 && skippedCount === 0 && errors.length === 0) {
                notice.showNoArticles();
            } else {
                notice.completeSync(createdCount);
            }
```

5. Declare `notice` before the try block so it's accessible in both try and catch:

Right after `this.settings.syncing = true;` (line 47), add:
```typescript
        const notice = new SyncNoticeManager();
```

Then in the try block, call `notice.startSync()` after `logger.debug('Starting sync...')`.

In the catch block (around line 181), add before the existing return:
```typescript
            notice.showError(error);
```

- [ ] **Step 6: Update index.ts performSync to remove redundant showMessage calls**

Modify `src/index.ts`:

1. Change `performSync()` signature (line 566) to accept isAutoSync:
```typescript
    private async performSync(isAutoSync: boolean = false) {
```

2. Remove `showMessage(this.i18n.zh_CN.syncing, 3000, 'info');` at line 585.

3. Change `this.syncManager.sync()` at line 587 to `this.syncManager.sync(isAutoSync)`.

4. Remove the entire result-handling block (lines 589-604) — success/failure messages are now handled by SyncNoticeManager inside sync().

5. In the catch block (lines 606-608), remove the `showMessage` call — SyncNoticeManager handles errors.

6. The `performSync` method becomes:
```typescript
    private async performSync(isAutoSync: boolean = false) {
        if (this.syncManager.isCurrentlySyncing()) {
            showMessage(this.i18n.zh_CN.errors?.syncInProgress || 'Sync in progress', 3000, 'info');
            return;
        }

        if (!this.settings.apiKey) {
            showMessage(this.i18n.zh_CN.errors?.noApiKey || 'No API key configured', 5000, 'error');
            return;
        }

        try {
            this.updateDockStatus();

            if (!this.settings.targetNotebook) {
                showMessage('请在设置中选择目标笔记本，当前使用默认笔记本', 5000, 'info');
            }

            await this.syncManager.sync(isAutoSync);
        } catch (error) {
            logger.error('Sync error:', error);
        } finally {
            this.settings.syncing = false;
            this.updateDockStatus();
        }
    }
```

7. Update `syncOnStart` call (line 249-251) to pass `true`:
```typescript
            setTimeout(() => {
                this.performSync(true);
            }, 10000);
```

- [ ] **Step 7: Verify build + run all tests**

Run: `cd /home/work/gate/siyuan-notehelper && npx webpack --mode development 2>&1 | tail -5 && npx jest --no-cache 2>&1 | tail -10`
Expected: build passes, all tests pass

- [ ] **Step 8: Commit**

```bash
git add src/sync/SyncNoticeManager.ts tests/SyncNoticeManager.test.ts src/sync/syncManager.ts src/index.ts
git commit -m "feat: add SyncNoticeManager with progress bar and error classification"
```

---

### Task 4: Batch message sorting (processArticleBatch)

**Files:**
- Modify: `src/sync/fileHandler.ts` (add `processArticleBatch` and `mergeArticleBatchToFile`)
- Modify: `src/sync/syncManager.ts` (switch from per-article to per-page batch)
- Test: `tests/batchSorting.test.ts`

- [ ] **Step 1: Write tests for sorting logic**

Create `tests/batchSorting.test.ts`:

```typescript
import { sortArticlesByTime } from '../src/sync/batchSortHelper';

describe('sortArticlesByTime', () => {
    const articles = [
        { id: '3', savedAt: '2026-03-24T12:30:00Z', title: 'c' },
        { id: '1', savedAt: '2026-03-24T12:00:00Z', title: 'a' },
        { id: '2', savedAt: '2026-03-24T12:15:00Z', title: 'b' },
    ] as any[];

    test('ASC sorts oldest first', () => {
        const sorted = sortArticlesByTime(articles, 'ASC');
        expect(sorted.map(a => a.id)).toEqual(['1', '2', '3']);
    });

    test('DESC sorts newest first', () => {
        const sorted = sortArticlesByTime(articles, 'DESC');
        expect(sorted.map(a => a.id)).toEqual(['3', '2', '1']);
    });

    test('does not mutate original array', () => {
        const original = [...articles];
        sortArticlesByTime(articles, 'ASC');
        expect(articles.map(a => a.id)).toEqual(original.map(a => a.id));
    });

    test('handles single item', () => {
        const sorted = sortArticlesByTime([articles[0]], 'ASC');
        expect(sorted).toHaveLength(1);
    });

    test('handles empty array', () => {
        const sorted = sortArticlesByTime([], 'ASC');
        expect(sorted).toEqual([]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/work/gate/siyuan-notehelper && npx jest tests/batchSorting.test.ts --no-cache 2>&1 | tail -5`
Expected: FAIL — module not found

- [ ] **Step 3: Create batchSortHelper.ts**

Create `src/sync/batchSortHelper.ts`:

```typescript
import { Article } from '../utils/types';

/**
 * Sort articles by savedAt timestamp.
 * Returns a new array (does not mutate input).
 */
export function sortArticlesByTime(articles: Article[], order: string): Article[] {
    return [...articles].sort((a, b) => {
        const timeA = new Date(a.savedAt).getTime();
        const timeB = new Date(b.savedAt).getTime();
        return order === 'ASC' ? timeA - timeB : timeB - timeA;
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/work/gate/siyuan-notehelper && npx jest tests/batchSorting.test.ts --no-cache 2>&1 | tail -10`
Expected: All 5 tests PASS

- [ ] **Step 5: Add processArticleBatch to FileHandler**

Modify `src/sync/fileHandler.ts`:

1. Add import at top (after line 30):
```typescript
import { sortArticlesByTime } from './batchSortHelper';
```

2. Add import for template functions already imported — `renderMergeFolderPath` and `renderSingleFilename` are already imported at lines 15-16. Good.

3. Add the new public method after `processArticle` (after line 110):

```typescript
    /**
     * 批量处理一页文章（合并类按目标文件分组、排序后批量写入）
     */
    async processArticleBatch(
        articles: Article[],
        notebookId: string
    ): Promise<{ created: number; skipped: number; errors: string[] }> {
        let created = 0;
        let skipped = 0;
        const errors: string[] = [];

        // 分离：需要合并的 vs 不需要合并的
        const toMerge: Article[] = [];
        const toSeparate: Article[] = [];
        for (const article of articles) {
            if (this.shouldMergeArticle(article)) {
                toMerge.push(article);
            } else {
                toSeparate.push(article);
            }
        }

        // 1. 不合并的文章逐篇处理（不变）
        for (const article of toSeparate) {
            try {
                const result = await this.createSeparateFile(article, notebookId);
                if (result.skipped) skipped++; else created++;
            } catch (error) {
                errors.push(`Failed to process article ${article.id}: ${error}`);
                logger.error(`[processArticleBatch] Error processing separate article ${article.id}:`, error);
            }
        }

        // 2. 合并的文章按目标文件路径分组
        const mergeGroups = new Map<string, Article[]>();
        for (const article of toMerge) {
            const mergeDate = isWeChatMessage(article.title)
                ? extractDateFromWeChatTitle(article.title) || article.savedAt.split('T')[0]
                : article.savedAt.split('T')[0];
            const folderPath = renderMergeFolderPath(article, this.settings);
            const filename = renderSingleFilename(mergeDate, this.settings);
            const key = joinPath(folderPath, filename);

            if (!mergeGroups.has(key)) {
                mergeGroups.set(key, []);
            }
            mergeGroups.get(key)!.push(article);
        }

        // 3. 每组排序后批量写入
        for (const [, groupArticles] of mergeGroups) {
            const sorted = sortArticlesByTime(groupArticles, this.settings.messageSortOrder || 'ASC');
            for (const article of sorted) {
                try {
                    const result = await this.mergeArticleToFile(article, notebookId);
                    if (result.skipped) skipped++; else created++;
                } catch (error) {
                    errors.push(`Failed to merge article ${article.id}: ${error}`);
                    logger.error(`[processArticleBatch] Error merging article ${article.id}:`, error);
                }
            }
        }

        return { created, skipped, errors };
    }
```

Note: This approach sorts within each group but still calls the existing `mergeArticleToFile` per article. This preserves all existing dedup, path resolution, and attribute logic. The optimization is **ordering** — articles are written in the correct time order. A future optimization could batch the actual file writes (read once, append all, write once), but that's a separate concern.

- [ ] **Step 6: Switch SyncManager to use processArticleBatch**

Modify `src/sync/syncManager.ts`. In the while loop inside `sync()`, replace the per-article processing block with:

```typescript
                // 批量处理本页文章（合并类排序后写入）
                const batchResult = await this.fileHandler.processArticleBatch(articles, notebookId);
                createdCount += batchResult.created;
                skippedCount += batchResult.skipped;
                errors.push(...batchResult.errors);
```

Remove the old per-article for loop that was added in Task 2 Step 5.

- [ ] **Step 7: Verify build + run all tests**

Run: `cd /home/work/gate/siyuan-notehelper && npx webpack --mode development 2>&1 | tail -5 && npx jest --no-cache 2>&1 | tail -10`
Expected: build passes, all tests pass

- [ ] **Step 8: Commit**

```bash
git add src/sync/batchSortHelper.ts src/sync/fileHandler.ts src/sync/syncManager.ts tests/batchSorting.test.ts
git commit -m "feat: add batch message sorting with per-page grouping and ordering"
```

---

### Task 5: Settings input validation

**Files:**
- Create: `src/settings/validation.ts`
- Test: `tests/validation.test.ts`
- Modify: `src/index.ts:422-443` (add blur validation)

- [ ] **Step 1: Write tests for validation functions**

Create `tests/validation.test.ts`:

```typescript
import { showMessage } from 'siyuan';
import { validateTemplate, validateDateFormat, validateNumberRange } from '../src/settings/validation';

jest.mock('siyuan');
const mockShowMessage = showMessage as jest.MockedFunction<typeof showMessage>;

beforeEach(() => {
    mockShowMessage.mockClear();
});

describe('validateTemplate', () => {
    test('accepts empty string', () => {
        expect(validateTemplate('', '字段')).toBe(true);
        expect(mockShowMessage).not.toHaveBeenCalled();
    });

    test('accepts valid Mustache template', () => {
        expect(validateTemplate('{{{title}}}', '字段')).toBe(true);
    });

    test('accepts template with section', () => {
        expect(validateTemplate('{{#labels}}{{{name}}}{{/labels}}', '字段')).toBe(true);
    });

    test('rejects unclosed section', () => {
        expect(validateTemplate('{{#labels}}{{{name}}}', '字段')).toBe(false);
        expect(mockShowMessage).toHaveBeenCalledWith(
            expect.stringContaining('模板语法错误'),
            5000,
            'error'
        );
    });

    test('rejects unclosed tag', () => {
        expect(validateTemplate('{{title', '字段')).toBe(false);
    });
});

describe('validateDateFormat', () => {
    test('accepts empty string', () => {
        expect(validateDateFormat('', '字段')).toBe(true);
    });

    test('accepts valid date format', () => {
        expect(validateDateFormat('yyyy-MM-dd', '字段')).toBe(true);
    });

    test('accepts format with time', () => {
        expect(validateDateFormat('yyyy-MM-dd HH:mm:ss', '字段')).toBe(true);
    });
});

describe('validateNumberRange', () => {
    test('rejects NaN', () => {
        expect(validateNumberRange('abc', '频率', 15, 1440)).toBe(false);
        expect(mockShowMessage).toHaveBeenCalledWith(
            expect.stringContaining('必须是数字'),
            5000,
            'error'
        );
    });

    test('rejects below min', () => {
        expect(validateNumberRange('5', '频率', 15, 1440)).toBe(false);
        expect(mockShowMessage).toHaveBeenCalledWith(
            expect.stringContaining('15-1440'),
            5000,
            'error'
        );
    });

    test('rejects above max', () => {
        expect(validateNumberRange('2000', '频率', 15, 1440)).toBe(false);
    });

    test('accepts in range', () => {
        expect(validateNumberRange('60', '频率', 15, 1440)).toBe(true);
    });

    test('allows zero when allowZero is true', () => {
        expect(validateNumberRange('0', '频率', 15, 1440, true)).toBe(true);
    });

    test('rejects zero when allowZero is false', () => {
        expect(validateNumberRange('0', '频率', 15, 1440)).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/work/gate/siyuan-notehelper && npx jest tests/validation.test.ts --no-cache 2>&1 | tail -5`
Expected: FAIL — module not found

- [ ] **Step 3: Implement validation.ts**

Create `src/settings/validation.ts`:

```typescript
import { showMessage } from 'siyuan';
import Mustache from 'mustache';
import { formatDate } from '../utils/util';

/**
 * Validate Mustache template syntax.
 * Catches unclosed tags and sections; does NOT validate variable names.
 */
export function validateTemplate(value: string, fieldName: string): boolean {
    if (!value) return true;
    try {
        Mustache.parse(value);
        return true;
    } catch (e) {
        showMessage(
            `${fieldName} 模板语法错误：${e instanceof Error ? e.message : String(e)}`,
            5000,
            'error'
        );
        return false;
    }
}

/**
 * Validate Luxon date format string.
 * Checks that formatting a known date produces output containing digits.
 */
export function validateDateFormat(value: string, fieldName: string): boolean {
    if (!value) return true;
    try {
        const testDate = '2026-06-15T14:30:45.000Z';
        const result = formatDate(testDate, value);
        if (!/\d/.test(result)) {
            showMessage(
                `${fieldName} 日期格式无效：格式化结果不包含数字，请检查格式字符串`,
                5000,
                'error'
            );
            return false;
        }
        return true;
    } catch (e) {
        showMessage(
            `${fieldName} 日期格式错误：${e instanceof Error ? e.message : String(e)}`,
            5000,
            'error'
        );
        return false;
    }
}

/**
 * Validate that a string represents a number within [min, max].
 * When allowZero is true, 0 is accepted regardless of min.
 */
export function validateNumberRange(
    value: string,
    fieldName: string,
    min: number,
    max: number,
    allowZero?: boolean
): boolean {
    const num = parseInt(value, 10);
    if (isNaN(num)) {
        showMessage(`${fieldName} 必须是数字`, 5000, 'error');
        return false;
    }
    if (allowZero && num === 0) return true;
    if (num < min || num > max) {
        showMessage(`${fieldName} 须在 ${min}-${max} 范围内`, 5000, 'error');
        return false;
    }
    return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/work/gate/siyuan-notehelper && npx jest tests/validation.test.ts --no-cache 2>&1 | tail -10`
Expected: All 12 tests PASS

- [ ] **Step 5: Integrate blur validation into index.ts**

Modify `src/index.ts`. Add import near the top (after other imports):

```typescript
import { validateTemplate, validateDateFormat, validateNumberRange } from './settings/validation';
```

Replace the settings auto-save block (lines 422-443, the `formInputs.forEach` section) with validation-aware logic:

```typescript
                    // 需要校验的字段映射
                    const templateFields = new Set(['folder', 'filename', 'mergeFolder', 'singleFileName', 'mergeFolderTemplate', 'template', 'wechatMessageTemplate', 'mergeMessageTemplate']);
                    const dateFormatFields = new Set(['folderDateFormat', 'filenameDateFormat', 'singleFileDateFormat', 'mergeFolderDateFormat', 'dateSavedFormat']);
                    const numberFields: Record<string, { name: string; min: number; max: number; allowZero?: boolean }> = {
                        frequency: { name: '同步频率（分钟）', min: 15, max: 1440, allowZero: true },
                        jpegQuality: { name: 'JPEG 质量', min: 1, max: 100 },
                        imageDownloadRetries: { name: '重试次数', min: 0, max: 10 },
                    };

                    const fieldNameMap: Record<string, string> = {
                        folder: '文章文件夹', filename: '文件名', mergeFolder: '合并文件夹',
                        singleFileName: '单文件名', mergeFolderTemplate: '合并路径模板',
                        template: '内容模板', wechatMessageTemplate: '企微消息模板',
                        mergeMessageTemplate: '合并消息模板',
                        folderDateFormat: '文件夹日期格式', filenameDateFormat: '文件名日期格式',
                        singleFileDateFormat: '单文件日期格式', mergeFolderDateFormat: '合并文件夹日期格式',
                        dateSavedFormat: '保存日期格式',
                    };

                    // 为所有输入框添加自动保存功能（使用防抖减少频繁保存）
                    let saveTimeout: any = null;
                    const formInputs = settingsArea.querySelectorAll('input, select, textarea');
                    formInputs.forEach((input) => {
                        const el = input as HTMLInputElement;
                        const fieldId = el.id;

                        // 缓存原始值用于校验失败时恢复
                        el.addEventListener('focus', () => {
                            el.dataset.prevValue = el.value;
                        });

                        // 需要校验的字段用 blur 事件
                        if (templateFields.has(fieldId) || dateFormatFields.has(fieldId) || numberFields[fieldId]) {
                            el.addEventListener('blur', () => {
                                let valid = true;
                                if (templateFields.has(fieldId)) {
                                    valid = validateTemplate(el.value, fieldNameMap[fieldId] || fieldId);
                                } else if (dateFormatFields.has(fieldId)) {
                                    valid = validateDateFormat(el.value, fieldNameMap[fieldId] || fieldId);
                                } else if (numberFields[fieldId]) {
                                    const cfg = numberFields[fieldId];
                                    valid = validateNumberRange(el.value, cfg.name, cfg.min, cfg.max, cfg.allowZero);
                                }

                                if (!valid) {
                                    el.value = el.dataset.prevValue || '';
                                    return;
                                }

                                // 校验通过，触发保存
                                if (saveTimeout) clearTimeout(saveTimeout);
                                saveTimeout = setTimeout(async () => {
                                    await this.saveSettingsFromContainer(dock.element);
                                    this.syncManager.stopScheduledSync();
                                    if (this.settings.frequency > 0) {
                                        this.syncManager.startScheduledSync();
                                    }
                                }, 500);
                            });
                        }

                        // 不需要校验的字段保持 change 事件
                        el.addEventListener('change', async () => {
                            if (templateFields.has(fieldId) || dateFormatFields.has(fieldId) || numberFields[fieldId]) {
                                return; // 已由 blur 处理
                            }
                            if (saveTimeout) clearTimeout(saveTimeout);
                            saveTimeout = setTimeout(async () => {
                                await this.saveSettingsFromContainer(dock.element);
                                this.syncManager.stopScheduledSync();
                                if (this.settings.frequency > 0) {
                                    this.syncManager.startScheduledSync();
                                }
                            }, 500);
                        });
                    });
```

- [ ] **Step 6: Verify build + run all tests**

Run: `cd /home/work/gate/siyuan-notehelper && npx webpack --mode development 2>&1 | tail -5 && npx jest --no-cache 2>&1 | tail -10`
Expected: build passes, all tests pass

- [ ] **Step 7: Commit**

```bash
git add src/settings/validation.ts tests/validation.test.ts src/index.ts
git commit -m "feat: add settings input validation with blur event and error messages"
```

---

### Task 6: Add messageSortOrder UI to SettingsForm

**Files:**
- Modify: `src/ui/SettingsForm.ts:145-156` (add sort order dropdown after mergeMode)
- Modify: `src/ui/SettingsForm.ts:475-555` (extract new field in extractFormValues)
- Modify: `src/index.ts:29-206` (add i18n strings)

- [ ] **Step 1: Add i18n strings**

In `src/index.ts`, add to the `zhCN` object (after `mergeModeAll` around line 70):

```typescript
    messageSortOrder: "消息排序",
    messageSortOrderDesc: "合并文件中消息的排序方式",
    messageSortOrderAsc: "正序（旧消息在前）",
    messageSortOrderDesc2: "倒序（新消息在前）",
```

- [ ] **Step 2: Add dropdown HTML in SettingsForm**

In `src/ui/SettingsForm.ts`, after the mergeMode `</div>` block (after line 156), add:

```html
                <div class="b3-label" id="messageSortOrderGroup" style="display: ${settings.mergeMode !== 'none' ? 'block' : 'none'};">
                    <div class="fn__flex">
                        <span class="fn__flex-1">${i18n.messageSortOrder || '消息排序'}</span>
                    </div>
                    <div class="fn__flex">
                        <select class="b3-select fn__flex-1" id="messageSortOrder">
                            <option value="ASC" ${settings.messageSortOrder === 'ASC' ? 'selected' : ''}>${i18n.messageSortOrderAsc || '正序（旧消息在前）'}</option>
                            <option value="DESC" ${settings.messageSortOrder !== 'ASC' ? 'selected' : ''}>${i18n.messageSortOrderDesc2 || '倒序（新消息在前）'}</option>
                        </select>
                    </div>
                    <div class="b3-label__text">${i18n.messageSortOrderDesc || '合并文件中消息的排序方式'}</div>
                </div>
```

- [ ] **Step 3: Toggle visibility with mergeMode**

In `src/ui/SettingsForm.ts`, in `bindEvents()`, find where `mergeModeSelect` change is handled. Add toggle logic. Search for the existing mergeMode-related `addEventListener` in bindEvents (if any), otherwise add after bindEvents setup:

In `bindEvents()`, add:
```typescript
        const mergeModeSelect = container.querySelector('#mergeMode') as HTMLSelectElement;
        const sortOrderGroup = container.querySelector('#messageSortOrderGroup') as HTMLElement;
        if (mergeModeSelect && sortOrderGroup) {
            mergeModeSelect.addEventListener('change', () => {
                sortOrderGroup.style.display = mergeModeSelect.value !== 'none' ? 'block' : 'none';
            });
        }
```

- [ ] **Step 4: Extract messageSortOrder in extractFormValues**

In `src/ui/SettingsForm.ts`, in `extractFormValues()`, add after the mergeMode extraction:

```typescript
        const messageSortOrderSelect = container.querySelector('#messageSortOrder') as HTMLSelectElement;
        if (messageSortOrderSelect) values.messageSortOrder = messageSortOrderSelect.value;
```

- [ ] **Step 5: Verify build**

Run: `cd /home/work/gate/siyuan-notehelper && npx webpack --mode development 2>&1 | tail -5`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/ui/SettingsForm.ts src/index.ts
git commit -m "feat: add message sort order dropdown in settings UI"
```

---

### Task 7: Final integration test + cleanup

**Files:**
- All modified files

- [ ] **Step 1: Run full test suite**

Run: `cd /home/work/gate/siyuan-notehelper && npx jest --no-cache --verbose 2>&1`
Expected: All tests pass

- [ ] **Step 2: Run build**

Run: `cd /home/work/gate/siyuan-notehelper && npx webpack --mode production 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 3: Verify no lint errors**

Run: `cd /home/work/gate/siyuan-notehelper && npx eslint src/ --ext .ts 2>&1 | tail -10`
Expected: No errors (warnings OK)

- [ ] **Step 4: Final commit if any cleanup needed**

Only if previous steps revealed issues that needed fixing.
