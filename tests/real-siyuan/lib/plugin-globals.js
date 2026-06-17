'use strict';
// Install the browser/runtime globals the plugin's sync code expects, so the real
// modules run unmodified under Node:
//   * fetch  — relative '/api/...' calls are routed to the live kernel with an
//              admin token; absolute URLs (omniserver GraphQL) pass through.
//   * window — localStorage (device-id persistence), setInterval/clearInterval,
//              and siyuan.config.system.os (platform detection).
// Returns a handle whose .stats counts kernel/omniserver calls and, specifically,
// the rebuildDataIndex / reloadFiletree hits so the harness can assert the
// migrated endpoint actually fired.
function installPluginGlobals() {
  const stats = { kernel: 0, omni: 0, rebuildDataIndex: 0, reloadFiletree: 0, refreshFiletreeOld: 0 };
  const handle = { kernel: null, stats };

  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    if (url.startsWith('/api/')) {
      const k = handle.kernel;
      if (!k) throw new Error(`kernel not attached for relative fetch ${url}`);
      stats.kernel++;
      if (url.includes('/api/system/rebuildDataIndex')) stats.rebuildDataIndex++;
      if (url.includes('/api/ui/reloadFiletree')) stats.reloadFiletree++;
      if (url.includes('/api/filetree/refreshFiletree')) stats.refreshFiletreeOld++;
      const headers = Object.assign({}, init.headers, { Authorization: `Token ${k.token}` });
      return realFetch(`${k.base}${url}`, Object.assign({}, init, { headers }));
    }
    stats.omni++;
    return realFetch(input, init);
  };

  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, val) => { store.set(key, String(val)); },
      removeItem: (key) => { store.delete(key); },
    },
    setInterval: (...a) => setInterval(...a),
    clearInterval: (...a) => clearInterval(...a),
    siyuan: { config: { system: { os: 'linux' } } },
  };

  return handle;
}

module.exports = { installPluginGlobals };
