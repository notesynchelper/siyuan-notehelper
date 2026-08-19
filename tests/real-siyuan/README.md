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

One or more SiYuan Linux releases extracted under `/home/work/siyuan-runtime`, so
that `siyuan-<version>-linux/resources/kernel/SiYuan-Kernel` exists. Provision with:

```bash
tests/real-siyuan/provision-runtime.sh 3.8.0     # download + extract (idempotent)
```

Currently provisioned: **3.6.5** (default) and **3.8.0**. Override the location with
`SIYUAN_RUNTIME=/path/to/runtime`.

### Testing against a specific SiYuan version

Every runner honours `SIYUAN_VERSION` (default `3.6.5`), so a bug report can be
replayed on the version the user is actually running:

```bash
SIYUAN_VERSION=3.8.0 node tests/real-siyuan/run-sync-smoke.js
```

⚠️ **3.8.0 changed the kernel CLI.** Serving moved from bare flags
(`SiYuan-Kernel --wd … --port …`, which 3.6.5 wants) to a cobra subcommand
(`SiYuan-Kernel serve --wd … --port …`). Given the old form, 3.8.0 prints usage and
exits, so the harness just hangs until the boot timeout. `lib/kernel.js` probes
`--help` once per process and picks the right argv, so newly provisioned releases
work without editing a version table.

## Run

```bash
node tests/real-siyuan/run-sync-smoke.js
# or: npm run test:e2e:siyuan
# or against 3.8.0: SIYUAN_VERSION=3.8.0 node tests/real-siyuan/run-sync-smoke.js
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
| `SIYUAN_RUNTIME` | `/home/work/siyuan-runtime` | where the extracted releases live |
| `SIYUAN_VERSION` | `3.6.5` | which extracted release to drive (`3.6.5`, `3.8.0`, …) |
| `SIYUAN_STUB_VERBOSE` | — | `1` echoes plugin `showMessage` + DEBUG logs |

## UI E2E（dock 徽标 / 官方设置入口）

`run-sync-smoke.js` 那套是 Node 重驱动 `src/sync/*`，内核只当 `/api` 后端，**不加载插件**——
验证不了任何 UI。要验证 UI 就得让插件真的在内核前端里跑起来：

```bash
npm run build && npm run test:e2e:ui      # 断言 + 截图，全自动
```

`run-ui-shot-verify.js` 会：把 `dist/` 真装进一个一次性 workspace（`petals.json` +
`bazaar.trust`）→ 起内核 → 用系统 Chrome（playwright 借的隔壁 outsourcescrper 那份）
打开真 UI → 逐条断言 + 截图到 `.runs/shots/` → 关掉内核。当前覆盖 18 条断言：

- dock 按钮上挂出徽标、只有一个、状态/提示/颜色正确
- **徽标不能盖住 dock 按钮中心**（按钮实测只有 27x26px，做大了会抢掉「开面板」这个主操作）
- 点徽标触发同步且**不冒泡**去开合面板；点按钮本体照常开面板
- 「设置 → 已下载插件」的齿轮判据成立（`__proto__.hasOwnProperty("openSetting")`）
- 齿轮弹出完整设置表单；**全局只有一份活表单**（dock 那份让位）；关窗后 dock 表单复位

只想人工看看的话：`node tests/real-siyuan/run-ui-shot.js`（装好插件把内核留着）。
⚠️ 内核在没有 UI 连上来时会自己退出（`kernel.log` 里 `no active UI proc` → `exited kernel`），
所以要尽快打开它打印的 URL。

## Layout

```
provision-runtime.sh     download + extract a SiYuan release into SIYUAN_RUNTIME
run-sync-smoke.js        orchestrator: seed → boot → sync → assert → cleanup
run-ui-shot.js           boot a kernel with the real plugin installed (bootWithPlugin)
run-ui-shot-verify.js    UI E2E: real Chrome → assert dock badge + settings entry → screenshots
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
