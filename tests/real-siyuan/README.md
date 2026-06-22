# real-siyuan E2E harness

Drives the plugin's **real sync code** against a **real, headless SiYuan kernel**
and asserts that synced articles land as documents — the SiYuan analogue of
`obsidian-plug/tests/real-obsidian`. No Docker, no Go, no Electron, no Xvfb.

## Why this works (and why it's simpler than real-obsidian)

SiYuan ships a standalone, statically-linked kernel binary
(`resources/kernel/SiYuan-Kernel`) that boots an HTTP server (~1s) serving both the
web UI and the `/api/*` REST surface the plugin calls. For this harness we do **not**
launch the UI or install the plugin into the kernel: the Node process *is* the
plugin runtime. `lib/compile-sync.js` bundles `src/sync/*` (the production source)
with esbuild, aliasing the `siyuan` UI module to a headless stub, and
`lib/plugin-globals.js` provides the `fetch`/`window` globals — so
`SyncManager.sync()` runs unmodified, with its `fetch('/api/...')` calls routed to
the live kernel.

This means the harness exercises the **exact production code path**, including
`SyncManager.refreshFiletree()` → `/api/filetree/refreshFiletree` +
`/api/ui/reloadFiletree` (and asserts the `/api/system/rebuildDataIndex` migration,
which was rolled back, is never called).

## Prerequisites

A SiYuan v3.6.5 Linux release extracted under `/home/work/siyuan-runtime` so that
`/home/work/siyuan-runtime/siyuan-3.6.5-linux/resources/kernel/SiYuan-Kernel`
exists. To (re)provision:

```bash
mkdir -p /home/work/siyuan-runtime && cd /home/work/siyuan-runtime
curl -L -o siyuan.tar.gz \
  https://github.com/siyuan-note/siyuan/releases/download/v3.6.5/siyuan-3.6.5-linux.tar.gz
tar xzf siyuan.tar.gz   # -> siyuan-3.6.5-linux/
```

Override the location with `SIYUAN_RUNTIME=/path/to/runtime`.

## Run

```bash
node tests/real-siyuan/run-sync-smoke.js
# or: npm run test:e2e:siyuan
```

Expected tail:

```
[e2e] ✅ PASS — 2 articles synced into real SiYuan as documents;
[e2e]          created=2, refreshFiletree calls=1, reloadFiletree calls=1, rebuildDataIndex calls=0
```

### Env vars

| var | default | meaning |
|---|---|---|
| `NOTEHELPER_API_KEY` | shared test key | omniserver user key used to seed/search/delete |
| `SIYUAN_PORT` | `6808` | kernel port (use `portBase+i` for parallel runs) |
| `N` | `2` | number of articles to seed |
| `RUN_ID` | random hex | unique per-run prefix (`QA-SiYuan-<RUN_ID>`) |
| `KEEP` | — | `KEEP=1` leaves the kernel + workspace up for inspection |
| `SIYUAN_RUNTIME` | `/home/work/siyuan-runtime` | where the extracted release lives |
| `SIYUAN_STUB_VERBOSE` | — | `1` echoes plugin `showMessage` + DEBUG logs |

## Layout

```
run-sync-smoke.js        orchestrator: seed → boot → sync → assert → cleanup
lib/
  kernel.js              launch/stop a headless kernel, poll boot, REST helper
  compile-sync.js        esbuild-bundle the real src/sync modules (siyuan stubbed)
  sync-entry.ts          re-exports the production SyncManager/FileHandler/settings
  siyuan-stub.js         headless stub of the `siyuan` SDK (showMessage = no-op)
  plugin-globals.js      fetch (→kernel) + window shims; counts endpoint hits
  omniserver-client.js   seed/search/delete on obsidian.notebooksyncer.com (reused
                         verbatim from real-obsidian — same backend)
.runs/                   throwaway per-run kernel workspaces (gitignored)
.compiled/               esbuild output (gitignored)
```

## Notes / discipline

- **Isolation & cleanup**: each run uses a unique `RUN_ID` prefix, a throwaway
  workspace + port, and deletes its seeded articles in a `finally` block (by
  prefix, so a crash still cleans up). Seed → sync → assert happen within the same
  day to stay inside the server's VIP `savedAfter` window.
- **Parallel runs**: give each its own `SIYUAN_PORT` (portBase+i) and `RUN_ID`;
  workspaces are already per-run.
- **Known side effect**: `SyncManager.sync()` fire-and-forgets `checkAndUpdate()`,
  which may pull the latest plugin build into the *throwaway* kernel workspace. It
  doesn't affect assertions and the workspace is discarded.
- **Reusability for new cases**: import `compileSyncModule()` + `startKernel()` +
  `installPluginGlobals()` and build new scenarios (merge modes, image modes,
  cursor behavior). Assert via `kernel.rest('/api/query/sql', { stmt })`.
```
