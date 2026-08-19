'use strict';
/* 1b, precise: the user said "删除这条合并的消息" — one message inside the merged doc,
   not the whole document. Does that ever come back?
   Also re-checks the whole-doc case under the DEFAULT syncTimeOffset=12 (not 0). */
const path = require('path');
const crypto = require('crypto');
const { startKernel } = require('./lib/kernel');
const { compileSyncModule } = require('./lib/compile-sync');
const { installPluginGlobals } = require('./lib/plugin-globals');
const API_KEY = process.env.KEY;
const PORT = Number(process.env.SIYUAN_PORT || 6897);
const RUN_ID = process.env.RUN_ID || crypto.randomBytes(3).toString('hex');
const WORKSPACE = path.resolve(__dirname, '.runs', `repro1e-${RUN_ID}`);
const log = (...a) => console.log('[repro1e]', ...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function settle(k) {
  let prev = null, stable = 0;
  for (let i = 0; i < 60 && stable < 4; i++) {
    await sleep(400);
    let c; try { c = (await k.rest('/api/query/sql', { stmt: `SELECT count(*) c FROM blocks` }))[0].c; }
    catch (_) { stable = 0; prev = null; continue; }
    if (c === prev) stable++; else { stable = 0; prev = c; }
  }
}
async function main() {
  const g = installPluginGlobals();
  let kernel = null;
  try {
    kernel = await startKernel({ port: PORT, workspace: WORKSPACE });
    g.kernel = kernel;
    const nb = await kernel.rest('/api/notebook/createNotebook', { name: `r1e-${RUN_ID}` });
    const notebookId = nb.notebook.id;
    await kernel.rest('/api/notebook/openNotebook', { notebook: notebookId });
    const { SyncManager, DEFAULT_SETTINGS, MergeMode, ImageMode } = await compileSyncModule();
    const settings = {
      ...JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
      apiKey: API_KEY, endpoint: 'https://siyuan.notebooksyncer.com/api/graphql',
      targetNotebook: notebookId, mergeMode: MergeMode.MESSAGES, imageMode: ImageMode.DISABLED,
      syncAt: '', initialSyncCompleted: true, frequency: 0, deviceSyncCursors: {},
      refreshIndexAfterSync: true, logLevel: 'WARN',
      // DEFAULT syncTimeOffset (12h) this time — the reporter's real setting.
    };
    log(`syncTimeOffset = ${settings.syncTimeOffset} (default)`);
    const sm = new SyncManager({ saveSettings: async () => {} }, settings);
    log('sync#1: ' + JSON.stringify(await sm.sync(false)));
    await settle(kernel);

    const doc = (await kernel.rest('/api/query/sql', {
      stmt: `SELECT id, content FROM blocks WHERE type='d' AND content='同步助手_2026-08-17'`,
    }))[0];
    const mergedIdsOf = async () => {
      const r = await kernel.rest('/api/attr/getBlockAttrs', { id: doc.id });
      return JSON.parse(r['custom-merged-ids'] || '[]');
    };
    const stampsOf = async () => {
      const md = (await kernel.rest('/api/block/getBlockKramdown', { id: doc.id })).kramdown || '';
      return [...md.matchAll(/##\s*📅\s*(\d{4}-\d{2}-\d{2} (\d{2}:\d{2}:\d{2}))/g)].map(m => m[2]);
    };
    log(`merged doc ${doc.content}: ${(await stampsOf()).length} messages, merged-ids=${(await mergedIdsOf()).length}`);

    // delete ONE message heading block inside the merged doc
    const heads = await kernel.rest('/api/query/sql', {
      stmt: `SELECT id, content FROM blocks WHERE root_id='${doc.id}' AND type='h' ORDER BY sort LIMIT 3`,
    });
    log(`heading blocks found: ${heads.length}${heads.length ? ' e.g. ' + JSON.stringify(heads[0].content) : ''}`);
    if (heads.length) {
      await kernel.rest('/api/block/deleteBlock', { id: heads[0].id });
      await settle(kernel);
      log(`deleted ONE message block "${heads[0].content}"`);
      log(`   now: ${(await stampsOf()).length} messages in doc, merged-ids still = ${(await mergedIdsOf()).length}`);
      log('   sync again (cursor advanced): ' + JSON.stringify(await sm.sync(false)));
      await settle(kernel);
      log(`   after resync: ${(await stampsOf()).length} messages, merged-ids=${(await mergedIdsOf()).length}`);
      await sm.resetSyncTime();
      log('   sync again (cursor RESET): ' + JSON.stringify(await sm.sync(false)));
      await settle(kernel);
      const st = await stampsOf();
      log(`   after reset+resync: ${st.length} messages, merged-ids=${(await mergedIdsOf()).length}`);
      log(`>>> deleted single message restored? ${st.length >= 8 ? 'YES' : 'NO — REPRODUCED (永远回不来)'}`);
    }
  } finally { if (kernel) { try { await kernel.stop(); } catch (e) {} } }
}
main().catch(e => { console.error('FATAL', e.stack || e); process.exit(1); });
