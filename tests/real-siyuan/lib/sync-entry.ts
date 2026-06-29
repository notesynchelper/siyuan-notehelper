// esbuild entry point for the headless harness.
//
// Re-exports the plugin's REAL sync modules so the harness drives the exact same
// code the plugin ships — including SyncManager.refreshFiletree() which calls the
// (now migrated) /api/system/rebuildDataIndex endpoint. Nothing here is a copy or
// a reimplementation; it is the production source bundled with the `siyuan` import
// aliased to a headless stub (see compile-sync.js).
export { SyncManager } from '../../../src/sync/syncManager';
export { FileHandler } from '../../../src/sync/fileHandler';
export { DEFAULT_SETTINGS } from '../../../src/settings';
export type { PluginSettings } from '../../../src/settings';
export { MergeMode, ImageMode, Filter } from '../../../src/utils/types';
// 「启动时同步」跨重载冷却闸——让 e2e 能在真实 sync 跑完后断言冷却是否生效。
export { shouldRunSyncOnStart, markAutoSyncStarted } from '../../../src/sync/syncOnStartGate';
