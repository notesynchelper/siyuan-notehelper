# 笔记同步助手 - 思源笔记插件

从微信同步到思源笔记，支持文字、图片、聊天记录、文章。

[English](README.md) | 中文

## ✨ 功能特性

### 核心功能
- ✅ **基础同步**：从云端同步文章和笔记到思源
- ✅ **增量同步**：基于时间戳的增量同步机制
- ✅ **定时同步**：可配置的自动同步频率
- ✅ **启动同步**：思源启动时自动同步

### 文件组织
- ✅ **多种合并模式**：
  - 不合并：每篇文章独立文件
  - 仅合并企微消息：按日期合并企微消息
  - 合并所有：所有文章合并到单个文件
- ✅ **自定义文件夹**：支持日期模板的文件夹路径
- ✅ **自定义文件名**：灵活的文件名模板系统

### 模板系统
- ✅ **Mustache 模板引擎**：强大的内容渲染
- ✅ **前言（Front Matter）支持**：自定义元数据
- ✅ **企微消息模板**：简洁的企微消息渲染
- ✅ **变量系统**：支持 30+ 个模板变量

### 图片处理
- ✅ **本地缓存模式**：下载图片到本地
- ✅ **远程保留模式**：保留原始网络链接
- ✅ **禁用模式**：注释掉图片语法
- ✅ **自动重试**：图片下载失败自动重试

## 📦 安装

### 方法1：从源码构建

```bash
# 克隆仓库
git clone https://github.com/laizeyang/siyuan-notehelper
cd siyuan-notehelper

# 安装依赖
pnpm install

# 开发模式（实时编译）
pnpm run dev

# 或构建生产版本
pnpm run build
```

### 方法2：手动安装

1. 下载最新的 `package.zip` 发布包
2. 解压到思源插件目录：`{工作空间}/data/plugins/`
3. 重启思源笔记
4. 在设置 -> 集市 -> 已下载 中启用插件

## 🚀 快速开始

### 1. 配置 API 密钥

1. 打开插件设置
2. 输入你的 API 密钥
3. 配置服务器地址（默认：https://siyuan.notebooksyncer.com/api/graphql）

### 2. 开始同步

- **手动同步**：点击顶栏的同步图标
- **定时同步**：在设置中配置自动同步频率（如 30 分钟）
- **启动同步**：启用"启动时同步"选项

### 3. 自定义模板

在设置中可以自定义文章渲染模板：

```markdown
# {{{title}}}
#笔记同步助手

**来源**：[{{{siteName}}}]({{{originalUrl}}})
**保存时间**：{{{dateSaved}}}

## 正文
{{{content}}}
```

## ⚙️ 配置说明

### 基础设置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| API 密钥 | 你的笔记同步服务 API 密钥 | 空 |
| 服务端点 | 笔记同步服务器地址 | https://siyuan.notebooksyncer.com/api/graphql |
| 过滤器 | 同步文章的过滤条件 | 同步所有文章 |

### 同步设置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| 定时同步频率 | 自动同步间隔（分钟），0 表示禁用 | 0 |
| 启动时同步 | 思源笔记启动时自动同步 | 关闭 |
| 合并模式 | 文章组织方式 | 仅合并企微消息 |

### 模板变量

支持的模板变量：

- `{{{title}}}` - 文章标题
- `{{{content}}}` - 文章内容
- `{{{author}}}` - 作者
- `{{{originalUrl}}}` - 原文链接
- `{{{dateSaved}}}` - 保存日期
- `{{{datePublished}}}` - 发布日期
- `{{{description}}}` - 描述
- `{{{siteName}}}` - 站点名称
- `{{{labels}}}` - 标签列表
- `{{{highlights}}}` - 高亮列表
- 更多变量请查看文档

## 📁 项目结构

```
siyuan-plug/
├── src/
│   ├── index.ts                    # 主入口文件
│   ├── api.ts                      # API 服务层
│   ├── utils/                      # 工具类
│   │   ├── types.ts               # 类型定义
│   │   ├── logger.ts              # 日志工具
│   │   └── util.ts                # 通用工具函数
│   ├── settings/                   # 设置系统
│   │   ├── index.ts               # 设置定义和默认值
│   │   └── template.ts            # 模板引擎
│   ├── sync/                       # 同步管理
│   │   ├── syncManager.ts         # 同步管理器
│   │   └── fileHandler.ts         # 文件处理器
│   ├── imageLocalizer/             # 图片本地化
│   │   ├── imageLocalizer.ts      # 图片本地化器
│   │   └── types.ts               # 类型定义
│   └── i18n/                       # 国际化
│       ├── zh_CN.json             # 中文语言包
│       └── en_US.json             # 英文语言包
├── plugin.json                     # 插件配置
├── package.json                    # 项目配置
└── README_zh_CN.md                # 中文文档
```

## 🔧 开发说明

### 技术栈

- TypeScript 4.8.4
- Mustache 模板引擎
- Luxon 日期处理
- Crypto-js 加密工具
- Lodash 工具库

### 核心模块

1. **SyncManager**：管理同步流程
2. **FileHandler**：处理文件创建和更新
3. **ImageLocalizer**：处理图片下载和本地化
4. **Template Engine**：Mustache 模板渲染

### 思源 API 使用

插件使用以下思源内核 API：

- `/api/filetree/createDocWithMd` - 创建文档
- `/api/filetree/getIDsByHPath` - 获取文档 ID
- `/api/block/updateBlock` - 更新块内容
- `/api/block/getBlockKramdown` - 获取块 Markdown
- `/api/asset/upload` - 上传资源
- `/api/notebook/lsNotebooks` - 列出笔记本

## ❓ 常见问题

### 同步失败怎么办？

1. 检查 API 密钥是否正确
2. 检查网络连接
3. 查看思源控制台的错误日志
4. 确认服务器地址配置正确

### 如何重置同步？

点击菜单中的"重置同步时间"，下次同步将获取所有文章。

### 图片下载失败？

1. 检查图片 URL 是否可访问
2. 增加重试次数
3. 切换到远程保留模式

### 企微消息如何识别？

插件自动识别标题格式为 `同步助手_yyyyMMdd_xxx_类型` 的消息为企微消息，并按日期合并。

## 📝 更新日志

### v0.1.0 (2025-01-04)

- ✅ 初始版本发布
- ✅ 实现基础同步功能
- ✅ 支持模板系统
- ✅ 支持图片本地化
- ✅ 支持企微消息特殊处理

## 📄 许可证

MIT License

## 🙏 致谢

- 基于 [siyuan-note/plugin-sample](https://github.com/siyuan-note/plugin-sample)
- 参考 [Obsidian 笔记同步助手](https://github.com/laizeyang/obsidian-notehelper)

## 📮 联系方式

- GitHub: https://github.com/laizeyang/siyuan-notehelper
- Issues: https://github.com/laizeyang/siyuan-notehelper/issues
