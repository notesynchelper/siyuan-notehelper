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

function showMessage(text, _timeout, type) {
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
