# Docker 版后台定时同步方案 V2.1（kernel plugin）

日期：2026-09-24（V2.1，吸收 codex 二轮复审：5 闭环 + 8 未闭环 + 2 新增，全部处理见 §0.1）
状态：已按 codex 两轮复检修订，进入编码
V1 评审结论：方向可行但需修改——核心问题：文件锁不可靠、设置/游标共享状态冲突、适配范围低估。V2 全部采纳。

## 0.1 V2.1 对二轮复审未闭环项的处置

| # | 处置 |
|---|---|
| 1 互斥 | 状态机改四态：`unsupported` / `kernel-active`（petal enabled && kernel.existed && ping ok）/**`kernel-owned-unreachable`**（petal enabled && kernel.existed 但 ping 失败）→ **绝不本地自动同步**，手动同步报错可重试（不回退）；`local`（petal 未启用或无 kernel.js）→ 本地模式。确定性判据来自 `loadPetals`（返回 petal.enabled/kernel.existed，已实验验证）。残余窄窗口=kernel 恰在 ping 时崩溃——进程死则不写，安全 |
| 2 生命周期 | onunload 不等待长任务；中断安全 = 游标仅在完整同步结束后推进（现状）+ source-id 去重 → 中断后下轮重拉剩余、去重拦截。重载=新进程新实例，无隔离问题 |
| 3 迁移/冷却 | 迁移由所有者执行：kernel-active 态仅 kernel onload 迁移；local 态仅前端。冷却戳**保留 localStorage**（前端专属，桌面/手机行为不变）；docker+kernel 态 syncOnStart 的冷却判定 = max(localStorage 戳, state.lastSyncAt【只读】) |
| 4 luxon | e2e 增加综合格式断言（数字 token/中文字面/cccc/Z 快照）；已知差异写入 README：后台模式建议数字 token |
| 7 静态依赖 | `checkAndUpdate` 从 SyncManager.sync() 移出到浏览器入口包装；`refreshFiletree()` 直接 fetch 补入 §6.2 清单；**定时器职责移出入口层**（index.ts 与 kernel.ts 各自 setInterval，SyncManager 只暴露 sync()，核心内 window.* 全部排查清零） |
| 8 所有权 | applySettings 立即重排（0→正数起表 / 正数→0 停表 / 频率未变不重排）；返回 {running, effectiveFrequencyMinutes, appliedAt}；失败重试 1 次后提示「已保存，下轮生效」——不回退本地 |
| 9 重置顺序 | isSyncing 时返回 busy，前端提示稍后重试；非 busy 原子写 state |
| 11 覆盖条件 | 具体记录：合并模式文档在 kernel 追加块时恰逢思源云同步拉下旧版本 → 可能正文覆盖；README 风险表建议开云同步多设备用户谨慎 |
| 12 验收 | e2e 真实等待 ≥1 个 effective 周期（10min，可接受）；补：mock 500 断言游标不推进；unload/reload（setPetalEnabled 开关）冒烟；运行中 applySettings 断言 nextRunAt 变化 |
| 13 频率校验 | docker 前端允许 **0 或 10–1440**；kernel clamp：`Number.isFinite(freq)&&freq>0 ? min(1440,max(10,floor(freq))) : 不启动`（拒 Infinity/NaN） |
| 新1 reason | triggerSync(reason): manual→sync(false) 完整通知语义；scheduled/onstart→sync(true) 静默 |
| 新2 冷却 | 同 #3：localStorage 保留 |

## 0.2 V2 相对 V1 的关键决策变化

| V1 | V2（响应 codex #1/#2/#3） |
|---|---|
| 文件锁跨 runtime 互斥 | **删除文件锁**。Docker+kernel 运行时采用**单写者模型**：所有同步（定时/手动/重置游标/启动同步）统一由 kernel 执行，前端一律 RPC 触发。互斥退化为 kernel 进程内既有 `isSyncing` |
| settings 单文件整存整取，前端 kernel 共写 | **状态拆分**：用户配置（`notehelper-settings`，仅前端写）与同步状态（`notehelper-sync-state`：游标/lastSyncAt/冷却戳，仅 kernel 写[kernel 模式]或仅前端写[本地模式]）分离 |
| 手动同步留在前端 | Docker+kernel 模式下手动同步走 `triggerSync` RPC；RPC 失败单次回退本地执行并重探测 |
| luxon 固定时区 | 补 `defaultLocale='en-US'`（已实测：仅固定 zone 不够，`fromISO` 仍读 locale 抛 `Intl is not defined`；两行设置后插件全部用法路径通过） |

## 1. 目标

Docker 版思源（≥3.7.0）在不打开浏览器的情况下，由 kernel.js 在内核进程内执行定时同步与手动同步。桌面/手机行为完全不变。

## 2. 能力检测与设置页文案（需求点 1）

检测（前端）：

```ts
const MIN_KERNEL_APP_VERSION = '3.7.0';
// window.siyuan.config.system.container === 'docker'
// window.siyuan.config.system.kernelVersion === '3.8.5' …
isBackgroundCapable(): container==='docker' && semverGte(kernelVersion, MIN_KERNEL_APP_VERSION)
```

前端调度状态机（codex #8：区分三态，不只覆盖启动入口）：

```
unsupported  非docker或版本<3.7.0 → 本地模式（现状完全不变）
kernel       isBackgroundCapable && RPC ping('notehelperPing') ok → 委托模式
fallback     isBackgroundCapable && ping 失败（未启用/kernel.js未装/内核插件崩溃）→ 本地模式
```

- 状态机入口统一 `ScheduleCoordinator.refresh()`，覆盖：onload、设置保存回调（现 index.ts:749 附近会重启定时器的全部路径）、`kernel-plugin-state-change` 事件、手动同步 RPC 失败时、onunload。
- ping 有 2s 超时；`fallback` 态每次手动同步前轻量重试 ping（成功则切回 `kernel` 并停掉前端定时器）。

设置页「同步设置」区插入提示行（文案三态，见 §8 i18n）：

| 环境 | 文案 |
|---|---|
| docker 且版本 ≥3.7.0 且 frequency>0 且 kernel 态 | 「✅ 后台自动同步运行中：无需打开浏览器，每 N 分钟自动同步（N=effectiveFrequency）」 |
| docker 且版本 ≥3.7.0（kernel 未运行或 frequency=0） | 「当前版本支持后台自动同步：开启定时后即使不打开浏览器也会自动运行」 |
| docker 且版本 <3.7.0 | 「Docker 分支持后台自动同步，请升级思源至 3.7.0 及以上版本」 |
| 桌面 / 手机 | 不显示 |

## 3. 频率下限 10 分钟（需求点 2）

- **kernel 侧执行 clamp**：`effectiveFrequencyMinutes = Math.max(10, Number(settings.frequency))`；`frequency<=0` 或非法值（NaN/负数/缺失）→ 不启动后台任务。
- **前端校验放宽（codex #13）**：docker 模式下 frequency 允许 10–1440（现状 index.ts:34 校验 min=15 仅允许 0/15–1440，10 分钟存不进去）；非 docker 保持 0/15–1440。SettingsForm 输入框 min 属性同步。
- 设置页 frequency 描述文案（docker 模式追加）：「后台自动同步最低间隔 10 分钟，设置低于 10 分钟时按 10 分钟执行」。

## 4. 单写者模型与 RPC 协议（P1 先定协议，codex 建议）

kernel.js 注册的 RPC（经 `/api/plugin/rpc/siyuan-notehelper`，前端 fetch 调用，实验已验证通路）：

| method | 入参 | 返回 | 说明 |
|---|---|---|---|
| `notehelperPing` | `{protocolVersion}` | `{protocolVersion, pluginVersion, running}` | 前端探测；protocolVersion 不匹配视为不可用 |
| `notehelperTriggerSync` | `{reason: 'manual'|'scheduled'|'onstart'}` | `{SyncResult, lastSyncAt}` | 手动/启动同步入口；同步进行中返回 busy |
| `notehelperGetStatus` | `{}` | `{running, effectiveFrequencyMinutes, nextRunAt, lastSyncAt, lastResult, lastError, syncing}` | 设置页状态行 + 单测断言 |
| `notehelperApplySettings` | `{}` | `{appliedAt, effectiveFrequencyMinutes}` | kernel **下一轮**生效的配置重读（每轮开始重读 settings 文件做快照，见 §5） |
| `notehelperResetSyncCursor` | `{}` | `{reset: true}` | 清空 state 文件内全局游标+全部设备游标+initialSyncCompleted（codex #9：docker 模式设备游标只有 kernel 自己，语义=重置全部） |

前端在 docker+kernel 态的行为映射：
- 手动同步（顶栏/命令/设置页按钮）→ `notehelperTriggerSync(reason:'manual')`，失败单次回退本地 `sync()`；
- syncOnStart → `notehelperTriggerSync(reason:'onstart')`（冷却闸保留在前端，冷却戳读写改走 state 文件——见 §5）；
- 重置同步时间 → `notehelperResetSyncCursor()`；
- 定时同步 → 前端不起 interval（kernel 自有）。

## 5. 状态拆分与一致性（codex #3）

两个存储 key（同在 `data/storage/petal/siyuan-notehelper/`，前端 saveData 与 kernel siyuan.storage 同目录，已实验验证）：

- `notehelper-settings`：**纯用户配置**（apiKey/endpoint/frequency/模板/文件夹……）。**只有前端写**。kernel 每轮同步开始时**重读该文件做配置快照**（配置在轮次间生效；不做长期缓存对象）。
- `notehelper-sync-state`：同步状态 `{syncAt, deviceSyncCursors, initialSyncCompleted, lastSyncAt, lastResult, lastError, cooldownUntil, schemaVersion}`。**单一写者**：kernel 态=仅 kernel 写；本地态=仅前端写（browserAdapter 用 saveData('notehelper-sync-state')）。
- 迁移（幂等，两端启动时都检查）：读到 state 文件缺失且旧 settings 内嵌游标 → 搬迁进 state 文件，并从 settings 剥离运行时字段（`syncing`、`intervalId` load 时忽略，不再持久化）。
- 运行中同步与配置保存不再互踩：kernel 用快照跑，前端只写 settings；游标只由执行者写。

## 6. 运行时适配层（codex #6/#7：完整依赖图）

### 6.1 适配器接口（`src/sync/runtimeAdapter.ts`）

```ts
interface SyncRuntimeAdapter {
  kernelApi(path, init?): Promise<{ok, status, json(), text()}>;      // 内核相对路径 API
  external(url, init?): Promise<同上>;                                // 外部 HTTP（GraphQL/图片下载）
  externalBinary(url, {timeoutMs}): Promise<{bytes: Uint8Array, contentType}>;  // 二进制下载
  uploadAsset(bytes, filename, targetDir): Promise<{path?}>;          // 资产上传
  readState(): Promise<SyncState|null>; writeState(s): Promise<void>;
  getDeviceId(): Promise<string>;
  notify(msg, type): void;
  isBrowser: boolean;   // 分支：checkAndUpdate、syncOnStartGate 冷却戳等浏览器专属逻辑
}
```

- **browserAdapter**：行为与现状逐项等价（kernelApi=fetch 相对路径；external=fetch；externalBinary=fetch+blob().arrayBuffer()；uploadAsset=现有 FormData 三层降级；state=saveData/loadData；deviceId=localStorage；notify=showMessage）。等价性由现有 ~800 jest 用例回归保证。
- **kernelAdapter**：
  - `kernelApi` = `siyuan.client.fetch(path, init)`（实验验证）；
  - `external` = `siyuan.client.fetch('/api/network/forwardProxy', {method:'POST', body})`，body 顶层字段（**已核对 v3.8.5 kernel/apicontract/network_input.go，修正 V1 错误**）：`{url, method, timeout: 30000, headers: [{"x-api-key": v}…]（数组，每项单键对象）, contentType, payload, payloadEncoding}`；响应 `{code, data:{status, contentType, body, elapsed}}` 三层错误处理（code!==0 / status≥400 / 正文解析）；JSON body 传对象（payload 默认 JSON 编码）；
  - `externalBinary` = forwardProxy `responseEncoding:'base64'` → 自实现 base64 解码（不依赖 goja atob，e2e 验证）→ Uint8Array；
  - `uploadAsset` = 手拼 multipart（Uint8Array+boundary，无 FormData/Blob 依赖）→ `/api/asset/upload`（client.fetch 支持 ArrayBuffer body；失败降级第二层 `/api/file/putFile` 同法）。单文件 32MB 上限（forwardProxy 限制）：超限记 error 日志并按现有「资产失败不阻塞」策略处理；
  - state/deviceId = `siyuan.storage`；notify = `siyuan.logger` + `rpc.broadcast('notehelper-notice', …)`。

### 6.2 同步核心改造点清单（传递依赖全列，codex #7）

| 文件 | 现状 | 改造 |
|---|---|---|
| `api.ts` | 5 处全局 fetch（外部 URL） | 全部走 `adapter.external`；构造注入 adapter |
| `fileHandler.ts` | 相对路径 fetch + `blob().arrayBuffer()` 图片下载 + `window.siyuan` 降级引用 | kernelApi + externalBinary；window.siyuan 引用改 adapter（排查 line 1810 附近） |
| `syncManager.ts` | 游标在 settings 对象 + `plugin.saveSettings()` + `markAutoSyncStarted`(localStorage) + `checkAndUpdate()` | 游标/冷却戳走 `adapter.readState/writeState`；`checkAndUpdate` 仅 `adapter.isBrowser` 时调用；SyncManager 构造接收 adapter |
| `idIndex.ts` | 直接 fetch 内核 API | 注入 adapter.kernelApi |
| `SyncNoticeManager.ts` | `import { showMessage } from 'siyuan'` | 改 `adapter.notify`，不再 import siyuan |
| `assetUploader.ts` | FormData 三层降级 | browserAdapter 保留原实现；multipart 构造函数抽出供 kernelAdapter 复用去重逻辑 |
| `updater.ts` | FILES 清单无 kernel.js | **加 `{remote: BASE_URL/kernel.js, local: PLUGIN_PATH/kernel.js}`**（codex #10）；自更新后提示重启内核生效 |
| `syncOnStartGate.ts` | localStorage 冷却戳 | 冷却戳迁 state 文件（两端同一逻辑） |

### 6.3 构建产物（codex #7）

- webpack 双入口：`src/index.ts`→`dist/index.js`（现状）；`src/kernel.ts`→`dist/kernel.js`，**IIFE**、`output.library.type:'window'` 禁、externals：不外置任何东西（把 luxon/mustache/lodash 打进 kernel.js；**不** import 'siyuan' 前端包）。
- 产物校验门（scripts/check-kernel-bundle.js）：grep 产物不得出现 `require("siyuan")`、`window.siyuan`、`document.`、`localStorage`（除注释外）；加入 npm test 流程。
- `src/kernel.ts` 顶部：`Settings.defaultZone='utc+08:00'; Settings.defaultLocale='en-US';`（实验结论；已知差异：`cccc` 等本地化 token 在 kernel 渲染英文，默认模板未使用，文档记录）。

## 7. kernel.ts 结构（约 300 行）

```
onload:
  luxon 初始化（§6.3）
  组装 kernelAdapter → SyncManager
  state 迁移检查（§5，幂等）
  注册 5 个 RPC（§4）
  applySchedule(): 读 settings → frequency 合法且>0 → effectiveFrequency=max(10,freq)
                  → setInterval(runScheduledSync, effective*60_000)；记录 nextRunAt
onrunning: logger.info 版本/协议；rpc.broadcast('notehelper-kernel-ready')
runScheduledSync / triggerSync(reason):
  if (isSyncing) return busy          ← 进程内互斥（单写者模型下唯一需要的锁）
  配置快照 = 重读 notehelper-settings
  syncResult = await syncManager.sync(true)
  state.lastSyncAt/lastResult/lastError 落盘；broadcast
onunload: clearInterval；state 落盘
```

- `plugin.json`：`"kernels": ["docker"]`（只 docker）；`minAppVersion` 保持 3.3.0。
- **明确不做**（V1 范围外，风险见 §11）：kernel 侧等待思源云同步的闸（事件总线不可达）；私有 HTTP 路由/cron 入口；桌面端 kernels；MCP/Agent。

## 8. i18n 文案（新增 key，zh_CN 为主）

```
bgSyncRunning:  ✅ 后台自动同步运行中：无需打开浏览器，每 {{freq}} 分钟自动同步
bgSyncSupported: 当前版本支持后台自动同步：开启定时后，即使不打开浏览器也会自动运行
bgSyncUpgrade:  Docker 分支持后台自动同步，请升级思源至 3.7.0 及以上版本
bgSyncFreqNote: 后台自动同步最低间隔 10 分钟；设置低于 10 分钟时按 10 分钟执行
bgSyncBusy:     后台同步正在进行，请稍后重试
```

## 9. 测试与验收（codex #12 加强版）

单测（随实现交付，不后置）：
- semverGte 边界（3.6.9/3.7.0/3.7.1/3.8.5/非数字）；clamp（1→10、9→10、10→10、15→15、0/NaN/-5→不启动）
- 状态机三态转换（含设置保存路径、RPC 失败回退）
- state 迁移幂等（旧 settings 内嵌游标 → state 文件；二次运行不再搬）
- kernelAdapter：forwardProxy 请求体 schema（顶层 method/timeout、headers 数组）快照测试；multipart 构造字节正确性
- 文案条件渲染（非 docker 不出现提醒）

E2E（复用 /tmp/siyuan-timer-test 环境：podman b3log/siyuan:v3.8.5 + headless Chrome CDP）：
1. mock 服务：GraphQL 返回 2 篇文章（1 篇普通文章+2 图、1 篇企微消息）+ 图片静态路由 + 版本路由
2. 安装：podman cp dist → setBazaar trust → setPetalEnabled → 确认 `kernel plugin manager started 1/1`
3. 前端（headless Chrome）：配置 endpoint 指向 mock、frequency=1（保存校验 docker 允许 10–1440，故 UI 存 10；frequency=1 经 API 直写设置文件验证 clamp）
4. 断言：
   - RPC：ping/getStatus（effectiveFrequencyMinutes=10、nextRunAt≈now+10min）/triggerSync/applySettings/resetSyncCursor
   - triggerSync 后：mock 收到 forwardProxy 转发的 GraphQL（headers 含 x-api-key）；文档创建（标题/路径/合并文件）；图片资产文件落盘（multipart 上传链路）；游标推进（state 文件）；lastResult 正确
   - 无人浏览器：关掉 Chrome，等待并断言 kernel 日志出现 scheduled tick（如需缩短观察时间，临时以 triggerSync('scheduled') 等价验证调度回调本体）
   - podman restart 后：kernel 自动加载（日志），settings/state 保留，interval 重启
   - clamp：settings.frequency=1（API 直写）→ getStatus 返回 10
5. 版本矩阵：3.8.5 全量；3.7.0 容器安装+加载+一次 triggerSync 冒烟；旧版前端回归=非 docker 模式 jest 全绿 + 文案不出现
6. 截图：设置页含三态文案与状态行 → 推送**定时数据群（wechat_webhook_test，key 72d145a4-…；严禁 wechat_webhook_prod）**

## 10. 风险与缓解（更新）

| 风险 | 缓解 |
|---|---|
| goja 无 Intl | 已实验：defaultZone+defaultLocale 后插件全部 luxon 路径通过；cccc 本地化 token 渲染英文（默认模板未用） |
| forwardProxy 32MB/超时 | timeout 显式 30000；二进制超限走「资产失败不阻塞」现有策略并 error 日志 |
| kernel 与思源云同步并发写（重复文档） | V1 接受并文档化（codex #11）：kernel 周期≥10min 且窗口短、IdIndex 每轮全量重建+source-id 去重（现状）；无法完全消除，用户开思源云同步+多设备时存在边界重复风险 |
| 前端 RPC 失败窗口 | 单次回退本地执行 + 状态机重探测；协议版本不匹配视为不可用 |
| 自更新 kernel.js 与前端不同步 | updater 清单补 kernel.js；RPC 协议版本握手；更新后提示重启内核 |
| 老版本(3.3.0)集市更新 | kernels 门控只装不启；minAppVersion 不动 |

## 11. 实施顺序（codex 建议版）

| 阶段 | 范围 | 完成条件 |
|---|---|---|
| P1 | state/settings 拆分+迁移；adapter 接口+browserAdapter；kernel 独立构建+产物校验门；kernel.ts 骨架（lifecycle/5 RPC/调度 clamp/luxon 初始化） | jest 全绿；kernel.js 产物通过校验门；e2e 环境 ping/getStatus 通 |
| P2 | 同步核心解耦（§6.2 全表）：api/fileHandler/syncManager/idIndex/notice/assetUploader/updater；kernelAdapter 实现（forwardProxy 修正协议+二进制+multipart） | browserAdapter 等价回归全绿；e2e triggerSync 全链路（含图片/企微合并/游标） |
| P3 | 前端接入：ScheduleCoordinator 状态机/设置页文案三态/frequency 校验/applySettings/重置 RPC | e2e 设置页截图文案；手动同步 RPC 化+回退；非 docker 零变化回归 |
| P4 | e2e 全量（无人浏览器定时/重启恢复/版本矩阵）+ 截图推群 | §9 全部断言通过 |

## 12. 依据（调研+实验，已验证）

- kernel plugin 机制/存储同目录/client.fetch/RPC 端点/kernels 门控——v3.8.5 源码逐项核实 + podman 实测
- goja 定时器（eventloop 注入 + Start() 常驻）——源码 + v3.8.5 容器实测 25 ticks/5s 精确/重启自恢复
- luxon 无 Intl：`delete globalThis.Intl` 模拟实验——defaultZone+defaultLocale 后全路径通过（fromISO/toFormat 中文字面 token/fromJSDate/toISO）
- forwardProxy schema——v3.8.5 `kernel/apicontract/network_input.go`：method/timeout 顶层、headers 数组、payloadEncoding、responseEncoding base64
- 前端检测字段 container/kernelVersion——app/src/types/config.d.ts L1996-2030
- siyuan-plugin-backend（zuoez02）排除（Electron 专属）
- V1→V2：codex 复检 13 条全采纳（tmux+codex exec 复检，2026-09-24）
