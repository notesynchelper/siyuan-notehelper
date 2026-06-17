'use strict';
/*
 * Real SiYuan E2E smoke: seed → real sync → assert docs landed in a real kernel.
 *
 * This is the SiYuan analogue of obsidian-plug/tests/real-obsidian/smoke.js. It
 * reuses that harness's discipline (unique per-run prefix, seed/sync/assert in the
 * same day, GraphQL cleanup in finally) but drives the plugin headlessly:
 *
 *   1. SEED   N test articles to obsidian.notebooksyncer.com under the test apiKey,
 *             each tagged with a unique QA-SiYuan-<runId> title prefix.
 *   2. BOOT   a real headless SiYuan v3.6.5 kernel on a throwaway workspace+port.
 *   3. SYNC   instantiate the plugin's REAL SyncManager (compiled from src/ with
 *             the `siyuan` UI module stubbed) and call .sync() against the kernel.
 *             This exercises createDocWithMd + setBlockAttrs + the migrated
 *             /api/system/rebuildDataIndex + /api/ui/reloadFiletree.
 *   4. ASSERT via the kernel's /api/query/sql that the synced docs exist, and that
 *             the migrated rebuildDataIndex endpoint actually fired (and the old
 *             deprecated endpoint did NOT).
 *   5. CLEAN  delete the seeded articles (by unique prefix) and stop the kernel.
 *
 * Run:  node tests/real-siyuan/run-sync-smoke.js
 * Env:  NOTEHELPER_API_KEY (default = shared test key), SIYUAN_PORT (default 6808),
 *       N (default 2), RUN_ID, KEEP=1 (keep workspace + kernel for inspection).
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
const PORT = Number(process.env.SIYUAN_PORT || 6808);
const N = Number(process.env.N || 2);
const KEEP = process.env.KEEP === '1';
const RUN_ID = process.env.RUN_ID || crypto.randomBytes(4).toString('hex');
const TITLE_PREFIX = `QA-SiYuan-${RUN_ID}`;
const LABEL = `qa-siyuan-${RUN_ID}`;
const WORKSPACE = path.resolve(__dirname, '.runs', `ws-${RUN_ID}`);

const log = (...a) => console.log('[e2e]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // Install plugin runtime globals BEFORE requiring the compiled plugin code.
  const g = installPluginGlobals();

  const client = createClient({ apiKey: API_KEY, base: OMNI_BASE });
  let kernel = null;
  let exitCode = 1;

  try {
    // 1. SEED
    log(`seeding ${N} articles, prefix=${TITLE_PREFIX}`);
    for (let i = 1; i <= N; i++) {
      await client.createArticle({
        title: `${TITLE_PREFIX}-${i}`,
        url: `https://example.com/${LABEL}/${i}`,
        author: 'e2e-bot',
        content: `# ${TITLE_PREFIX}-${i}\n\nReal-SiYuan e2e marker ${LABEL} body ${i}.`,
        siteName: 'e2e',
        wordsCount: 9,
        labels: [LABEL],
      });
      log(`  seeded #${i}: ${TITLE_PREFIX}-${i}`);
    }
    await sleep(1500); // let the seed settle on the server before searching

    // 2. BOOT
    log(`booting headless SiYuan kernel on :${PORT} (ws=${WORKSPACE})`);
    kernel = await startKernel({ port: PORT, workspace: WORKSPACE });
    g.kernel = kernel; // attach so the fetch shim routes '/api/...' here
    log(`kernel up: ${kernel.base} (token ${kernel.token.slice(0, 6)}…)`);

    // 3a. target notebook
    const nb = await kernel.rest('/api/notebook/createNotebook', { name: `e2e-${RUN_ID}` });
    const notebookId = nb.notebook.id;
    await kernel.rest('/api/notebook/openNotebook', { notebook: notebookId });
    log(`notebook created+opened: ${notebookId}`);

    // 3b. drive the REAL plugin sync
    const { SyncManager, DEFAULT_SETTINGS, MergeMode, ImageMode } = await compileSyncModule();
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
      refreshIndexAfterSync: true, // exercise the migrated rebuildDataIndex + reloadFiletree path
      customQuery: '',
      logLevel: process.env.SIYUAN_STUB_VERBOSE === '1' ? 'DEBUG' : 'WARN',
    };
    const fakePlugin = { saveSettings: async () => {} };
    const sm = new SyncManager(fakePlugin, settings);

    log('running SyncManager.sync() against the real kernel…');
    const result = await sm.sync(false);
    log('sync result:', JSON.stringify(result));

    // 4. ASSERT
    const safePrefix = TITLE_PREFIX.replace(/'/g, "''");
    const rows = await kernel.rest('/api/query/sql', {
      stmt: `SELECT id, type, content, hpath FROM blocks WHERE content LIKE '%${safePrefix}%'`,
    });
    const docBlocks = rows.filter((r) => r.type === 'd');
    log(`SQL: ${rows.length} blocks match ${TITLE_PREFIX}; ${docBlocks.length} are documents`);
    docBlocks.forEach((d) => log(`   doc: "${d.content}"  @ ${d.hpath}`));
    log(`fetch stats: ${JSON.stringify(g.stats)}`);

    const problems = [];
    if (result.success === false) problems.push(`sync.success=false errors=${JSON.stringify(result.errors)}`);
    if (docBlocks.length < N) problems.push(`expected >=${N} synced documents, found ${docBlocks.length}`);
    if (g.stats.rebuildDataIndex < 1) problems.push('migrated /api/system/rebuildDataIndex was never called');
    if (g.stats.refreshFiletreeOld > 0) problems.push('deprecated /api/filetree/refreshFiletree was called');

    if (problems.length) throw new Error('ASSERT FAILED:\n  - ' + problems.join('\n  - '));

    log(`✅ PASS — ${docBlocks.length} articles synced into real SiYuan as documents;`);
    log(`         created=${result.count}, rebuildDataIndex calls=${g.stats.rebuildDataIndex}, ` +
        `reloadFiletree calls=${g.stats.reloadFiletree}, deprecated-endpoint calls=${g.stats.refreshFiletreeOld}`);
    exitCode = 0;
  } finally {
    // 5. CLEANUP — stop kernel, delete seeded articles by unique prefix.
    if (kernel && !KEEP) {
      try { await kernel.stop(); log('kernel stopped'); } catch (e) { log('kernel stop error:', e.message); }
    } else if (kernel && KEEP) {
      log(`KEEP=1 — kernel left running at ${kernel.base} (pid ${kernel.pid}); stop with: kill -TERM ${kernel.pid}`);
    }
    try {
      const ids = await client.listIdsByText(TITLE_PREFIX);
      for (const id of ids) {
        try { await client.deleteArticle(id); } catch (e) { log(`delete ${id} failed: ${e.message}`); }
      }
      log(`cleaned up ${ids.length} seeded article(s)`);
    } catch (e) {
      log('cleanup search/delete error:', e.message);
    }
  }
  return exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => { console.error('[e2e] FATAL', err && err.stack ? err.stack : err); process.exit(1); });
