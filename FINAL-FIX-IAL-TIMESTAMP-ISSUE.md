# 最终修复：IAL时间戳导致的无效ID错误

## 问题根源

经过详细诊断，找到了"found invalid ID [2025-xx-xxTxx:xx:xx.xxxZ]"错误的真正原因：

### 完整的错误链条

1. **设置块属性时**：
   - 在 `addMergedId` 函数中，我们设置了 `custom-last-merge-time` 属性
   - 值为 `new Date().toISOString()`，例如：`2025-11-20T02:39:07.791Z`

2. **获取文档内容时**：
   - 使用 `/api/block/getBlockKramdown` API 获取文档内容
   - 返回的内容包含 IAL（Inline Attribute List）属性：
     ```markdown
     ---
     {: custom-last-merge-time="2025-11-20T02:39:07.791Z" id="20251120103906-vumr57a" ...}

     ## 文档内容...
     ```

3. **合并内容时**：
   - 将旧内容（包含IAL）和新内容拼接在一起
   - IAL中的ISO时间戳被保留

4. **更新文档时**：
   - 调用 `/api/block/updateBlock` 发送合并后的内容
   - 思源解析kramdown时，将IAL中的时间戳 `2025-11-20T02:39:07.791Z` 误认为块ID引用
   - 因为找不到对应的块，报错：`data block DOM failed: found invalid ID [2025-11-20T02:39:07.791Z]`

## 解决方案

在获取文档内容后，移除文档级别的IAL属性：

### 1. 新增 `removeDocumentIAL` 函数

```typescript
private removeDocumentIAL(content: string): string {
    // 匹配文档开头的IAL格式：
    // ---
    // {: attr1="value1" attr2="value2" ...}
    //
    // 或者单独的 {: ...} 行

    // 模式1: 匹配 ---\n{: ...}\n 格式（文档属性）
    const pattern1 = /^---\s*\n\{:[^}]*\}\s*\n+/;

    // 模式2: 匹配单独的 {: ...} 行（文档属性）
    const pattern2 = /^\{:[^}]*\}\s*\n+/;

    let cleaned = content;

    // 先尝试移除带 --- 的格式
    if (pattern1.test(cleaned)) {
        cleaned = cleaned.replace(pattern1, '');
        logger.debug('[removeDocumentIAL] Removed IAL with --- prefix');
    }
    // 再尝试移除单独的IAL
    else if (pattern2.test(cleaned)) {
        cleaned = cleaned.replace(pattern2, '');
        logger.debug('[removeDocumentIAL] Removed standalone IAL');
    }

    return cleaned;
}
```

### 2. 在 `getDocumentContent` 中调用

```typescript
let content = data.data.kramdown || '';

// 移除文档级别的IAL属性
content = this.removeDocumentIAL(content);

return content;
```

## 为什么这个方案有效

1. **只移除文档级别的IAL**：
   - 仅移除文档开头的IAL属性块
   - 保留内容中其他必要的格式

2. **保留块属性**：
   - 块属性仍然通过 `setBlockAttrs` API 正确设置
   - 不影响去重机制（使用 `custom-merged-ids` 属性）

3. **避免循环问题**：
   - 获取内容时移除旧的IAL
   - 更新后思源会自动添加新的IAL
   - 下次获取时再次移除，形成良性循环

## 测试结果

修复后应该能够：
1. ✅ 正确获取现有文档内容（不含IAL）
2. ✅ 成功追加新内容到现有文档
3. ✅ 同一天的消息正确合并到同一个文档
4. ✅ 已存在的消息正确跳过（通过 `custom-merged-ids` 去重）

## 修改的文件

`siyuan-plug/src/sync/fileHandler.ts`:
- 第608-637行：修改 `getDocumentContent` 函数，添加IAL移除逻辑
- 第639-671行：新增 `removeDocumentIAL` 函数

## 相关的其他修复

在此次调试过程中还修复了：
1. GraphQL非标准响应格式处理（`api.ts`）
2. 文档ID验证和诊断日志（`fileHandler.ts`）

## 下一步

1. **重启思源笔记**或重新加载插件
2. **尝试同步**，观察是否能成功追加内容
3. **检查日志**中的 `[removeDocumentIAL]` 信息
4. **验证去重功能**，同一条消息不应重复添加

## 技术细节

### 什么是IAL？

IAL（Inline Attribute List）是思源笔记使用的kramdown语法扩展，用于给块添加属性：

```markdown
{: id="block-id" custom-attr="value"}
```

### 为什么会误认为块ID？

思源在解析kramdown时，可能会将某些格式的字符串识别为块ID引用。ISO时间戳的格式（特别是T分隔符）可能触发了这个解析逻辑。

### 为什么不改用其他时间格式？

我们需要保留ISO格式以便：
1. 精确记录时间（包含时区信息）
2. 便于排序和比较
3. 与服务端API保持一致

通过在获取内容时移除IAL，我们既保留了ISO格式的优势，又避免了解析错误。
