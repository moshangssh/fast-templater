# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是一个名为 `Note Architect`（插件 ID `fast-templater`）的 Obsidian 可视化模板插件，用于帮助用户通过可视化界面插入模板片段。插件基于 TypeScript 开发，使用 Obsidian API，当前处于开发阶段。

**核心功能规划**（基于 `docs/prd.md`）：
- 可视化模板选择界面（模态窗口）
- 模板搜索和过滤功能
- Markdown 预览功能
- 模板文件夹路径配置
- 一键插入模板到当前编辑器

## 重要注意事项

### 插件 ID
- 当前 `manifest.json` 中的插件 ID 为 `fast-templater`，保持与仓库目录一致
- 手动安装路径：`<Vault>/.obsidian/plugins/fast-templater/`

### 构建产物管理
- 不要提交 `main.js` 到版本控制（已在 `.gitignore` 中排除）
- 发布时需要将 `manifest.json`、`main.js`、`styles.css` 上传到 GitHub Release
- 本地测试时手动复制这些文件到插件目录

## 常用命令

### 开发环境
```bash
# 安装依赖
npm install

# 开发模式（监听文件变化自动编译）
npm run dev

# 生产构建
npm run build

# 版本管理（更新 manifest.json 和 versions.json）
npm run version
```

### 代码质量检查
```bash
# 全局安装 eslint（首次）
npm install -g eslint

# 检查主文件代码质量
eslint main.ts

# 检查 src 目录下所有文件
eslint ./src/
```

### 测试部署
手动安装插件进行测试：
1. 构建：`npm run build`
2. 复制 `main.js`、`manifest.json`、`styles.css` 到 `<Vault>/.obsidian/plugins/fast-templater/`
3. 重启 Obsidian 并启用插件

### 测试说明
当前项目未配置自动化测试框架。如需添加测试，建议：
1. 安装测试框架：`npm install --save-dev jest @types/jest`
2. 配置测试脚本到 `package.json` 的 `scripts` 部分
3. 创建 `*.test.ts` 文件进行单元测试

## 架构和代码结构

### 当前结构
- `main.ts` - 插件主入口，包含插件生命周期管理和基础功能演示
- `manifest.json` - 插件元数据，插件 ID 为 `fast-templater`
- `esbuild.config.mjs` - 构建配置，使用 esbuild 打包 TypeScript 代码
- `package.json` - 项目依赖和脚本配置
- `tsconfig.json` - TypeScript 编译配置
- `.gitignore` - Git 忽略规则，排除了 `docs/`、`.bmad-core/`、`.claude/` 等目录

### 即将实现的功能结构（基于 PRD）
根据 `docs/prd.md` 中的规划，插件将实现以下功能模块：

1. **设置管理** (`src/settings.ts`)
   - 模板文件夹路径配置
   - 插件设置界面

2. **模板读取器** (`src/templateReader.ts`)
   - 扫描指定文件夹下的 .md 文件
   - 模板文件内容加载和缓存

3. **UI 组件** (`src/ui/`)
   - 模板选择模态窗口 (`TemplateModal.ts`)
   - 搜索功能组件
   - Markdown 预览组件

4. **命令注册** (`src/commands/`)
   - 插入模板命令
   - 打开模板选择界面命令

### 技术栈
- **语言**: TypeScript（严格模式）
- **框架**: Obsidian API
- **构建工具**: esbuild
- **UI 框架**: 计划使用 Svelte 构建复杂的模板选择界面
- **目标平台**: Obsidian 桌面版和移动版

## 核心设计原则

### 插件生命周期管理
- 使用 `register*` 方法注册事件监听器、DOM 事件和定时器
- 确保在 `onunload()` 时正确清理资源，避免内存泄漏

### UI 一致性
- 严格遵循 Obsidian 原生设计语言
- 优先使用 Obsidian API 提供的 UI 组件（Modal, Setting 等）
- 支持亮色/暗色主题自适应
- 确保移动端响应式布局

### 性能考虑
- 保持轻量级启动，延迟加载重功能
- 批量文件系统操作，避免频繁 vault 扫描
- 对频繁操作使用防抖/节流

## 开发规范

### 代码组织
- 将 `main.ts` 保持最小化，仅包含插件生命周期管理
- 功能逻辑分离到独立模块文件
- 单个文件超过 200-300 行时考虑拆分

### TypeScript 规范
- 启用严格模式（`strict: true`）
- 使用 async/await 而非 Promise 链
- 为所有公共方法和接口添加类型注解

### 命令和设置
- 提供稳定的命令 ID，避免发布后重命名
- 配置项提供合理默认值和验证
- 使用 `loadData()`/`saveData()` 持久化设置

## 安全和隐私要求

- 默认本地离线操作，仅在必要时进行网络请求
- 禁止隐藏遥测，如需第三方服务必须明确征得用户同意
- 仅访问插件功能所需的 vault 文件范围
- 禁止远程代码执行或自动更新插件代码

## 版本发布流程

1. 更新 `manifest.json` 中的版本号（语义化版本）
2. 更新 `versions.json` 映射插件版本到最低 Obsidian 版本
3. 创建 GitHub Release，标签与版本号完全匹配（不含前缀 'v'）
4. 上传 `manifest.json`、`main.js`、`styles.css` 到 Release
5. 提交 PR 到 obsidian-releases 添加到社区插件列表

## 故障排除

- **插件无法加载**: 检查 `main.js` 和 `manifest.json` 是否在正确的插件目录
- **构建失败**: 确保运行 `npm run build` 或 `npm run dev` 编译 TypeScript
- **命令不显示**: 验证 `addCommand` 在 `onload` 后执行，ID 唯一
- **设置不保存**: 确保正确使用 `loadData`/`saveData` 并重新渲染 UI
- **移动端问题**: 检查是否使用了桌面专属 API，调整 `isDesktopOnly` 设置
