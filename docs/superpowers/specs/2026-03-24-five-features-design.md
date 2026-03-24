# 五项功能追踪设计

日期：2026-03-24

从 obsidian-plug 近 1.5 月 commit 中提取 5 项需追踪的功能，适配到 siyuan-notehelper。

---

## Feature 1: 同步进度通知优化

### 背景

当前 `performSync()`（index.ts:566）仅在开始、完成、失败三个节点调用 `showMessage()`，无进度反馈，错误提示笼统。

### 设计

新建 `src/sync/SyncNoticeManager.ts`。

**类接口：**

```typescript
import { showMessage } from 'siyuan';

export class SyncNoticeManager {
  private totalBlocks: number = 5;
  private filledBlocks: number = 0;
  private processedCount: number = 0;

  /** 同步开始，显示第一条进度消息 */
  startSync(): void;

  /** 每页处理完后调用，更新进度 */
  onBatchProcessed(count: number, hasNextPage: boolean): void;

  /** 同步完成 */
  completeSync(successCount: number): void;

  /** 没有新文章 */
  showNoArticles(): void;

  /** 错误分类提示 */
  showError(error: unknown): void;

  /** 生成进度条字符串 */
  private renderProgressBar(label: string): string;
}
```

**进度条规则（与 obsidian-plug 一致）：**

- 初始 5 块（保底）
- 每 5 篇文章 = 1 块，封顶 10 块
- 公式：`totalBlocks = min(max(ceil(processedCount / 5), 5), 10)`
- `startSync()` 时填充第 1 块
- `hasNextPage=true` 时，当前最多填到 `totalBlocks - 1`（留 1 块余量）
- `hasNextPage=false`（最后一页）时允许填满

**显示文案：**

```
开始拉取：  ■ □ □ □ □  拉取数据...
处理中：    ■ ■ ■ □ □  处理文章 15...
完成：      ■ ■ ■ ■ ■  同步完成！23 篇文章
```

**错误分类：**

| 条件 | 提示文案 | 时长 |
|------|---------|------|
| HTTP 401 | "API 密钥无效，请前往「笔记同步助手」公众号重新获取" | 10s |
| 无 status 字段（网络错误） | "网络连接失败，请检查网络后重试" | 5s |
| 其他 | "同步失败，请稍后重试" | 5s |

**消息替换机制：**

`showMessage` 支持 `id` 参数：`showMessage(text, timeout, type, id)`。所有进度消息使用固定 `id = 'notehelper-sync-progress'`，确保每次调用替换前一条进度消息，而非堆叠多条 toast。完成/错误消息使用不同 id 或不传 id（独立 toast）。

**集成点：**

1. `SyncManager.sync()` 构造 `SyncNoticeManager` 实例
2. fetch 循环开始前调用 `startSync()`
3. 每页处理完后调用 `onBatchProcessed(pageArticleCount, hasNextPage)`
4. 处理完毕后调用 `completeSync(createdCount)` 或 `showNoArticles()`
5. catch 块调用 `showError(error)`
6. `index.ts` 的 `performSync()` 移除自身的 `showMessage()` 调用（由 SyncManager 内部驱动）

---

## Feature 2: 页内批量消息排序

### 背景

当前 `syncManager.ts:137` 逐篇调用 `fileHandler.processArticle()`，每篇独立写入。消息顺序取决于 API 返回顺序，不保证排序。每篇一次 I/O。

### 设计

**新增设置项：**

在 `PluginSettings` 接口和 `DEFAULT_SETTINGS` 中新增：

```typescript
messageSortOrder: string;  // 'ASC' | 'DESC'，默认 'ASC'
```

UI 放在合并模式设置块内（`mergeMode !== 'none'` 时显示）。

**FileHandler 新增方法：**

```typescript
/**
 * 批量处理一页文章（页内排序 + 合并写入）
 */
async processArticleBatch(
  articles: Article[],
  notebookId: string
): Promise<{ created: number; skipped: number; errors: string[] }>
```

