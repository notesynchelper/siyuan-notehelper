'use strict';
/*
 * Real SiYuan E2E: verify the two v1.7.36 regressions are fixed, against a real kernel.
 *
 *   ISSUE #2 (notice spam): auto/scheduled sync used to pop a progress bar +
 *            "没有新文章需要同步" every interval, even with no new notes. Fix: auto
 *            sync (SyncManager.sync(true)) is now SILENT — it only toasts when real
 *            new notes landed or on a thrown error. Manual sync (sync(false)) keeps
 *            full feedback.
 *   ISSUE #1 (foreground re-sync): syncOnStart re-fired on every Android
 *            background→foreground reload. Fix: a cross-reload cooldown
 *            (shouldRunSyncOnStart) keyed on a localStorage timestamp that every auto
 *            sync refreshes (markAutoSyncStarted), so a reload within the cooldown
 *            window skips the syncOnStart trigger.
 *
 * Flow (one real kernel, one settings object reused so the sync cursor advances):
 *   SEED N → BOOT kernel → A) manual sync of fresh notes  → assert docs land + notices fired
 *                          B) auto sync, nothing new       → assert created=0 + ZERO notices (silent)
 *            SEED M more → C) auto sync of fresh notes      → assert created>=M + "同步完成" toast
 *                          D) cooldown gate                 → shouldRunSyncOnStart() false now, true after window
 *
 * Run:  node tests/real-siyuan/run-autosync-silent-smoke.js
 * Env:  NOTEHELPER_API_KEY, SIYUAN_PORT (default 6810), N (2), M (2), RUN_ID, KEEP=1.
 */
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('./lib/omniserver-client');
const { startKernel } = require('./lib/kernel');
const { compileSyncModule } = require('./lib/compile-sync');
const { installPluginGlobals } = require('./lib/plugin-globals');

const API_KEY = process.env.NOTEHELPER_API_KEY || 'o56E7690LHHXd5zvCAqoPobIuqq4';
const OMNI_BASE = 'https://obsidian.notebooksyncer.com';
const ENDPOINT = `${OMNI_BASE}/api/graphql`;
const PORT = Number(process.env.SIYUAN_PORT || 6810);
const N = Number(process.env.N || 2);
const M = Number(process.env.M || 2);
const KEEP = process.env.KEEP === '1';
const RUN_ID = process.env.RUN_ID || crypto.randomBytes(4).toString('hex');
const TITLE_PREFIX = `QA-Silent-${RUN_ID}`;
const LABEL = `qa-silent-${RUN_ID}`;
const WORKSPACE = path.resolve(__dirname, '.runs', `ws-${RUN_ID}`);

