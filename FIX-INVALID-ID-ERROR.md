# 修复文档合并时的无效ID错误

## 问题描述

错误日志显示：
```
Failed to update document: data block DOM failed: found invalid ID [2025-11-19T11:14:08.661Z]
```

系统将时间戳字符串 `[2025-11-19T11:14:08.661Z]` 错误地当作文档ID使用。

## 问题分析

1. **错误发生位置**：
   - `fileHandler.ts` 中的 `mergeToExistingDocument` 函数
   - 调用 `updateDocument` 时传入了无效的ID

2. **根本原因**：
   - `getDocumentByPath` 函数调用 SiYuan API `/api/filetree/getIDsByHPath`
   - API 返回的 `data` 数组中第一个元素被当作文档ID
   - 但实际上可能返回了时间戳或其他非ID数据

## 解决方案

### 1. 增强诊断日志
在 `getDocumentByPath` 函数中添加详细的日志记录，检查API返回的数据类型和格式。

### 2. 验证ID有效性
在使用返回的ID之前，检查是否为时间戳格式：
```typescript
// 检查是否返回了时间戳而不是ID
if (typeof apiDocId === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(apiDocId)) {
    logger.error(`WARNING: API returned timestamp instead of document ID: ${apiDocId}`);
    return null; // 返回null表示文档不存在，避免使用错误的ID
}
```

### 3. 双重保护
在调用 `mergeToExistingDocument` 之前再次检查ID的有效性：
```typescript
if (typeof existingDocId === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(existingDocId)) {
    logger.error(`Invalid document ID detected (timestamp): ${existingDocId}`);
    // 创建新文档而不是尝试合并
    return await this.createMergedDocument(notebookId, docPath, article, mergeDate);
}
```

## 修改的文件

1. **siyuan-plug/src/sync/fileHandler.ts**:
   - 第480-502行：增加ID验证和详细日志
   - 第156-178行：调用前再次验证ID

2. **siyuan-plug/src/api.ts** (之前的修复):
   - 第117-147行：处理非标准GraphQL响应格式

## 测试建议

1. 重启思源笔记或重新加载插件
2. 尝试同步文章，观察日志中的新诊断信息
3. 如果仍有问题，检查日志中的 `[getDocumentByPath]` 相关信息

## 注意事项

1. 这个修复会阻止使用无效的时间戳作为文档ID
2. 如果文档ID被识别为时间戳，会创建新文档而不是合并
3. 详细的日志会帮助进一步诊断问题的根源

## 后续改进

如果问题持续存在，可能需要：
1. 检查 SiYuan API 的实现，了解为什么返回时间戳
2. 考虑使用其他方式获取文档ID（如SQL查询）
3. 向 SiYuan 开发者报告API行为异常