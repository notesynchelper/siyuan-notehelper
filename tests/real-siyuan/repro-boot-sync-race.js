'use strict';
/*
 * REPRO #3b — the ACTUAL mechanism behind
 *   "思源启动时思源同步还未完成，插件即开始了同步 … 导致这篇文章会重复"
 *
 * Not index lag (repro3 showed a 2000-doc vault is fully indexed 10s after boot).
 * The doc simply has not been DOWNLOADED yet: device A already synced article Y and
 * wrote Y.sy; device B's SiYuan cloud sync has not delivered Y.sy when the plugin's
 * syncOnStart fires. Every dedup layer looks for something that is not there yet, so
 * the plugin makes its own copy — and then SiYuan's sync delivers A's copy too.
 *
 * ARM 1 (bug): plugin syncs first, Y.sy arrives after      -> expect 2 docs for Y
 * ARM 2 (fix): Y.sy arrives first (= wait for sync-end)    -> expect 1 doc for Y
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { startKernel } = require('./lib/kernel');
const { compileSyncModule } = require('./lib/compile-sync');
const { installPluginGlobals } = require('./lib/plugin-globals');

const API_KEY = process.env.KEY;
const ENDPOINT = 'https://siyuan.notebooksyncer.com/api/graphql';
const RUN_ID = process.env.RUN_ID || crypto.randomBytes(3).toString('hex');
const RUNS = path.resolve(__dirname, '.runs');
const WS_A = path.join(RUNS, `r3b-A-${RUN_ID}`);
const log = (...a) => console.log('[repro3b]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// refreshFiletree can answer with an empty body -> kernel.rest()'s JSON.parse blows
// up. Fire it raw and ignore the response; we settle on the index afterwards.
async function refresh(k) {
  await fetch(`${k.base}/api/filetree/refreshFiletree`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Token ${k.token}` },
    body: '{}',
  }).catch(() => {});
}

async function settle(kernel) {
  let prev = null, stable = 0;
  for (let i = 0; i < 90 && stable < 4; i++) {
    await sleep(400);
    let c;
    try {
      // during rebuildDataIndex the kernel swaps the index DB and answers
      // "sql: database is closed" for a moment — that is not settled, keep polling.
      c = (await kernel.rest('/api/query/sql', { stmt: `SELECT count(*) c FROM blocks WHERE type='d'` }))[0].c;
    } catch (_) { stable = 0; prev = null; continue; }
    if (c === prev) stable++; else { stable = 0; prev = c; }
  }
  return prev;
}
const mkSettings = (DEFAULTS, MergeMode, ImageMode, notebookId) => ({
  ...JSON.parse(JSON.stringify(DEFAULTS)),
  apiKey: API_KEY, endpoint: ENDPOINT, targetNotebook: notebookId,
  mergeMode: MergeMode.MESSAGES, imageMode: ImageMode.DISABLED,
  syncAt: '', syncTimeOffset: 0, initialSyncCompleted: true, frequency: 0,
  deviceSyncCursors: {}, refreshIndexAfterSync: true, logLevel: 'WARN',
});

// A copied workspace makes the kernel rewrite conf.json shortly after boot, so the
// api.token startKernel captured can already be stale -> "Auth failed [header:
// Authorization]". Re-read the token from disk and retry once.
function withFreshToken(k, ws) {
  const readToken = () => {
    try { return JSON.parse(fs.readFileSync(path.join(ws, 'conf', 'conf.json'), 'utf8')).api.token; }
    catch (_) { return k.token; }
  };
  k.token = readToken();
  const rest = async (apiPath, body = {}) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await fetch(`${k.base}${apiPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Token ${k.token}` },
        body: JSON.stringify(body),
      });
      const text = await r.text();
      const j = text ? JSON.parse(text) : { code: 0, data: null };
      if (j.code === 0) return j.data;
      if (/Auth failed/i.test(j.msg || '') && attempt === 0) { k.token = readToken(); continue; }
      throw new Error(`kernel ${apiPath} -> code=${j.code} msg=${j.msg}`);
    }
  };
  k.rest = rest;
  return k;
}

async function main() {
  const g = installPluginGlobals();
  const { SyncManager, DEFAULT_SETTINGS, MergeMode, ImageMode } = await compileSyncModule();
  const fakePlugin = { saveSettings: async () => {} };
  let kernel = null;

  // ---------- DEVICE A: produce the cloud state ----------
  kernel = await startKernel({ port: 6891, workspace: WS_A });
  g.kernel = kernel;
  const nb = await kernel.rest('/api/notebook/createNotebook', { name: `r3b-${RUN_ID}` });
  const notebookId = nb.notebook.id;
  await kernel.rest('/api/notebook/openNotebook', { notebook: notebookId });
  log('device A: syncing the reporter\'s articles…');
  log('  ' + JSON.stringify(await new SyncManager(fakePlugin, mkSettings(DEFAULT_SETTINGS, MergeMode, ImageMode, notebookId)).sync(false)));
  await settle(kernel);

  // pick one separate-file article to be "the doc that hasn't arrived yet"
  const victim = (await kernel.rest('/api/query/sql', {
    stmt: `SELECT b.id,b.box,b.path,b.hpath,b.content,a.value AS src
           FROM blocks b JOIN attributes a ON a.block_id=b.id
           WHERE a.name='custom-source-id' AND b.type='d' ORDER BY b.hpath LIMIT 1`,
  }))[0];
  log(`victim doc: "${victim.content}"  source-id=${victim.src}  file=${victim.box}${victim.path}`);
  await kernel.stop();
  await sleep(800);

  async function arm(label, deliverFirst) {
    // Device B: its own fresh workspace. "SiYuan cloud sync" delivers device A's
    // notebook data files into it. Everything except the victim doc is already
    // there when B boots (steady state); the victim is the one still in flight.
    const WS = path.join(RUNS, `r3b-${label}-${RUN_ID}`);
    const dstBox = path.join(WS, 'data', victim.box);
    const srcBox = path.join(WS_A, 'data', victim.box);
    const victimRel = victim.path.replace(/^\//, '');
    fs.mkdirSync(path.join(WS, 'data'), { recursive: true });
    execFileSync('cp', ['-a', srcBox, dstBox]);
    fs.rmSync(path.join(dstBox, victimRel), { force: true });   // not downloaded yet

    const k = await startKernel({ port: label === 'BUG' ? 6892 : 6893, workspace: WS, bootTimeoutMs: 120000 });
    g.kernel = k;
    await k.rest('/api/notebook/openNotebook', { notebook: notebookId }).catch(() => {});
    await settle(k);

    const cnt = async () => (await k.rest('/api/query/sql', {
      stmt: `SELECT count(*) c FROM attributes WHERE name='custom-source-id' AND value='${victim.src}'`,
    }))[0].c;
    const total = async () => (await k.rest('/api/query/sql', {
      stmt: `SELECT count(*) c FROM attributes WHERE name='custom-source-id'`,
    }))[0].c;
    log(`\n[${label}] boot state: ${await total()} synced docs visible, victim article present ${await cnt()}x (0 = still downloading)`);

    const deliver = async () => {
      execFileSync('cp', ['-a', path.join(srcBox, victimRel), path.join(dstBox, victimRel)]);
      // a real cloud sync reindexes what it downloaded; refreshFiletree alone does
      // not pick up files dropped under data/, so force the index over them.
      await k.rest('/api/system/rebuildDataIndex', {}).catch(() => {});
      await settle(k);
      log(`[${label}] SiYuan sync delivered the doc -> victim article now present ${await cnt()}x`);
    };

    if (deliverFirst) {
      log(`[${label}] plugin WAITS for SiYuan's sync to finish first (the proposed fix)`);
      await deliver();
    }
    const r = await new SyncManager(fakePlugin, mkSettings(DEFAULT_SETTINGS, MergeMode, ImageMode, notebookId)).sync(true);
    log(`[${label}] plugin sync: ${JSON.stringify(r)}`);
    if (!deliverFirst) {
      log(`[${label}] …and only NOW does SiYuan's sync finish:`);
      await deliver();
    }
    await settle(k);
    const n = await cnt();
    const docs = await k.rest('/api/query/sql', {
      stmt: `SELECT b.hpath, b.id FROM blocks b JOIN attributes a ON a.block_id=b.id
             WHERE a.name='custom-source-id' AND a.value='${victim.src}'`,
    });
    log(`[${label}] RESULT: ${n} document(s) for article ${victim.src}`);
    docs.forEach((d) => log(`     ${d.hpath}   (block ${d.id})`));
    await k.stop();
    await sleep(500);
    return n;
  }

  const bug = await arm('BUG', false);
  const fix = await arm('FIX', true);

  log('\n=== VERDICT ===');
  log(`ARM 1 plugin syncs before SiYuan finished  -> ${bug} copies of the article  ${bug > 1 ? '❌ DUPLICATE — REPRODUCED' : 'no duplicate'}`);
  log(`ARM 2 plugin waits for SiYuan to finish    -> ${fix} copies of the article  ${fix === 1 ? '✅ no duplicate — the gate fixes it' : '❌'}`);
}
main().catch((e) => { console.error('[repro3b] FATAL', e.stack || e); process.exit(1); });
