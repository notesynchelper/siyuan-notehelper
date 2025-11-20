# 完整的IAL移除方案

## 问题发现

虽然之前修复了：
1. ✅ 时间戳格式（从ISO改为思源格式）
2. ✅ 文档级IAL移除

但仍然出现错误：
```
found invalid ID [20251120112343]
```

## 根本原因

**kramdown格式包含三种IAL：**

### 1. 文档级IAL（已处理）
```markdown
---
{: custom-last-merge-time="20251120112343" id="xxx" ...}
```

### 2. 块级IAL（**新发现的问题**）
```markdown
## 📅 2025-10-21 11:37:01
{: id="20251120112342-fg8fppm" updated="20251120112342"}

内容...
```

每个块（标题、段落等）后面都有IAL属性。

### 3. 内联IAL（可能存在）
```markdown
## 标题{: id="xxx"}
```

**问题在于：** 我们之前只移除了文档级IAL，但内容中的**块级IAL**仍然存在。当这些IAL中包含时间戳、ID等信息时，思源在解析时会将它们误认为块引用。

## 完整解决方案

修改 `removeDocumentIAL` 函数，移除**所有类型的IAL**：

```typescript
private removeDocumentIAL(content: string): string {
    let cleaned = content;
    const originalLength = content.length;

    // 步骤1: 移除文档开头的IAL（---\n{: ...}\n格式）
    const docIALPattern = /^---\s*\n\{:[^}]*\}\s*\n+/;
    if (docIALPattern.test(cleaned)) {
        cleaned = cleaned.replace(docIALPattern, '');
        logger.info('[removeDocumentIAL] Removed document-level IAL with --- prefix');
    }

    // 步骤2: 移除所有块级IAL（{: ...}\n格式）
    // 格式如：{: id="20251120112342-fg8fppm" updated="20251120112342"}
    const blockIALPattern = /\n\{:[^}]*\}\s*\n/g;
    const blockIALMatches = cleaned.match(blockIALPattern);
    if (blockIALMatches) {
        logger.info(`[removeDocumentIAL] Found ${blockIALMatches.length} block-level IAL attributes`);
        cleaned = cleaned.replace(blockIALPattern, '\n');
        logger.info('[removeDocumentIAL] Removed all block-level IAL attributes');
    }

    // 步骤3: 移除可能在行末的IAL（例如：## 标题{: id="xxx"}）
    const inlineIALPattern = /\{:[^}]*\}/g;
    const inlineIALMatches = cleaned.match(inlineIALPattern);
    if (inlineIALMatches) {
        logger.info(`[removeDocumentIAL] Found ${inlineIALMatches.length} inline IAL attributes`);
        cleaned = cleaned.replace(inlineIALPattern, '');
        logger.info('[removeDocumentIAL] Removed all inline IAL attributes');
    }

    const removedChars = originalLength - cleaned.length;
    if (removedChars > 0) {
        logger.info(`[removeDocumentIAL] Total removed: ${removedChars} chars`);
    } else {
        logger.info('[removeDocumentIAL] No IAL attributes found');
    }

    return cleaned;
}
```

## 为什么需要移除所有IAL？

1. **文档级IAL**：
   - 包含文档属性
   - 如果包含时间戳会导致解析错误

2. **块级IAL**：
   - 每个块都有ID和更新时间
   - 这些ID在重新插入时会冲突
   - 更新时间戳会被误认为块引用

3. **内联IAL**：
   - 可能在某些特殊情况下存在
   - 为了完整性也需要移除

## 移除IAL的影响

### 不会影响：
- ✅ 文档的基本结构（标题、段落、列表等）
- ✅ 文档的内容
- ✅ 文档的链接和图片
- ✅ 块属性（通过API设置的属性仍然保留）

### 会移除：
- ❌ 块的历史ID信息
- ❌ 块的更新时间戳
- ❌ 其他kramdown特有的属性

### 为什么可以安全移除？
1. **思源会自动重新生成**：更新文档后，思源会为每个块生成新的ID和属性
2. **我们使用API设置的属性**：通过 `setBlockAttrs` API设置的属性（如 `custom-merged-ids`）不会丢失
3. **内容合并不依赖块ID**：我们的去重逻辑基于 `custom-merged-ids` 属性，不依赖块的kramdown ID

## 测试建议

1. **重启思源笔记**或重新加载插件
2. **尝试同步消息**
3. **观察日志**：
   - 查看移除了多少IAL属性
   - 确认没有"found invalid ID"错误
4. **验证功能**：
   - 同一天的消息是否合并到同一文档
   - 已存在的消息是否正确跳过

## 预期日志输出

成功的情况：
```
[getDocumentContent] Original content length: 1332
[getDocumentContent] Content starts with: ---
[removeDocumentIAL] Removed document-level IAL with --- prefix
[removeDocumentIAL] Found 5 block-level IAL attributes
[removeDocumentIAL] Removed all block-level IAL attributes
[removeDocumentIAL] Total removed: 250 chars
[getDocumentContent] After IAL removal - length: 1082
[updateDocument] Successfully updated document: 20251120112342-79a8u46
```

## 完整的修复历程

我们经历了以下步骤才找到根本原因：

1. ✅ 修复GraphQL响应格式问题
2. ✅ 添加ID有效性验证
3. ✅ 移除文档级IAL（第一次尝试）
4. ✅ 改用思源格式时间戳（仍然有问题）
5. ✅ **移除所有IAL**（最终解决方案）

## 技术细节

### 什么是IAL？

IAL（Inline Attribute List）是kramdown的语法扩展，用于为markdown元素添加属性：

```markdown
## 标题
{: id="my-id" class="my-class"}

这是一个段落
{: style="color: red"}
```

### 思源如何使用IAL？

思源使用IAL来：
- 为每个块分配唯一ID
- 记录块的创建和更新时间
- 存储自定义属性
- 维护文档结构

### 为什么会有解析错误？

当IAL中的内容（如时间戳、ID）的格式被思源误认为是块引用时，就会产生"found invalid ID"错误。即使改用思源格式（纯数字），IAL本身的存在仍然可能导致问题。

## 修改的文件

`siyuan-plug/src/sync/fileHandler.ts`:
- 第659-698行：完全重写 `removeDocumentIAL` 函数
- 支持移除文档级、块级和内联IAL
- 添加详细的日志记录

## 总结

这是一个逐步深入的问题：
- 一开始以为是时间戳格式问题（ISO vs 思源格式）
- 后来发现是IAL的存在
- 最后发现不仅要移除文档级IAL，还要移除所有块级IAL

通过完整移除所有IAL，我们确保了思源在解析更新内容时不会遇到任何误解析的情况。
