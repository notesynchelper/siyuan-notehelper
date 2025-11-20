# 诊断版本已部署 - 2025-11-20

## 部署的诊断功能

### 1. updateDocument 函数增强日志

在 `siyuan-plug/src/sync/fileHandler.ts` 的 updateDocument 函数中添加了详细的诊断日志：

- **记录传入的 docId**：显示实际使用的文档ID及其类型
- **检测时间戳格式**：如果 docId 是时间戳格式，立即报错并拒绝更新
- **内容检查**：扫描文档内容中是否包含时间戳模式 `[2025-11-20T02:39:00.693Z]`
- **API请求详情**：记录发送给 SiYuan API 的完整请求参数
- **错误响应详情**：记录 API 返回的详细错误信息

### 2. 错误模式分析

根据之前的错误：
```
Failed to update document: data block DOM failed: found invalid ID [2025-11-20T02:39:00.693Z]
```

可能的原因：
1. **内容中包含特殊格式**：方括号中的时间戳可能是内容的一部分，被SiYuan解析为块ID
2. **文档ID传递错误**：尽管getDocumentByPath返回了正确的ID，但可能在某处被覆盖
3. **SiYuan内部错误**：API在处理markdown内容时可能误解了某些格式

## 下一步操作

1. **重启思源笔记**或重新加载插件
2. **再次尝试同步**
3. **查看控制台日志**，特别关注：
   - `[updateDocument]` 开头的日志
   - 查看 docId 的实际值
   - 查看是否检测到内容中的时间戳模式
   - 查看 API 的详细错误响应

## 预期的日志输出

成功的情况：
```
[updateDocument] Called with docId: 20251120103900-dzkmle8
[updateDocument] DocId type: string
[updateDocument] DocId looks like timestamp: false
[updateDocument] Content length: 2345
[updateDocument] Successfully updated document: 20251120103900-dzkmle8
```

有问题的情况：
```
[updateDocument] WARNING: Found timestamp pattern in content: 2025-11-20T02:39:00.693Z
[updateDocument] Content snippet around timestamp: ...
```

## 临时解决方案

如果发现是内容中的时间戳导致的问题，可能需要：
1. 转义或移除内容中的方括号
2. 修改时间戳的显示格式
3. 使用其他分隔符替代方括号

## 版本信息

- 插件版本：v3.4.0
- 部署时间：2025-11-20
- 修改文件：siyuan-plug/src/sync/fileHandler.ts
- 功能：增强的错误诊断日志