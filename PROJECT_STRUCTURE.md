# 笔记同步助手 (siyuan-notehelper) 项目结构文档

## 1. 项目概述

| 属性 | 值 |
|------|-----|
| **项目名称** | 笔记同步助手 (siyuan-notehelper) |
| **版本** | 1.6.0 |
| **类型** | 思源笔记 SiYuan 插件 |
| **功能** | 将微信、企微、公众号、小红书、得到等平台的内容同步到思源笔记 |

### 核心特性
- 从云端同步文章、聊天记录、文字、图片等内容
- 支持实时同步和定时自动同步
- 灵活的合并模式（独立文件、按日期合并企微消息、全部合并）
- 高亮、标签、图片处理支持
- VIP 会员管理
- 完整的模板和自定义配置系统

---

## 2. 目录结构

```
siyuan-plug/
├── src/                           # 源代码目录
│   ├── index.ts                   # 插件主入口，Plugin 类扩展
│   ├── api.ts                     # API 通信层（GraphQL 和 REST）
│   ├── index.scss                 # 样式文件
│   ├── settings/                  # 设置管理模块
│   │   ├── index.ts               # 设置定义和默认值
│   │   └── template.ts            # 模板引擎（Mustache）
│   ├── sync/                      # 同步核心模块
│   │   ├── syncManager.ts         # 同步管理器（业务流程）
│   │   └── fileHandler.ts         # 文件处理器（思源笔记 API 集成）
│   ├── ui/                        # UI 组件
│   │   └── SettingsForm.ts        # 设置表单组件
│   ├── utils/                     # 工具函数
│   │   ├── types.ts               # TypeScript 类型定义
│   │   ├── util.ts                # 通用工具函数
│   │   └── logger.ts              # 日志系统
│   └── imageLocalizer/            # 图片处理模块（已禁用）
│       ├── imageLocalizer.ts
│       └── types.ts
├── dist/                          # 编译输出目录
├── node_modules/                  # 依赖包
├── package.json                   # 项目配置和依赖
├── tsconfig.json                  # TypeScript 配置
├── webpack.config.js              # Webpack 打包配置
├── eslint.config.mjs              # ESLint 配置
├── plugin.json                    # 思源笔记插件配置
├── README.md                      # 项目文档
└── LICENSE                        # 许可证
```

---

## 3. 核心模块说明

### 3.1 主入口 (`src/index.ts`)

**职责**: 插件生命周期管理和 UI 界面

**关键类**: `NoteHelperPlugin extends Plugin`

**主要功能**:
- 插件加载/卸载生命周期管理
- 国际化文本定义（中文）
- UI 组件注册：顶栏图标、状态栏、左侧 Dock 面板、右键菜单
- 命令注册（快捷键: ⌘⇧S 同步）
- 设置管理和自动保存
- VIP 状态管理

**关键生命周期**:
- `onload()`: 初始化插件、加载设置、启动定时同步
- `onLayoutReady()`: UI 界面就绪后的操作
- `onunload()`: 卸载时清理定时器

---

### 3.2 API 服务层 (`src/api.ts`)

**职责**: 与后端服务器通信

| 函数 | 功能 | 请求方式 |
|------|------|--------|
| `fetchGraphQL<T>()` | GraphQL 请求通用函数 | POST |
| `getItems()` | 分页获取文章列表 | POST (GraphQL) |
| `deleteItem()` | 删除单篇文章 | POST (GraphQL mutation) |
| `getArticleCount()` | 获取云空间文章总数 | GET |
| `clearAllArticles()` | 清空云空间所有文章 | DELETE |
| `fetchContentForItems()` | 批量获取文章完整内容 | POST |
| `fetchVipStatus()` | 查询用户 VIP 状态 | GET |

**响应格式支持**:
```typescript
// 支持三种格式
1. 标准: {data: {search: {edges, pageInfo}}}
2. 标准无wrapper: {data: {edges, pageInfo}}
3. 非标准: {edges, pageInfo}  // 服务端直接返回
```

---

### 3.3 同步管理器 (`src/sync/syncManager.ts`)

**职责**: 协调整个同步流程

**核心流程**:
```
sync()
├─ 检查同步状态 (防止重复同步)
├─ 验证 API 密钥
├─ 获取默认笔记本 ID
├─ 分批获取文章 (15篇/批)
├─ 逐篇处理文章
│  └─ 通过 FileHandler.processArticle()
├─ 更新同步时间
└─ 返回 SyncResult {success, count, skipped, errors}
```