**内部流程：**

1. 将 articles 分为两类：
   - 需要合并的（`shouldMergeArticle() === true`）
   - 不需要合并的（逐篇调用 `createSeparateFile()`，不变）
2. 将合并类文章按目标文件路径分组：`Map<docPath, Article[]>`
   - 分组 key = `joinPath(renderMergeFolderPath(article, this.settings), renderSingleFilename(mergeDate, this.settings))`
   - 注意：`renderMergeFolderPath` 和 `renderSingleFilename` 是从 `src/settings/template.ts` 导入的函数，需传入 `settings` 参数
3. 每组内按 `savedAt` 排序：
   ```typescript
   const sorted = group.sort((a, b) => {
     const timeA = new Date(a.savedAt).getTime();
     const timeB = new Date(b.savedAt).getTime();
     return settings.messageSortOrder === 'ASC' ? timeA - timeB : timeB - timeA;
   });
   ```
4. 对每组执行批量合并（新增私有方法 `mergeArticleBatchToFile`）：
   - 查找/创建目标文档（一次）
   - 获取已有 mergedIds（一次）
   - 过滤已存在的文章
   - 渲染所有新消息内容，按排序顺序拼接
   - 写入文档（一次）
   - 批量更新 `custom-merged-ids`（一次）
5. 返回汇总的 created/skipped/errors

**SyncManager 改动：**

将 fetch 循环改为边拉取边处理：不再先收集到 `allArticles` 再逐篇处理，而是在 fetch 循环内每页拿到 articles 后立即调用 `processArticleBatch`。

改动范围：`syncManager.ts` 的 fetch 循环（86-150行）重构为：

```typescript
const batchSize = 15;
let hasMore = true;
let offset = 0;
const errors: string[] = [];
let skippedCount = 0;
let createdCount = 0;

while (hasMore) {
    // ... 计算 effectiveSyncAt（不变）

    const [articles, hasNextPage] = await getItems(...);

    // 每页立即批量处理
    const batchResult = await this.fileHandler.processArticleBatch(articles, notebookId);
    createdCount += batchResult.created;
    skippedCount += batchResult.skipped;
    errors.push(...batchResult.errors);

    // 通知进度
    notice.onBatchProcessed(articles.length, hasNextPage);

    hasMore = hasNextPage;
    offset += batchSize;
    if (offset > 1000) break;
}
```

移除 `allArticles` 数组和原有的逐篇处理循环（131-150行）。

**错误处理：** `processArticleBatch` 内部对每篇文章 try-catch，单篇失败不中断整组，错误收集在返回值的 `errors` 中。

---

## Feature 3: 设置项输入校验

### 背景

当前设置表单无任何输入校验，用户可输入非法模板语法或日期格式。

### 设计

新建 `src/settings/validation.ts`：

