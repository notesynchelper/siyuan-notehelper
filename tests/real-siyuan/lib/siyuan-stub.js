'use strict';
// Headless stub for the `siyuan` SDK module.
//
// The plugin's sync path only pulls `showMessage` from `siyuan` (via
// SyncNoticeManager + updater). In a real SiYuan client `showMessage` renders a
// toast; in the Node harness there is no DOM, so we swallow it (set
// SIYUAN_STUB_VERBOSE=1 to echo notices for debugging). The other named exports
// are defensive no-ops in case esbuild pulls a UI module into the bundle.
const verbose = process.env.SIYUAN_STUB_VERBOSE === '1';
const noop = () => {};

// Record every toast the plugin would have shown so the harness can assert on
// notice behavior (auto-sync must be silent; manual sync must give feedback).
// Lives on globalThis so the harness (which requires this via the esbuild bundle)
// can read/clear it: globalThis.__siyuanNotices = [{text, timeout, type, id}].
function showMessage(text, timeout, type, id) {
  (globalThis.__siyuanNotices || (globalThis.__siyuanNotices = [])).push({
    text, timeout, type: type || 'info', id,
  });
  if (verbose) console.log(`[siyuan.showMessage:${type || 'info'}]`, text);
}

class Plugin {}
class Dialog {}
class Menu {}
class Setting {}

module.exports = {
  showMessage,
  Plugin,
  Dialog,
  Menu,
  Setting,
  getFrontend: () => 'desktop',
  getBackend: () => 'linux',
  fetchPost: noop,
  fetchSyncPost: noop,
  openTab: noop,
};