const log = (...a) => console.log('[e2e]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Only count sync-flow toasts; ignore the updater's "插件已更新" notice.
const SYNC_NOTICE_RE = /拉取数据|处理文章|同步完成|没有新文章|密钥无效|网络连接失败|同步失败/;
const syncNotices = () => (globalThis.__siyuanNotices || []).filter((n) => SYNC_NOTICE_RE.test(n.text));
const clearNotices = () => { globalThis.__siyuanNotices = []; };
const noticeTexts = () => syncNotices().map((n) => n.text);

async function seed(client, from, to) {
  for (let i = from; i <= to; i++) {
    await client.createArticle({
      title: `${TITLE_PREFIX}-${i}`,
      url: `https://example.com/${LABEL}/${i}`,
      author: 'e2e-bot',
      content: `# ${TITLE_PREFIX}-${i}\n\nReal-SiYuan auto-sync-silent marker ${LABEL} body ${i}.`,
      siteName: 'e2e',
      wordsCount: 9,
      labels: [LABEL],
    });
    log(`  seeded #${i}: ${TITLE_PREFIX}-${i}`);
  }
}

async function main() {
  const g = installPluginGlobals();
  const client = createClient({ apiKey: API_KEY, base: OMNI_BASE });
  let kernel = null;
  let exitCode = 1;
  const problems = [];

  try {
    // 1. SEED batch 1
    log(`seeding ${N} articles, prefix=${TITLE_PREFIX}`);
    await seed(client, 1, N);
    await sleep(1500);

    // 2. BOOT
    log(`booting headless SiYuan kernel on :${PORT} (ws=${WORKSPACE})`);
    kernel = await startKernel({ port: PORT, workspace: WORKSPACE });
    g.kernel = kernel;
    log(`kernel up: ${kernel.base}`);

    const nb = await kernel.rest('/api/notebook/createNotebook', { name: `e2e-${RUN_ID}` });
    const notebookId = nb.notebook.id;
    await kernel.rest('/api/notebook/openNotebook', { notebook: notebookId });
    log(`notebook created+opened: ${notebookId}`);

    const { SyncManager, DEFAULT_SETTINGS, MergeMode, ImageMode, shouldRunSyncOnStart } =
      await compileSyncModule();
    const syncAt = new Date(Date.now() - 5 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const settings = {
      ...DEFAULT_SETTINGS,
      apiKey: API_KEY,
      endpoint: ENDPOINT,
      targetNotebook: notebookId,
      mergeMode: MergeMode.NONE,
      imageMode: ImageMode.DISABLED,
      folder: `e2e/${RUN_ID}`,
      filename: '{{{title}}}',
      syncAt,
      syncTimeOffset: 0,
      initialSyncCompleted: true,
      frequency: 0,
      refreshIndexAfterSync: false,
      customQuery: '',
      logLevel: process.env.SIYUAN_STUB_VERBOSE === '1' ? 'DEBUG' : 'ERROR',
    };
    const sm = new SyncManager({ saveSettings: async () => {} }, settings);

    // ── Scenario A: MANUAL sync of fresh notes → not silent, docs land ──────────
    clearNotices();
    log('A) manual sync (sync(false)) of fresh notes…');
    const rA = await sm.sync(false);
    log(`   result=${JSON.stringify(rA)}  notices=${JSON.stringify(noticeTexts())}`);
    if (rA.success === false) problems.push(`A: manual sync failed: ${JSON.stringify(rA.errors)}`);
    if ((rA.count || 0) < N) problems.push(`A: expected >=${N} created, got ${rA.count}`);
    if (syncNotices().length === 0) problems.push('A: manual sync produced NO notice (should give feedback)');
    if (!noticeTexts().some((t) => t.includes('同步完成'))) problems.push('A: manual sync missing 同步完成 toast');

    // assert docs really landed in the kernel
    const safePrefix = TITLE_PREFIX.replace(/'/g, "''");
    const rows = await kernel.rest('/api/query/sql', {
      stmt: `SELECT id, type FROM blocks WHERE type='d' AND content LIKE '%${safePrefix}%'`,
    });
    if (rows.length < N) problems.push(`A: expected >=${N} docs in kernel, found ${rows.length}`);
    log(`   kernel has ${rows.length} synced doc(s)`);

    // ── Scenario B: AUTO sync, nothing new → SILENT ─────────────────────────────
    clearNotices();
    log('B) auto sync (sync(true)) with no new notes…');
    const rB = await sm.sync(true);
    log(`   result=${JSON.stringify(rB)}  notices=${JSON.stringify(noticeTexts())}`);
    if ((rB.count || 0) !== 0) problems.push(`B: expected 0 created (dedup/cursor), got ${rB.count}`);
    if (syncNotices().length !== 0) problems.push(`B: auto sync with no new notes was NOT silent: ${JSON.stringify(noticeTexts())}`);
    else log('   ✓ auto sync was silent (no toast)');

    // ── Scenario C: AUTO sync of fresh notes → still notifies new notes ─────────
    log(`C) seeding ${M} more, then auto sync…`);
    await seed(client, N + 1, N + M);
    await sleep(1500);
    clearNotices();
    const rC = await sm.sync(true);
    log(`   result=${JSON.stringify(rC)}  notices=${JSON.stringify(noticeTexts())}`);
    if ((rC.count || 0) < M) problems.push(`C: expected >=${M} created, got ${rC.count}`);
    if (!noticeTexts().some((t) => t.includes('同步完成'))) problems.push('C: auto sync of NEW notes should still toast 同步完成');
    if (noticeTexts().some((t) => /拉取数据|处理文章/.test(t))) problems.push('C: auto sync leaked progress-bar toasts (should be suppressed)');
    else log('   ✓ auto sync notified new notes WITHOUT progress-bar spam');

    // ── Scenario D: cross-reload cooldown gate ──────────────────────────────────
    log('D) cooldown gate (shouldRunSyncOnStart)…');
    const blockedNow = shouldRunSyncOnStart();                       // auto syncs above just marked it
    const allowedLater = shouldRunSyncOnStart(Date.now() + 6 * 60 * 1000);
    log(`   shouldRunSyncOnStart()=${blockedNow}  (+6min)=${allowedLater}`);
    if (blockedNow !== false) problems.push('D: cooldown should BLOCK syncOnStart right after an auto sync (foreground reload)');
    if (allowedLater !== true) problems.push('D: cooldown should ALLOW syncOnStart after the window elapses');
    if (blockedNow === false && allowedLater === true) log('   ✓ foreground reload within window is debounced; allowed after window');

    if (problems.length) throw new Error('ASSERT FAILED:\n  - ' + problems.join('\n  - '));

    log('✅ PASS — auto-sync silent (#2) + syncOnStart cooldown (#1) verified against real SiYuan');
    log(`         A created=${rA.count} (notified), B created=${rB.count} (silent), C created=${rC.count} (notified)`);
    exitCode = 0;
  } finally {
    if (kernel && !KEEP) {
      try { await kernel.stop(); log('kernel stopped'); } catch (e) { log('kernel stop error:', e.message); }
    } else if (kernel && KEEP) {
      log(`KEEP=1 — kernel left at ${kernel.base} (pid ${kernel.pid}); stop: kill -TERM ${kernel.pid}`);
    }
    try {
      const ids = await client.listIdsByText(TITLE_PREFIX);
      for (const id of ids) {
        try { await client.deleteArticle(id); } catch (e) { log(`delete ${id} failed: ${e.message}`); }
      }
      log(`cleaned up ${ids.length} seeded article(s)`);
    } catch (e) {
      log('cleanup error:', e.message);
    }
  }
  return exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => { console.error('[e2e] FATAL', err && err.stack ? err.stack : err); process.exit(1); });