**主要方法**:
- `sync()`: 执行一次完整同步
- `resetSyncTime()`: 重置同步时间以获取全量文章
- `startScheduledSync()`: 启动定时同步
- `stopScheduledSync()`: 停止定时同步

---

### 3.4 文件处理器 (`src/sync/fileHandler.ts`)

**职责**: 与思源笔记 API 交互，创建/更新文档

**核心功能**:

1. **文档操作**:
   - `processArticle()`: 处理单篇文章
   - `createSeparateFile()`: 创建独立文件
   - `mergeArticleToFile()`: 合并到单个文件

2. **思源笔记 API**:
   - `createDocument()`: 创建新文档
   - `getDocumentByPath()`: 按路径查找文档
   - `getDocumentBySourceId()`: 按源 ID 查找文档（去重）
   - `appendBlock()`: 追加块内容
   - `setBlockAttributes()`: 设置块属性

**合并模式**:
- `NONE`: 每篇文章独立文件
- `MESSAGES`: 仅合并企微消息
- `ALL`: 所有文章合并到单个文件

---

### 3.5 模板引擎 (`src/settings/template.ts`)

**职责**: 使用 Mustache 模板渲染内容

**核心函数**:
- `articleToView()`: 转换文章对象为模板视图
- `renderArticleContent()`: 渲染普通文章内容
- `renderWeChatMessage()`: 渲染企微消息
- `renderFilename()` / `renderFolderPath()`: 渲染路径

**可用模板变量**:
| 变量 | 说明 |
|------|------|
| `{{{title}}}` | 文章标题 |
| `{{{author}}}` | 作者 |
| `{{{content}}}` | 文章内容 |
| `{{{originalUrl}}}` | 原始链接 |
| `{{{siteName}}}` | 网站名称 |
| `{{{dateSaved}}}` | 保存日期 |
| `{{{datePublished}}}` | 发布日期 |
| `{{{note}}}` | 个人笔记 |
| `{{{highlights}}}` | 高亮列表 |
| `{{{labels}}}` | 标签列表 |
| `{{{wordsCount}}}` | 字数 |

---

### 3.6 设置管理 (`src/settings/index.ts`)

**主要配置分类**:

| 分类 | 配置项 |
|------|--------|
| **基础** | apiKey, endpoint, filter, customQuery |
| **同步** | syncAt, frequency, syncOnStart, mergeMode |
| **文件夹** | folder, filename, singleFileName, attachmentFolder |
| **模板** | template, frontMatterTemplate, wechatMessageTemplate |
| **日期** | dateHighlightedFormat, dateSavedFormat |
| **高亮** | highlightOrder, enableHighlightColorRender |
| **图片** | imageMode, imageAttachmentFolder |

---

### 3.7 UI 组件 (`src/ui/SettingsForm.ts`)

**职责**: 生成和管理设置表单 HTML

**表单结构**:
1. 会员中心（VIP 状态 + 二维码）
2. 文章管理（数量查看、清空）
3. 基础设置（API Key、端点）
4. 同步设置（频率、合并模式）
5. 文件夹设置（路径模板）
6. 模板设置（文章模板、前言模板）
7. 日期格式和高亮设置
8. 图片处理和高级设置

---

### 3.8 类型系统 (`src/utils/types.ts`)

**关键类型**:
```typescript
interface Article {
  id, title, author, content, url, savedAt, publishedAt,
  highlights, labels, note, description, siteName, image,
  wordsCount, readLength, state, archivedAt, type
}

interface Highlight {
  id, quote, annotation, color, highlightedAt
}

interface Label {
  id, name, color, description
}

interface SyncResult {
  success, count, skipped, errors
}

enum MergeMode { NONE, MESSAGES, ALL }
enum ImageMode { LOCAL, REMOTE, DISABLED, PROXY }
```

---

### 3.9 工具函数 (`src/utils/util.ts`)

- `formatDate()`: 日期格式化（Luxon）
- `sanitizeFileName()`: 清理文件名
- `generateId()`: 生成唯一 ID
- `sleep()`, `debounce()`, `throttle()`: 时间控制
- `isWeChatMessage()`: 判断是否企微消息
- `normalizePath()`, `joinPath()`: 路径处理

---

### 3.10 日志系统 (`src/utils/logger.ts`)

