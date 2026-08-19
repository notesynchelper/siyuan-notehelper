'use strict';
/*
 * REPRO #1 — "微信消息也没有按时间合并，消息顺序挺混乱的"
 *            + "删除这条合并的消息，再重新同步，也不会重新生成这条消息"
 *
 * Drives the REAL SyncManager (v1.8.24 source) against a REAL headless SiYuan
 * 3.8.0 kernel, using the reporter's own cloud space. READ-ONLY on the server:
 * only search/fetch, never createArticle/deleteArticle.
 */
const path = require('path');
const crypto = require('crypto');
const { startKernel } = require('./lib/kernel');
const { compileSyncModule } = require('./lib/compile-sync');
const { installPluginGlobals } = require('./lib/plugin-globals');

const API_KEY = process.env.KEY;
const ENDPOINT = process.env.ENDPOINT || 'https://siyuan.notebooksyncer.com/api/graphql';
const PORT = Number(process.env.SIYUAN_PORT || 6861);
const RUN_ID = process.env.RUN_ID || crypto.randomBytes(3).toString('hex');
const WORKSPACE = path.resolve(__dirname, '.runs', `repro1-${RUN_ID}`);
const log = (...a) => console.log('[repro1]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// SiYuan's SQL index trails reality by a second or two (a removed doc keeps
// answering queries for ~2s). Assert only after it has stopped moving, otherwise
// the "did it come back?" check reads a stale row and flips verdicts run to run.
async function settle(kernel) {
  let prev = null, stable = 0;
  for (let i = 0; i < 60 && stable < 4; i++) {
    await sleep(400);
    let c;
    try {
      c = (await kernel.rest('/api/query/sql', { stmt: `SELECT count(*) c FROM blocks WHERE type='d'` }))[0].c;
    } catch (_) { stable = 0; prev = null; continue; }
    if (c === prev) stable++; else { stable = 0; prev = c; }
  }
  return prev;
}

async function docMarkdown(kernel, docId) {
  const d = await kernel.rest('/api/block/getBlockKramdown', { id: docId });
  return d.kramdown || '';
}

async function main() {
  const g = installPluginGlobals();
  let kernel = null;
  try {
    log(`booting SiYuan ${process.env.SIYUAN_VERSION || '3.6.5'} on :${PORT}`);
    kernel = await startKernel({ port: PORT, workspace: WORKSPACE });
    g.kernel = kernel;
    const nb = await kernel.rest('/api/notebook/createNotebook', { name: `repro1-${RUN_ID}` });
    const notebookId = nb.notebook.id;
    await kernel.rest('/api/notebook/openNotebook', { notebook: notebookId });
    log(`kernel up ${kernel.base}, notebook ${notebookId}`);

    const { SyncManager, DEFAULT_SETTINGS, MergeMode, ImageMode } = await compileSyncModule();

    // Record what each page actually contained, so the page split behind the observed
    // ordering is an OBSERVATION, not an after-the-fact inference (codex review #1).
    const pages = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input && input.url) || String(input);
      const res = await realFetch(input, init);
      if (!url.startsWith('/api/') && /graphql/.test(url)) {
        const clone = res.clone();
        try {
          const j = await clone.json();
          const edges = (j && (j.edges || (j.data && j.data.search && j.data.search.edges))) || [];
          pages.push(edges.map((e) => ({
            id: e.node.id, title: e.node.title, savedAt: e.node.savedAt, updatedAt: e.node.updatedAt,
          })));
        } catch (_) { /* not a search response */ }
      }
      return res;
    };

    // The reporter's setup: default merge mode (按日期合并微信消息), ASC sort.
    // Fresh install => empty cursor => pulls his whole VIP window, exactly like
    // his first sync would.
    const settings = {
      // DEEP copy: SyncManager writes settings.deviceSyncCursors[deviceId] in place, and a
      // shallow spread shares that nested object with the module-level default (the hazard
      // createDefaultSettings() documents) — a second settings object would then inherit an
      // advanced cursor. Harmless with one object per process, but it must not be copied.
      ...JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
      apiKey: API_KEY,
      endpoint: ENDPOINT,
      targetNotebook: notebookId,
      mergeMode: MergeMode.MESSAGES,   // default
      messageSortOrder: 'ASC',         // default
      imageMode: ImageMode.DISABLED,   // keep the repro light; irrelevant to ordering
      syncAt: '',
      syncTimeOffset: 0,
      deviceSyncCursors: {},
      initialSyncCompleted: true,
      frequency: 0,
      refreshIndexAfterSync: true,
      logLevel: 'WARN',
    };
    const saved = [];
    const fakePlugin = { saveSettings: async () => { saved.push(settings.syncAt); } };
    const sm = new SyncManager(fakePlugin, settings);

    log('--- SYNC #1 (fresh install, full window) ---');
    const r1 = await sm.sync(false);
    log('sync#1:', JSON.stringify(r1));
    log('cursor after sync#1:', settings.syncAt);

    // observed page composition (only the merge-eligible 同步助手_ messages matter here)
    log(`observed ${pages.length} page(s) from the server (updated_at DESC):`);
    pages.forEach((p, i) => {
      const msgs = p.filter((n) => /^同步助手_\d{8}/.test(n.title));
      log(`   page ${i + 1}: ${p.length} items, ${msgs.length} merge-eligible message(s)` +
          (msgs.length ? ' -> ' + msgs.map((m) => m.savedAt.slice(11, 19)).join(', ') : ''));
      const mismatch = p.filter((n) => n.updatedAt && n.savedAt !== n.updatedAt).length;
      if (mismatch) log(`             (${mismatch} item(s) where savedAt !== updatedAt)`);
    });

    // Find every merged message document the plugin produced.
    const merged = await kernel.rest('/api/query/sql', {
      stmt: `SELECT b.id, b.content, b.hpath FROM blocks b JOIN attributes a ON a.block_id=b.id
             WHERE a.name='custom-merge-doc' AND b.type='d' ORDER BY b.hpath`,
    });
    log(`merged docs: ${merged.length}`);
    for (const d of merged) log(`   ${d.hpath}  (${d.id})`);

    // Focus on 2026-08-17 — the day his complaint is about (8 messages).
    const target = merged.find((d) => /2026-08-17/.test(d.content) || /2026-08-17/.test(d.hpath))
                || merged.sort((a, b) => b.content.localeCompare(a.content))[0];
    if (!target) throw new Error('no merged doc produced');
    log(`\n=== inspecting merged doc: ${target.hpath} (${target.content}) ===`);

    const md = await docMarkdown(kernel, target.id);
    const stamps = [...md.matchAll(/##\s*📅\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/g)].map((m) => m[1]);
    log(`document order (${stamps.length} messages):`);
    stamps.forEach((s, i) => log(`   ${String(i + 1).padStart(2)}. ${s}`));

    const sortedAsc = [...stamps].sort();
    const inOrder = stamps.every((s, i) => s === sortedAsc[i]);
    log(`\nchronological order would be:`);
    sortedAsc.forEach((s, i) => log(`   ${String(i + 1).padStart(2)}. ${s}`));
    log(`\n>>> ISSUE 1a  ordered-by-time? ${inOrder ? 'YES (not reproduced)' : 'NO — REPRODUCED (顺序混乱)'}`);

    // ---- 1b: delete the merged doc, sync again, does it come back? ----
    log(`\n--- deleting merged doc ${target.hpath} then re-syncing ---`);
    await kernel.rest('/api/filetree/removeDocByID', { id: target.id });
    await settle(kernel);
    const after = await kernel.rest('/api/query/sql', {
      stmt: `SELECT id FROM blocks WHERE id='${target.id}'`,
    });
    log(`doc deleted (index settled); rows for that id now: ${after.length}`);

    log('--- SYNC #2 (same settings, cursor advanced by sync#1) ---');
    const r2 = await sm.sync(false);
    log('sync#2:', JSON.stringify(r2));
    log(`   articles fetched by sync#2: ${r2.count + (r2.skipped || 0)} ` +
        `(0 = the advanced cursor excluded them from the window entirely)`);
    await settle(kernel);

    const back = await kernel.rest('/api/query/sql', {
      stmt: `SELECT b.id, b.content, b.hpath FROM blocks b JOIN attributes a ON a.block_id=b.id
             WHERE a.name='custom-merge-doc' AND b.type='d' AND b.hpath='${target.hpath.replace(/'/g, "''")}'`,
    });
    log(`merged doc regenerated? rows=${back.length}`);
    log(`\n>>> ISSUE 1b  deleted-then-resync regenerates? ${back.length > 0 ? 'YES (not reproduced)' : 'NO — REPRODUCED (删了就再也不回来)'}`);
  } finally {
    if (kernel) { try { await kernel.stop(); log('kernel stopped'); } catch (e) { log('stop err', e.message); } }
  }
}
main().catch((e) => { console.error('[repro1] FATAL', e.stack || e); process.exit(1); });
