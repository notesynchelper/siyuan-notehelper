'use strict';
/*
 * REPRO #3 — "思源启动时思源同步还未完成，插件即开始了同步 … 这篇文章会重复"
 *
 * The plugin arms syncOnStart with a FIXED 10s setTimeout (src/index.ts). This
 * measures, on a realistically sized workspace, how long after boot SiYuan's SQL
 * index — the thing every plugin dedup layer reads — is actually complete, and
 * then runs a real sync at the 10s mark to see whether dedup holds.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { startKernel } = require('./lib/kernel');
const { compileSyncModule } = require('./lib/compile-sync');
const { installPluginGlobals } = require('./lib/plugin-globals');

const API_KEY = process.env.KEY;
const ENDPOINT = process.env.ENDPOINT || 'https://siyuan.notebooksyncer.com/api/graphql';
const PORT = Number(process.env.SIYUAN_PORT || 6865);
const FILLER = Number(process.env.FILLER || 2000);
const RUN_ID = process.env.RUN_ID || crypto.randomBytes(3).toString('hex');
const WORKSPACE = path.resolve(__dirname, '.runs', `repro3-${RUN_ID}`);
const log = (...a) => console.log('[repro3]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function counts(kernel) {
  const q = async (stmt) => (await kernel.rest('/api/query/sql', { stmt }))[0].c;
  return {
    docs: await q(`SELECT count(*) c FROM blocks WHERE type='d'`),
    srcIds: await q(`SELECT count(*) c FROM attributes WHERE name='custom-source-id'`),
    mergedIds: await q(`SELECT count(*) c FROM attributes WHERE name='custom-merged-ids'`),
  };
}
async function settle(kernel, label) {
  let prev = null, stable = 0;
  for (let i = 0; i < 240 && stable < 3; i++) {
    await sleep(500);
    const c = JSON.stringify(await counts(kernel));
    if (c === prev) stable++; else { stable = 0; prev = c; }
  }
  log(`${label}: ${prev}`);
  return JSON.parse(prev);
}

async function main() {
  const g = installPluginGlobals();
  let kernel = null;
  try {
    // ---------- PHASE 1: build a realistic workspace ----------
    kernel = await startKernel({ port: PORT, workspace: WORKSPACE, bootTimeoutMs: 120000 });
    g.kernel = kernel;
    const nb = await kernel.rest('/api/notebook/createNotebook', { name: `r3-${RUN_ID}` });
    const notebookId = nb.notebook.id;
    await kernel.rest('/api/notebook/openNotebook', { notebook: notebookId });
    log(`kernel up, notebook ${notebookId}`);

    const { SyncManager, DEFAULT_SETTINGS, MergeMode, ImageMode } = await compileSyncModule();
    const mk = () => ({
      ...JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
      apiKey: API_KEY, endpoint: ENDPOINT, targetNotebook: notebookId,
      mergeMode: MergeMode.MESSAGES, imageMode: ImageMode.DISABLED,
      syncAt: '', syncTimeOffset: 0, initialSyncCompleted: true, frequency: 0,
      deviceSyncCursors: {}, refreshIndexAfterSync: true, logLevel: 'WARN',
    });
    const fakePlugin = { saveSettings: async () => {} };

    log('--- real sync (the reporter\'s 53 articles) ---');
    log('sync: ' + JSON.stringify(await new SyncManager(fakePlugin, mk()).sync(false)));

    log(`--- padding workspace with ${FILLER} filler docs (realistic vault size) ---`);
    const t0 = Date.now();
    let made = 0;
    const CONC = 16;
    for (let i = 0; i < FILLER; i += CONC) {
      await Promise.all(
        Array.from({ length: Math.min(CONC, FILLER - i) }, (_, k) => {
          const n = i + k;
          return kernel.rest('/api/filetree/createDocWithMd', {
            notebook: notebookId,
            path: `/filler/${Math.floor(n / 100)}/doc-${n}`,
            markdown: `# filler ${n}\n\nlorem ipsum ${n} ${'x'.repeat(200)}\n`,
          }).then(() => { made++; }).catch(() => {});
        })
      );
      if (n_log(made)) log(`   ${made}/${FILLER} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    }
    function n_log(m) { return m % 500 === 0 && m > 0; }
    log(`filler done: ${made} docs in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    const settled = await settle(kernel, 'index settled (pre-restart)');

    // ---------- PHASE 2: restart, measure index readiness vs the plugin's 10s timer ----------
    log('\n--- restarting kernel (= SiYuan restart) ---');
    await kernel.stop();
    await sleep(1500);
    const tBootStart = Date.now();
    kernel = await startKernel({ port: PORT, workspace: WORKSPACE, bootTimeoutMs: 180000 });
    g.kernel = kernel;
    const bootMs = Date.now() - tBootStart;
    log(`bootProgress=100 after ${bootMs}ms — this is when the plugin's onload runs`);

    const timeline = [];
    const tReady = Date.now();
    let sampling = true;
    const sampler = (async () => {
      while (sampling) {
        try {
          const c = await counts(kernel);
          timeline.push({ t: Date.now() - tReady, ...c });
        } catch (_) {}
        await sleep(500);
      }
    })();

    // the plugin's syncOnStart: fixed 10s after onload
    await sleep(10000);
    const atTen = await counts(kernel);
    log(`\n>>> at t+10s (plugin's syncOnStart fires): docs=${atTen.docs}/${settled.docs}  ` +
        `source-id=${atTen.srcIds}/${settled.srcIds}  merged-ids=${atTen.mergedIds}/${settled.mergedIds}`);
    const blind = atTen.srcIds < settled.srcIds || atTen.mergedIds < settled.mergedIds || atTen.docs < settled.docs;
    log(`>>> index complete at the moment the plugin syncs? ${blind ? 'NO — dedup is blind' : 'yes'}`);

    log('--- running the real sync now, exactly as syncOnStart would ---');
    const before = await counts(kernel);
    const r = await new SyncManager(fakePlugin, mk()).sync(true);
    log('syncOnStart result: ' + JSON.stringify(r));
    sampling = false; await sampler;

    const after = await settle(kernel, 'index settled (post-sync)');
    log('\nindex-readiness timeline after boot:');
    timeline.filter((_, i) => i % 2 === 0).slice(0, 30)
      .forEach((s) => log(`   t+${String(s.t).padStart(6)}ms docs=${s.docs} source-id=${s.srcIds} merged-ids=${s.mergedIds}`));

    log('\n=== VERDICT ===');
    log(`pre-restart settled: docs=${settled.docs} source-id=${settled.srcIds} merged-ids=${settled.mergedIds}`);
    log(`at plugin sync time: docs=${before.docs} source-id=${before.srcIds} merged-ids=${before.mergedIds}`);
    log(`post-sync settled  : docs=${after.docs} source-id=${after.srcIds} merged-ids=${after.mergedIds}`);
    log(`sync created=${r.count} skipped=${r.skipped}`);
    log(`>>> ISSUE 3  duplicate articles created by the boot-time sync: ${r.count} — ${r.count > 0 ? 'REPRODUCED' : 'not reproduced at this vault size'}`);

    const dupRows = await kernel.rest('/api/query/sql', {
      stmt: `SELECT content, count(*) n FROM blocks WHERE type='d' AND content NOT LIKE 'filler%'
             GROUP BY content HAVING count(*)>1 ORDER BY n DESC LIMIT 12`,
    });
    if (dupRows.length) { log('duplicated titles:'); dupRows.forEach((x) => log(`   x${x.n}  ${x.content}`)); }
  } finally {
    if (kernel) { try { await kernel.stop(); log('kernel stopped'); } catch (e) {} }
  }
}
main().catch((e) => { console.error('[repro3] FATAL', e.stack || e); process.exit(1); });