```typescript
import { showMessage } from 'siyuan';
import Mustache from 'mustache';
import { formatDate } from '../utils/util';

/**
 * 校验 Mustache 模板语法
 * @returns true 合法，false 非法（已显示错误提示）
 */
export function validateTemplate(value: string, fieldName: string): boolean {
  if (!value) return true;  // 空值允许
  try {
    Mustache.parse(value);
    return true;
  } catch (e) {
    showMessage(`${fieldName} 模板语法错误：${e instanceof Error ? e.message : String(e)}`, 5000, 'error');
    return false;
  }
}

/**
 * 校验日期格式字符串
 * Luxon 的 toFormat() 不会对无效格式抛异常，而是将所有字母解释为 token。
 * 校验策略：用已知日期格式化，检查结果是否包含合理的数字（年月日时分秒）。
 * @returns true 合法，false 非法（已显示错误提示）
 */
export function validateDateFormat(value: string, fieldName: string): boolean {
  if (!value) return true;
  try {
    // 用固定日期测试，避免边界问题
    const testDate = '2026-06-15T14:30:45.000Z';
    const result = formatDate(testDate, value);
    // 如果格式化结果完全不包含数字，说明格式可能无效（纯文字 token）
    if (!/\d/.test(result)) {
      showMessage(`${fieldName} 日期格式无效：格式化结果不包含数字，请检查格式字符串`, 5000, 'error');
      return false;
    }
    return true;
  } catch (e) {
    showMessage(`${fieldName} 日期格式错误：${e instanceof Error ? e.message : String(e)}`, 5000, 'error');
    return false;
  }
}

/**
 * 校验数值范围
 * @returns true 合法，false 非法（已显示错误提示）
 */
export function validateNumberRange(
  value: string,
  fieldName: string,
  min: number,
  max: number,
  allowZero?: boolean
): boolean {
  const num = parseInt(value, 10);
  if (isNaN(num)) {
    showMessage(`${fieldName} 必须是数字`, 5000, 'error');
    return false;
  }
  if (allowZero && num === 0) return true;
  if (num < min || num > max) {
    showMessage(`${fieldName} 须在 ${min}-${max} 范围内`, 5000, 'error');
    return false;
  }
  return true;
}
```

**集成点：**

在 `index.ts` 的设置表单事件绑定区域（422-443行），对需校验的字段改为 `blur` 事件触发校验。

**原值恢复机制**：在 `focus` 事件时缓存当前值（`input.dataset.prevValue = input.value`），校验失败时恢复为缓存值。非校验字段保持现有 `change` 事件 + 防抖保存逻辑不变。

**校验字段映射：**

| 字段 | 校验函数 | 参数 |
|------|---------|------|
| folder, filename, mergeFolder, singleFileName, mergeFolderTemplate | `validateTemplate` | 字段中文名 |
| template, wechatMessageTemplate, mergeMessageTemplate | `validateTemplate` | 字段中文名 |
| folderDateFormat, filenameDateFormat, singleFileDateFormat, mergeFolderDateFormat | `validateDateFormat` | 字段中文名 |
| frequency | `validateNumberRange` | "同步频率", 15, 1440, allowZero=true |
| jpegQuality | `validateNumberRange` | "JPEG 质量", 1, 100 |
| imageDownloadRetries | `validateNumberRange` | "重试次数", 0, 10 |

---

## Feature 4: 同步文件夹无笔记时自动延长同步时间

### 背景

首次同步时，用户可能设置了未来的 syncAt 或者刚配置好密钥，需要拉取更多历史数据。当前 `syncTimeOffset` 固定回溯 N 小时，不区分首次/非首次。

### 设计

**新增设置项：**

在 `PluginSettings` 接口和 `DEFAULT_SETTINGS` 中新增：

```typescript
initialSyncCompleted: boolean;  // 默认 false
```

此字段不在 UI 中暴露，纯内部使用。

**逻辑改动（syncManager.ts:94-107）：**

在计算 `effectiveSyncAt` 时，增加首次同步回退：

```typescript
// 计算有效的同步时间
let effectiveSyncAt: string | undefined = undefined;
if (rawSyncAt) {
    const syncDate = new Date(rawSyncAt);

    // 1. 常规时间回溯
    const offsetHours = this.settings.syncTimeOffset || 0;
    if (offsetHours > 0) {
        syncDate.setHours(syncDate.getHours() - offsetHours);
    }

    // 2. 首次同步未完成：额外回退 1 天
    if (!this.settings.initialSyncCompleted) {
        syncDate.setDate(syncDate.getDate() - 1);
        logger.debug('首次同步未完成，额外回退 1 天');
    }

    // 3. 高频自动同步回退（见 Feature 5）

    effectiveSyncAt = syncDate.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
```

**标记完成：**

在更新同步游标之前（syncManager.ts 现有的 "更新同步时间" 代码块前），插入：

