'use strict';
/*
 * REPRO #2 — "关闭插件，重建索引后，再打开插件…是不是「重建索引」导致的重复同步"
 *
 * Hypothesis: every dedup layer the plugin has is backed by SiYuan's SQL index
 * (IdIndex + getDocumentByPath + checkDocumentBySourceId). rebuildDataIndex
 * empties that index for a while; a sync landing inside that window is blind and
 * re-creates documents it already has.
 *
 * A/B: same re-sync of the same window, once with a warm index (control), once
 * right after rebuildDataIndex.
 */
const path = require('path');
const crypto = require('crypto');
const { startKernel } = require('./lib/kernel');
const { compileSyncModule } = require('./lib/compile-sync');
const { installPluginGlobals } = require('./lib/plugin-globals');

const API_KEY = process.env.KEY;
const ENDPOINT = process.env.ENDPOINT || 'https://siyuan.notebooksyncer.com/api/graphql';
const PORT = Number(process.env.SIYUAN_PORT || 6862);
const RUN_ID = process.env.RUN_ID || crypto.randomBytes(3).toString('hex');
const WORKSPACE = path.resolve(__dirname, '.runs', `repro2-${RUN_ID}`);
const log = (...a) => console.log('[repro2]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function counts(kernel) {
  const docs = await kernel.rest('/api/query/sql', { stmt: `SELECT count(*) c FROM blocks WHERE type='d'` });
  const srcIds = await kernel.rest('/api/query/sql', { stmt: `SELECT count(*) c FROM attributes WHERE name='custom-source-id'` });
  const mergeIds = await kernel.rest('/api/query/sql', { stmt: `SELECT count(*) c FROM attributes WHERE name='custom-merged-ids'` });
  return { docs: docs[0].c, sourceIdAttrs: srcIds[0].c, mergedIdAttrs: mergeIds[0].c };
}

async function main() {
  const g = installPluginGlobals();
  let kernel = null;
  try {
    kernel = await startKernel({ port: PORT, workspace: WORKSPACE });
    g.kernel = kernel;
    const nb = await kernel.rest('/api/notebook/createNotebook', { name: `repro2-${RUN_ID}` });
    const notebookId = nb.notebook.id;
    await kernel.rest('/api/notebook/openNotebook', { notebook: notebookId });
    log(`kernel ${kernel.base} up, notebook ${notebookId}`);

    const { SyncManager, DEFAULT_SETTINGS, MergeMode, ImageMode } = await compileSyncModule();
    // DEEP copy: SyncManager writes settings.deviceSyncCursors[deviceId] in place,
    // and a shallow {...DEFAULT_SETTINGS} shares that object with the module-level
    // default (the very hazard createDefaultSettings() documents) — a second mk()
    // would then inherit an advanced cursor and fetch nothing.
    const mk = () => ({
      ...JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
      apiKey: API_KEY, endpoint: ENDPOINT, targetNotebook: notebookId,
      mergeMode: MergeMode.MESSAGES, imageMode: ImageMode.DISABLED,
      syncAt: '', syncTimeOffset: 0, initialSyncCompleted: true, frequency: 0,
      deviceSyncCursors: {},
      refreshIndexAfterSync: true, logLevel: 'WARN',
    });
    const fakePlugin = { saveSettings: async () => {} };

    // ---------- SYNC #1: populate ----------
    const s1 = mk();
    log('--- SYNC #1 (populate) ---');
    const r1 = await new SyncManager(fakePlugin, s1).sync(false);
    log('sync#1:', JSON.stringify(r1));
    log('after#1 (immediately):', JSON.stringify(await counts(kernel)));
    // let SiYuan's async indexing settle so the control run really is "warm index"
    let prev = null, stable = 0;
    for (let i = 0; i < 40 && stable < 3; i++) {
      await sleep(500);
      const c = JSON.stringify(await counts(kernel));
      if (c === prev) stable++; else { stable = 0; prev = c; }
    }
    log('after#1 (index settled):', prev);

    // ---------- CONTROL: re-sync the SAME window with a warm index ----------
    log('\n--- CONTROL: re-sync same full window, index warm ---');
    const before = await counts(kernel);
    const rC = await new SyncManager(fakePlugin, mk()).sync(false);
    const afterC = await counts(kernel);
    log('control sync:', JSON.stringify(rC));
    log(`control docs ${before.docs} -> ${afterC.docs}  (created=${rC.count}, skipped=${rC.skipped})`);

    // ---------- B: rebuildDataIndex, then re-sync immediately ----------
    log('\n--- rebuildDataIndex, then re-sync with NO wait ---');
    const t0 = Date.now();
    await fetch('/api/system/rebuildDataIndex', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    log(`rebuildDataIndex returned after ${Date.now() - t0}ms`);

    // Fire the sync IMMEDIATELY (no await gap) — that is the race: a plugin
    // re-enable / auto-sync landing while the index is still being rebuilt.
    const beforeB = await counts(kernel);
    const syncPromise = new SyncManager(fakePlugin, mk()).sync(false);

    // sample the index the plugin's dedup reads while that sync runs
    const samples = [];
    const sampler = setInterval(async () => {
      try {
        const c = await counts(kernel);
        samples.push(`t+${String(Date.now() - t0).padStart(5)}ms docs=${c.docs} source-id=${c.sourceIdAttrs} merged-ids=${c.mergedIdAttrs}`);
      } catch (_) {}
    }, 150);
    const rB = await syncPromise;
    clearInterval(sampler);
    samples.slice(0, 24).forEach((s) => log('   ' + s));
    const afterB = await counts(kernel);
    log('rebuild-window sync:', JSON.stringify(rB));
    log(`rebuild docs ${beforeB.docs} -> ${afterB.docs}  (created=${rB.count}, skipped=${rB.skipped})`);

    // ---------- verdict ----------
    log('\n=== VERDICT ===');
    log(`control (warm index):   created=${rC.count} skipped=${rC.skipped}  docs ${before.docs}->${afterC.docs}`);
    log(`after rebuildDataIndex: created=${rB.count} skipped=${rB.skipped}  docs ${beforeB.docs}->${afterB.docs}`);
    const dupes = afterB.docs - beforeB.docs;
    log(`>>> ISSUE 2  rebuildDataIndex caused ${dupes} duplicate doc(s) — ${dupes > 0 ? 'REPRODUCED' : 'not reproduced'}`);

    // show duplicate titles if any
    const dupRows = await kernel.rest('/api/query/sql', {
      stmt: `SELECT content, count(*) n FROM blocks WHERE type='d' GROUP BY content HAVING count(*)>1 ORDER BY n DESC LIMIT 15`,
    });
    if (dupRows.length) {
      log('duplicated document titles:');
      dupRows.forEach((r) => log(`   x${r.n}  ${r.content}`));
    }
  } finally {
    if (kernel) { try { await kernel.stop(); log('kernel stopped'); } catch (e) {} }
  }
}
main().catch((e) => { console.error('[repro2] FATAL', e.stack || e); process.exit(1); });