- 四个日志级别: `DEBUG`, `INFO`, `WARN`, `ERROR`
- 带时间戳和彩色输出
- JSON 对象格式化
- 性能监测 (`time()` / `timeEnd()`)

---

## 4. 依赖关系图

```
index.ts (Plugin 入口)
├── settings/ (配置管理)
│   ├── template.ts (模板引擎)
│   └── index.ts (默认配置)
├── sync/
│   ├── syncManager.ts (同步流程)
│   │   ├── fileHandler.ts (思源 API)
│   │   └── api.ts (后端通信)
│   └── fileHandler.ts
├── api.ts (GraphQL/REST 通信)
├── ui/
│   └── SettingsForm.ts (设置表单)
└── utils/
    ├── types.ts (类型定义)
    ├── util.ts (工具)
    └── logger.ts (日志)
```

---

## 5. 构建配置

### NPM 脚本
```bash
npm run lint          # ESLint 检查
npm run dev           # Webpack watch 开发模式
npm run build         # 生产构建
```

### Webpack 配置
- 入口: `src/index.ts`
- 输出: `dist/index.js` + `dist/index.css`
- 使用 `esbuild-loader` 编译 TypeScript
- 使用 `sass-loader` 处理 SCSS
- 生产构建自动生成 `package.zip`

### TypeScript 配置
- 目标: ES6
- 模块: CommonJS
- 严格模式: `noImplicitAny: true`

---

## 6. 依赖包

### 运行时依赖
| 包名 | 用途 |
|------|------|
| crypto-js | 加密算法 |
| lodash | 工具函数库 |
| luxon | 日期时间处理 |
| markdown-escape | Markdown 字符转义 |
| mustache | 模板引擎 |

### 开发依赖
- TypeScript 生态: typescript, @types/*
- 构建工具: webpack, esbuild-loader
- 样式处理: sass, sass-loader
- 代码质量: eslint, @typescript-eslint
- 思源 SDK: siyuan

---

## 7. 主要数据流

```
用户触发同步
    ↓
index.ts: performSync()
    ↓
SyncManager.sync()
    ├─ api.ts: getItems() [获取文章列表]
    ├─ 循环处理每篇文章:
    │   └─ FileHandler.processArticle()
    │       ├─ 判断是否合并
    │       ├─ template.ts: 渲染内容
    │       └─ 思源笔记 API:
    │           ├─ createDocument()
    │           ├─ appendBlock()
    │           └─ setBlockAttributes()
    └─ 返回 SyncResult
    ↓
index.ts: 更新 UI 和同步时间
```

---

## 8. 关键设计模式

### 8.1 防重复同步
- 使用思源笔记块属性存储源 ID (`source-id`)
- 同步前通过 `getDocumentBySourceId()` 检查

### 8.2 文档缓存
- `FileHandler.documentCache`: 缓存路径到 ID 的映射
- 每次同步开始时清除缓存

### 8.3 灵活的合并模式
- **NONE**: 每篇文章独立文件
- **MESSAGES**: 企微消息合并，其他独立
- **ALL**: 所有文章按日期合并

---

## 9. 文件说明

| 文件 | 行数 | 功能 |
|------|------|------|
| index.ts | ~1000 | 插件主类、UI 管理 |
| api.ts | ~570 | GraphQL 通信 |
| syncManager.ts | ~186 | 同步流程管理 |
| fileHandler.ts | ~600 | 思源 API 集成 |
| template.ts | ~400 | Mustache 模板引擎 |
| SettingsForm.ts | ~600 | 设置表单 HTML |
| settings/index.ts | ~157 | 配置定义 |
| util.ts | ~159 | 工具函数 |
| logger.ts | ~131 | 日志系统 |
| types.ts | ~132 | TypeScript 类型 |

---

## 10. 插件配置 (plugin.json)

```json
{
  "name": "siyuan-notehelper",
  "version": "1.6.0",
  "minAppVersion": "3.3.0",
  "backends": ["all"],
  "frontends": ["all"],
  "disabledInPublish": true,
  "displayName": { "default": "笔记同步助手" }
}
```

---

## 总结

笔记同步助手是一个功能完整、架构清晰的思源笔记同步插件，具有：
- **清晰的模块化设计**（API、同步、文件、UI 分离）
- **完整的类型系统支持**（TypeScript）
- **灵活的配置和模板系统**
- **强大的日志和调试支持**
- **良好的容错和去重机制**