```typescript
// 同步成功后标记首次同步已完成
if (!this.settings.initialSyncCompleted) {
    this.settings.initialSyncCompleted = true;
    logger.debug('首次同步已完成，标记 initialSyncCompleted = true');
}
```

**resetSyncTime() 联动：** 当用户重置同步时间时，同时将 `initialSyncCompleted` 重置为 `false`，使下次同步能再次获得额外 1 天回退。改动位置：`syncManager.ts` 的 `resetSyncTime()` 方法（197-207行）。

**注意：** 此回退仅在 `rawSyncAt` 非空时生效。如果 `rawSyncAt` 为空（从未同步过），API 会返回所有文章，无需回退。

---

## Feature 5: 高频自动同步 Cursor 回退

### 背景

当自动同步间隔较短（< 5 分钟）时，边界附近的文章可能因时间精度或 API 延迟被漏掉。

### 设计

**常量（syncManager.ts 顶部）：**

```typescript
/** 高频同步阈值（分钟）：frequency < 此值视为高频 */
const HIGH_FREQ_THRESHOLD_MINUTES = 5;

/** 高频同步额外回退（毫秒）：120 秒 */
const HIGH_FREQ_ROLLBACK_MS = 120_000;
```

**SyncManager.sync() 签名扩展：**

```typescript
async sync(isAutoSync: boolean = false): Promise<SyncResult>
```

**调用端改动：**

- `startScheduledSync()` 定时器调用（syncManager.ts:305）：`this.sync(true)`
- `index.ts` 的 `performSync()` 增加 `isAutoSync` 参数并透传：`performSync(isAutoSync = false)` → `this.syncManager.sync(isAutoSync)`
- `syncOnStart`（index.ts:249）：调用 `this.performSync(true)`（启动时自动同步视为自动同步）
- 手动触发（菜单、dock按钮、命令）保持 `this.performSync()`（默认 false）

**时间计算（在 Feature 4 的基础上追加）：**

```typescript
// 3. 高频自动同步回退
if (isAutoSync && this.settings.frequency > 0 && this.settings.frequency < HIGH_FREQ_THRESHOLD_MINUTES) {
    syncDate.setTime(syncDate.getTime() - HIGH_FREQ_ROLLBACK_MS);
    logger.debug(`高频自动同步（${this.settings.frequency}分钟），额外回退 120 秒`);
}
```

**三种回退独立叠加示例：**

| 场景 | syncTimeOffset | 首次回退 | 高频回退 | 总回退 |
|------|---------------|---------|---------|-------|
| 手动同步，首次，offset=12h | -12h | -1d | 无 | 12h+1d |
| 自动同步，非首次，freq=3min，offset=12h | -12h | 无 | -120s | 12h+120s |
| 自动同步，首次，freq=2min，offset=0 | 无 | -1d | -120s | 1d+120s |
| 手动同步，非首次，offset=12h | -12h | 无 | 无 | 12h |

---

## 新增设置项汇总

| 字段 | 类型 | 默认值 | UI 可见 |
|------|------|--------|---------|
| `messageSortOrder` | `string` | `'ASC'` | 是（合并模式块内） |
| `initialSyncCompleted` | `boolean` | `false` | 否（内部使用） |

## 改动文件汇总

| 文件 | 改动 |
|------|------|
| `src/sync/SyncNoticeManager.ts` | **新建** - 同步通知管理器 |
| `src/settings/validation.ts` | **新建** - 输入校验函数 |
| `src/sync/syncManager.ts` | 集成通知管理器、批量处理调用、sync cursor 回退逻辑、isAutoSync 参数 |
| `src/sync/fileHandler.ts` | 新增 `processArticleBatch()` 和 `mergeArticleBatchToFile()` |
| `src/settings/index.ts` | 新增 `messageSortOrder`、`initialSyncCompleted` 字段 |
| `src/ui/SettingsForm.ts` | 新增消息排序 UI |
| `src/index.ts` | 移除 performSync 中的 showMessage、集成 blur 校验、传递 isAutoSync |
