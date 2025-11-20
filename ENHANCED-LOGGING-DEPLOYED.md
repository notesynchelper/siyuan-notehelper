# 增强日志版本已部署

## 部署时间
2025-11-20 11:15

## 修改内容

### 1. 增强的IAL处理日志

在 `getDocumentContent` 和 `removeDocumentIAL` 函数中添加了详细的INFO级别日志：

#### getDocumentContent 日志输出：
```
[getDocumentContent] Original content length: 1234
[getDocumentContent] Content starts with: ---\n{: custom-last-merge-time=...
[getDocumentContent] After IAL removal - length: 890, removed: 344 chars
[getDocumentContent] Content now starts with: ## 📅 2025-10-21...
```

#### removeDocumentIAL 日志输出：
```
[removeDocumentIAL] Found IAL with --- prefix: ---\n{: custom-last-merge-time="2025-11-20T03:07:10.567Z" ...}
[removeDocumentIAL] Removed IAL with --- prefix
```

或者：
```
[removeDocumentIAL] No IAL found at document start
```

## 诊断目标

通过这些日志，我们可以确认：

1. **是否获取到了文档内容**
   - 查看 "Original content length" 是否大于0

2. **内容是否包含IAL**
   - 查看 "Content starts with" 是否以 `---\n{:` 开头

3. **IAL是否被成功移除**
   - 查看 "removed: XX chars" 是否大于0
   - 查看 "Content now starts with" 不再包含IAL

4. **为什么还有错误**
   - 如果日志显示IAL被成功移除，但仍有错误
   - 说明时间戳可能来自其他地方

## 下一步操作

1. **重启思源笔记**或重新加载插件
2. **尝试同步1-2条消息**（不需要全部同步）
3. **查看控制台日志**，搜索以下关键词：
   - `[getDocumentContent]`
   - `[removeDocumentIAL]`
   - `found invalid ID`

## 预期结果

### 成功的情况：
```
[getDocumentContent] Original content length: 1234
[getDocumentContent] Content starts with: ---
{: custom-last-merge-time="2025-11-20T...
[removeDocumentIAL] Found IAL with --- prefix: ...
[removeDocumentIAL] Removed IAL with --- prefix
[getDocumentContent] After IAL removal - length: 890, removed: 344 chars
[getDocumentContent] Content now starts with: ## 📅 2025-10-21
[updateDocument] Successfully updated document: 20251120103900-dzkmle8
```

### 问题的情况：
```
[getDocumentContent] No IAL found at document start
```
→ 说明IAL格式可能不匹配正则表达式

或者：
```
[removeDocumentIAL] Removed IAL with --- prefix
... (but still error)
```
→ 说明时间戳来自其他地方，可能是新追加的内容

## 可能需要的进一步修复

根据日志输出，可能需要：

1. **调整正则表达式**
   - 如果IAL格式与预期不同

2. **清理其他位置的IAL**
   - 不仅是文档开头，可能内容中也有

3. **修改时间戳格式**
   - 从ISO格式改为其他格式

4. **更换API**
   - 从 `/api/block/getBlockKramdown` 换成其他API

请提供新的日志，我会根据实际情况进一步修复。
