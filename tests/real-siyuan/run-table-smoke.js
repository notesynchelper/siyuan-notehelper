'use strict';
/*
 * Real SiYuan E2E — HTML TABLE conversion check.
 *
 * Seeds an article whose body contains an HTML <table> wrapped in markdown,
 * runs the plugin's REAL sync against a headless kernel, then inspects the
 * resulting blocks to answer the decisive question:
 *
 *   When the plugin "auto-converts a detected HTML table", what block type
 *   actually lands in SiYuan?
 *     - native SiYuan table block  → blocks.type = 't'   (NodeTable)
 *     - embedded HTML block        → blocks.type = 'html' (NodeHTMLBlock)
 *
 * It also verifies the surrounding markdown segments landed as their own blocks
 * (i.e. splitContentByTables really split intro / table / outro).
 *
 * Run:  node tests/real-siyuan/run-table-smoke.js
 * Keep: KEEP=1 node tests/real-siyuan/run-table-smoke.js   (leaves kernel up for
 *       a browser screenshot; prints the doc id + UI url + auth code)
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
const KEEP = process.env.KEEP === '1';
const AUTH_CODE = process.env.SIYUAN_AUTH_CODE || 'e2e-test-code';
const RUN_ID = process.env.RUN_ID || crypto.randomBytes(4).toString('hex');
const TITLE_PREFIX = `QA-SiYuanTable-${RUN_ID}`;
const LABEL = `qa-siyuan-table-${RUN_ID}`;
const WORKSPACE = path.resolve(__dirname, '.runs', `ws-tbl-${RUN_ID}`);

const log = (...a) => console.log('[tbl-e2e]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A clearly-recognisable HTML table surrounded by markdown so we can also
// confirm the intro/outro split into their own blocks.
const TABLE_HTML = [
  '<table>',
  '<thead><tr><th>City</th><th>Population</th><th>Country</th></tr></thead>',
  '<tbody>',
  '<tr><td>Tokyo</td><td>37,400,068</td><td>Japan</td></tr>',
  '<tr><td>Delhi</td><td>28,514,000</td><td>India</td></tr>',
  '<tr><td>Shanghai</td><td>25,582,000</td><td>China</td></tr>',
  '</tbody>',
  '</table>',
].join('\n');

function buildBody(prefix) {
  return [
    `Intro paragraph before the table — marker ${prefix}-INTRO.`,
    '',
    TABLE_HTML,
    '',
    `Closing paragraph after the table — marker ${prefix}-OUTRO.`,
  ].join('\n');
}

async function main() {
  const g = installPluginGlobals();
  const client = createClient({ apiKey: API_KEY, base: OMNI_BASE });
  let kernel = null;
  let exitCode = 1;

  try {
    // 1. SEED one article with an HTML table embedded in its body.
    log(`seeding 1 table article, prefix=${TITLE_PREFIX}`);
    await client.createArticle({
      title: `${TITLE_PREFIX}-1`,
      url: `https://example.com/${LABEL}/1`,
      author: 'e2e-bot',
      content: buildBody(TITLE_PREFIX),
      siteName: 'e2e',
      wordsCount: 30,
      labels: [LABEL],
    });
    await sleep(1500);

    // 2. BOOT a real headless kernel.
    log(`booting headless SiYuan kernel on :${PORT} (ws=${WORKSPACE})`);
    kernel = await startKernel({ port: PORT, workspace: WORKSPACE, authCode: AUTH_CODE });
    g.kernel = kernel;
    log(`kernel up: ${kernel.base} (token ${kernel.token.slice(0, 6)}…)`);

    // 3a. target notebook
    const nb = await kernel.rest('/api/notebook/createNotebook', { name: `e2e-tbl-${RUN_ID}` });
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
      refreshIndexAfterSync: true,
      customQuery: '',
      logLevel: process.env.SIYUAN_STUB_VERBOSE === '1' ? 'DEBUG' : 'WARN',
    };
    const sm = new SyncManager({ saveSettings: async () => {} }, settings);

    log('running SyncManager.sync() against the real kernel…');
    const result = await sm.sync(false);
    log('sync result:', JSON.stringify(result));

    // give the kernel a beat to persist + index the appended blocks
    await sleep(1500);

    // 4. INSPECT — find the doc, then dump every block under it.
    const safePrefix = TITLE_PREFIX.replace(/'/g, "''");
    const docs = await kernel.rest('/api/query/sql', {
      stmt: `SELECT id, hpath, content FROM blocks WHERE type='d' AND content LIKE '%${safePrefix}%'`,
    });
    if (!docs.length) throw new Error(`document not found for prefix ${TITLE_PREFIX}`);
    const doc = docs[0];
    log(`doc: ${doc.id}  "${doc.content}"  @ ${doc.hpath}`);

    const blocks = await kernel.rest('/api/query/sql', {
      stmt: `SELECT id, type, subtype, sort, length(markdown) AS mdlen,
                    substr(content,1,90) AS content, substr(markdown,1,160) AS markdown
             FROM blocks WHERE root_id='${doc.id}' ORDER BY sort, created`,
    });
    log(`blocks under doc (${blocks.length}):`);
    for (const b of blocks) {
      log(`   [type=${b.type}${b.subtype ? '/' + b.subtype : ''}] ${JSON.stringify(b.content)}`);
    }

    const tableNative = blocks.filter((b) => b.type === 't');     // NodeTable
    const tableHtml = blocks.filter((b) => b.type === 'html');    // NodeHTMLBlock
    const paragraphs = blocks.filter((b) => b.type === 'p');

    // Did the HTML block actually carry our table markup? The `content`/`markdown`
    // FTS columns are EMPTY for a NodeHTMLBlock (the table text is not indexed) —
    // the real markup lives in the block kramdown, so read that directly.
    let htmlCarriesTable = false;
    let htmlKramdown = '';
    for (const b of tableHtml) {
      const km = await kernel.rest('/api/block/getBlockKramdown', { id: b.id });
      const md = (km && (km.kramdown || km.data)) || '';
      if (/Tokyo|<table|City/i.test(md)) { htmlCarriesTable = true; htmlKramdown = md; }
    }
    const intro = paragraphs.some((b) => /INTRO/.test(b.content || ''));
    const outro = paragraphs.some((b) => /OUTRO/.test(b.content || ''));

    log('--- verdict ---');
    log(`native SiYuan table blocks (type='t'):    ${tableNative.length}`);
    log(`embedded HTML blocks      (type='html'):  ${tableHtml.length}  (carries table markup: ${htmlCarriesTable})`);
    if (htmlKramdown) log(`   html block kramdown: ${JSON.stringify(htmlKramdown.slice(0, 220))}`);
    log(`intro paragraph present: ${intro}   outro paragraph present: ${outro}`);
    log(`fetch stats: ${JSON.stringify(g.stats)}`);

    const problems = [];
    if (result.success === false) problems.push(`sync.success=false errors=${JSON.stringify(result.errors)}`);
    // The plugin's design converts a detected table into an embedded HTML block.
    if (tableHtml.length < 1 && tableNative.length < 1) {
      problems.push('no table-bearing block found (neither type=html nor type=t)');
    }
    if (tableHtml.length >= 1 && !htmlCarriesTable) {
      problems.push('html block present but does not contain the table markup');
    }
    if (!intro || !outro) {
      problems.push(`surrounding markdown not split into paragraphs (intro=${intro}, outro=${outro})`);
    }
    const kind = tableNative.length >= 1 ? "native SiYuan table block (type='t')"
                                         : "embedded HTML block (type='html', NodeHTMLBlock)";
    if (problems.length === 0) {
      log(`✅ PASS — HTML table synced as: ${kind}`);
      exitCode = 0;
    } else {
      log(`⚠️ verdict has issues:\n  - ${problems.join('\n  - ')}`);
      log(`(table landed as: ${kind})`);
    }

    if (KEEP) {
      log('================ KEEP=1: kernel left up for screenshot ================');
      log(`UI url   : ${kernel.base}/`);
      log(`auth code: ${AUTH_CODE}`);
      log(`doc id   : ${doc.id}   (open: ${kernel.base}/stage/build/desktop/?id=${doc.id})`);
      log(`pid      : ${kernel.pid}   (stop with: kill -TERM ${kernel.pid})`);
      // keep this process alive so the spawned kernel isn't reaped (cleanup of the
      // seeded omniserver article still ran above? no — skip cleanup under KEEP).
      log('(this script will sleep; Ctrl-C or kill to end)');
      await new Promise(() => {});
    }

    if (problems.length) throw new Error('ASSERT FAILED:\n  - ' + problems.join('\n  - '));
  } finally {
    if (kernel && !KEEP) {
      try { await kernel.stop(); log('kernel stopped'); } catch (e) { log('kernel stop error:', e.message); }
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
  .catch((err) => { console.error('[tbl-e2e] FATAL', err && err.stack ? err.stack : err); process.exit(1); });
