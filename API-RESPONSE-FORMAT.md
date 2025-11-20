# API 响应格式记录

## 服务端实际返回格式

测试时间：2025-11-20
API端点：https://siyuan.notebooksyncer.com/api/graphql
API Key: o56E7690LHHXd5zvCAqoPobIuqq4

### 实际返回格式（非标准GraphQL）

服务端直接返回了 search 查询的内容，跳过了标准 GraphQL 的 `data` 和 `search` 包装层：

```json
{
  "edges": [
    {
      "node": {
        "id": "文章ID",
        "title": "文章标题",
        "url": "文章URL",
        "content": "文章内容",
        // ... 其他字段
      }
    }
  ],
  "pageInfo": {
    "hasNextPage": true,
    "hasPreviousPage": false,
    "startCursor": "0",
    "endCursor": "1",
    "totalCount": 2
  }
}
```

### 标准GraphQL格式（理论上应该返回的）

```json
{
  "data": {
    "search": {
      "edges": [...],
      "pageInfo": {...}
    }
  }
}
```

## 代码修复

### 修改文件
`siyuan-plug/src/api.ts` 第117-147行

### 修复内容
增强了响应格式检测逻辑，支持三种格式：

1. **完整标准格式**：`{data: {search: {...}}}`
2. **部分标准格式**：`{data: {...}}`
3. **非标准格式**：直接返回 `{edges: [...], pageInfo: {...}}`

### 核心代码
```typescript
// 检查响应格式
let responseData: T;
if (result.data !== undefined) {
    // 标准 GraphQL 响应
    if (result.data.search !== undefined) {
        // 完整的标准格式：data.search 包含实际数据
        responseData = result.data.search as T;
        logger.info('Standard GraphQL response with search wrapper');
    } else {
        // 标准格式但没有 search 包装
        responseData = result.data;
        logger.info('Standard GraphQL response without search wrapper');
    }
} else if (result.edges !== undefined && result.pageInfo !== undefined) {
    // 非标准响应：服务端直接返回 search 的内容
    responseData = result as unknown as T;
    logger.warn('Non-standard GraphQL response: server returns search content directly');
} else {
    // 未知格式，记录详细信息并报错
    logger.error('Unexpected response structure:', {...});
    throw new Error('Unexpected response structure');
}
```

## 测试结果
- 服务端能正常响应查询
- 返回的数据格式为非标准格式（直接返回edges和pageInfo）
- 修复后的代码能正确处理这种格式
- 插件已编译并部署到思源目录

## 注意事项
1. console日志中第5-8行的错误来自SiYuan主程序，与插件无关
2. 插件本身运行正常，数据获取成功
3. 服务端可能需要更新以返回标准GraphQL格式