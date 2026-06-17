// Thin wrapper over obsidian.notebooksyncer.com's REST + GraphQL surface.
// Uses the plugin-side user key (NOT the admin key): create articles under
// that user's account, list/delete them via GraphQL.
//
// All endpoints documented in /home/work/gate/omniserver/API_DOCS.md.

'use strict';

const https = require('https');
const { URL } = require('url');

const DEFAULT_BASE = 'https://obsidian.notebooksyncer.com';

function request({ method, url, apiKey, body }) {
  const u = new URL(url);
  const data = body === undefined ? null : JSON.stringify(body);
  const headers = {
    'Accept': 'application/json',
    'x-api-key': apiKey,
  };
  if (data) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(data);
  }
  return new Promise((resolve, reject) => {
    const req = https.request({
      method,
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      headers,
      timeout: 20000,
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed = raw;
        try { parsed = JSON.parse(raw); } catch {}
        if (res.statusCode >= 400) {
          const err = new Error(`HTTP ${res.statusCode} ${method} ${u.pathname}: ${raw.slice(0, 400)}`);
          err.status = res.statusCode;
          err.body = parsed;
          return reject(err);
        }
        resolve(parsed);
      });
    });
    req.on('timeout', () => { req.destroy(new Error(`timeout ${method} ${url}`)); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function createClient({ apiKey, base = DEFAULT_BASE } = {}) {
  if (!apiKey) throw new Error('apiKey required');

  async function createArticle({
    title, url = null, author = null, content = '',
    description = null, image = null, siteName = null,
    wordsCount = 0, labels = [], publishedAt = null,
  }) {
    return request({
      method: 'POST', url: `${base}/api/articles`, apiKey,
      body: { title, url, author, content, description, image, siteName, wordsCount, labels, publishedAt },
    });
  }

  async function graphql(query, variables) {
    return request({
      method: 'POST', url: `${base}/api/graphql`, apiKey,
      body: { query, variables },
    });
  }

  async function searchArticles({ query = '', first = 20, after = 0 } = {}) {
    // The server does NOT parse the GraphQL selection set for this custom
    // endpoint — it only checks whether the query string contains the word
    // "search" and, if so, returns a FLAT shape: { edges: [{ node: article }],
    // pageInfo: {...} } (no `search`/`items` wrapper). So the field list below
    // is cosmetic; what matters is the literal word "search" being present.
    // ⚠️ 服务端按 variables.query 读搜索文本（见 omniserver index.js search 分支
    // `const { query: searchQuery } = variables`）。变量名必须叫 query，叫 q 会被丢弃 →
    // 返回该用户全部（窗口内）文章。曾导致 e2e 误判 + after-hook 误删风险（2026-06-04 实测）。
    const q = `query Search($query: String, $first: Int, $after: Int) {
      search(query: $query, first: $first, after: $after) {
        edges { node { id title url author savedAt updatedAt labels { name } } }
        pageInfo { totalCount hasNextPage endCursor }
      }
    }`;
    const res = await graphql(q, { query, first, after });
    return { edges: (res && res.edges) || [], pageInfo: (res && res.pageInfo) || {} };
  }

  // Collect every article id whose title/description ilike-matches `text`, by
  // paging the flat search endpoint from after=0 until pageInfo.hasNextPage is
  // false (or maxPages). Returns a de-duplicated string[] of node ids.
  //
  // ⚠️ The server's `search` path implicitly adds a VIP `savedAfter` filter
  // (default 3 days for free/expired users — see design §2.3). So callers MUST
  // keep seed → sync → search within the SAME day and use a pull_key (the
  // raw-openid path can hit a hidden 401 — design §2.1). Existence assertions
  // must rely ONLY on these node ids, never on pageInfo.totalCount (which is
  // just the current page length).
  async function listIdsByText(text, { pageSize = 50, maxPages = 20 } = {}) {
    const ids = new Set();
    let after = 0;
    for (let page = 0; page < maxPages; page++) {
      const { edges, pageInfo } = await searchArticles({ query: text, first: pageSize, after });
      for (const e of edges) {
        const id = e && e.node && e.node.id;
        if (id !== undefined && id !== null) ids.add(id);
      }
      if (!pageInfo || pageInfo.hasNextPage !== true) break;
      after += pageSize;
    }
    return Array.from(ids);
  }

  async function deleteArticle(articleId) {
    const m = `mutation Del($input: DeleteArticleInput!) {
      deleteArticle(input: $input) { article { id } }
    }`;
    return graphql(m, { input: { id: articleId } });
  }

  return { base, apiKey, createArticle, graphql, searchArticles, listIdsByText, deleteArticle };
}

module.exports = { createClient, DEFAULT_BASE };
