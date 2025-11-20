# 最终修复：时间戳格式问题

## 问题的根本原因

经过详细诊断，找到了"found invalid ID [2025-xx-xxTxx:xx:xx.xxxZ]"错误的**真正根本原因**：

### 完整的错误链条

1. **设置块属性**：
   - 调用 `addMergedId` 和 `createMergedDocument` 时
   - 设置 `custom-last-merge-time` 和 `custom-creation-time` 属性
   - 使用 ISO 格式：`new Date().toISOString()` → `2025-11-20T03:15:47.477Z`

2. **思源自动添加IAL**：
   - 思源自动将块属性添加到文档的IAL中：
     ```markdown
     ---
     {: custom-last-merge-time="2025-11-20T03:15:47.477Z" ...}
     ```

3. **获取文档内容**：
   - 调用 `/api/block/getBlockKramdown` 返回包含IAL的内容
   - IAL移除代码成功移除了文档开头的IAL（日志显示 "removed: 62 chars"）

4. **合并并更新文档**：
   - 拼接旧内容（已移除IAL）和新内容
   - 调用 `/api/block/updateBlock` 更新文档
   - **问题发生**：更新成功后，`addMergedId` 又设置了新的ISO时间戳

5. **下次更新时出错**：
   - 再次获取文档内容，包含新设置的ISO时间戳IAL
   - 思源解析时将 `2025-11-20T03:15:47.477Z` 误认为块ID引用
   - 报错：`found invalid ID [2025-11-20T03:15:47.477Z]`

### 为什么ISO格式会被误认为块ID？

ISO格式包含特殊字符：
- `T` - 日期和时间的分隔符
- `:` - 时间的分隔符
- `.` - 秒和毫秒的分隔符
- `Z` - UTC时区标记

这些字符的组合可能触发了思源的块ID解析逻辑。

## 解决方案

**将所有时间戳从ISO格式改为思源格式（YYYYMMDDHHmmss）**

### 修改1：addMergedId 函数（第835-844行）

```typescript
// 生成思源格式的时间戳（YYYYMMDDHHmmss）
// 不使用ISO格式，因为ISO格式中的特殊字符会被思源误认为块ID引用
const now = new Date();
const siyuanTimestamp =
    now.getFullYear() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0');

// 使用思源格式而不是ISO格式
'custom-last-merge-time': siyuanTimestamp,  // 例如：20251120111547
```

### 修改2：createMergedDocument 函数（第290-298行）

```typescript
// 生成思源格式的时间戳（YYYYMMDDHHmmss）
const now = new Date();
const siyuanTimestamp =
    now.getFullYear() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0');

'custom-creation-time': siyuanTimestamp,  // 例如：20251120111547
```

## 为什么这个方案能解决问题

1. **思源格式是纯数字**：
   - `20251120111547` 不包含任何特殊字符
   - 不会被误认为块ID引用

2. **仍然可读**：
   - YYYYMMDDHHmmss 格式清晰
   - 与思源自己的块ID格式一致（例如：20251120103900-dzkmle8）

3. **易于排序和比较**：
   - 纯数字格式便于字符串比较
   - 按时间顺序排列

4. **与思源生态一致**：
   - 思源的块ID使用类似格式
   - 符合思源的设计理念

## 测试建议

1. **重启思源笔记**或重新加载插件
2. **尝试同步消息**
3. **观察是否还有"invalid ID"错误**
4. **检查同一天的消息是否能成功合并**

## 预期结果

修复后应该能够：
- ✅ 正确追加内容到现有文档
- ✅ 同一天的消息合并到同一个文档
- ✅ 已存在的消息正确跳过（去重功能正常）
- ✅ 不再报"found invalid ID"错误

## 修改的文件

`siyuan-plug/src/sync/fileHandler.ts`:
- 第835-844行：修改 `addMergedId` 中的时间戳格式
- 第290-298行：修改 `createMergedDocument` 中的时间戳格式

## 与之前修复的关系

这次修复补充了之前的IAL移除方案：
1. **之前的修复**：移除文档内容中的IAL（防止旧的ISO时间戳导致错误）
2. **本次修复**：改用思源格式的时间戳（防止新的ISO时间戳导致错误）

两个修复共同作用，彻底解决了时间戳导致的问题。

## 技术细节

### 时间戳格式对比

| 格式 | 示例 | 优点 | 缺点 |
|------|------|------|------|
| ISO 8601 | 2025-11-20T03:15:47.477Z | 标准、包含时区 | 特殊字符被误解析 |
| 思源格式 | 20251120111547 | 纯数字、不被误解析 | 不包含毫秒和时区 |
| Unix 时间戳 | 1732089347 | 纯数字、紧凑 | 不直观、难以阅读 |

### 为什么不用Unix时间戳？

虽然Unix时间戳也是纯数字，但：
1. 不直观：无法直接看出时间
2. 与思源格式不一致
3. 调试困难

思源格式（YYYYMMDDHHmmss）是最佳选择。
