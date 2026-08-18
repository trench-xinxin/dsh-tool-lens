# 更新日志 (CHANGELOG)

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/) 规范。

---

## [1.0.0] - 2026-08-18

### 🎉 全栈里程碑发布：前端 SFC 组件与多语言驱动层 (Phase 4)

#### ✨ 新增特性 (Features)
- **Vue 3 SFC 单文件组件深度支持 (`.vue`)**:
  - 精准提取 `<script setup lang="ts">` 与普通 `<script>` 中的响应式变量、普通函数、类及导入；
  - 自动扫描 `<template>` 中使用的子组件标签（支持 PascalCase `<UserHeader>` 与 kebab-case `<user-header>`），建立组件间拓扑引用边与组件节点。
- **Svelte 单文件组件支持 (`.svelte`)**:
  - 提取 `<script>` 逻辑与模板中的组件依赖，建立组件节点与调用链路。
- **多语言驱动层抽象 (`LanguageDriver` & `DriverRegistry`)**:
  - 抽象统一的 `LanguageDriver` 接口与 `DriverRegistry` 注册表，解耦具体语言语法提取与图存储，内置 `TSLanguageDriver` 与 `SFCLanguageDriver`。
- **扩展名探测升级**:
  - 扩展支持 `.vue` 与 `.svelte` 扩展名的自动扫描与缺省后缀省略探测（如 `import App from './App'` 自动匹配 `App.vue`）。

---

## [0.3.1] - 2026-08-18

### 🩹 修复与优化 (Fixes)
- 修复 npm 页面上点击“简体中文”/“English”语言切换时由于相对路径解析导致的 404 问题，替换为绝对 GitHub 文档路径。
- 在 `package.json` 中补齐 `repository`、`homepage` 和 `bugs` 链接元数据。

---

## [0.3.0] - 2026-08-18

### ⚡ 核心演进：增量引擎、架构诊断与精准解析 (Phase 1 ~ Phase 3)

#### ✨ 新增特性 (Features)
- **增量缓存与毫秒级查询 (Phase 3)**:
  - 新增 `IncrementalCacheStore` 增量缓存管理器，基于 `mtime` 和 `SHA-256` 内容哈希，二次及后续查询未修改文件 100% 命中缓存（实测响应耗时 < 50ms）。
  - 支持 `.dsh/lens-cache.json` 磁盘快照持久化与热恢复。
  - 新增 `LensWatcher` 文件变更监听器，支持 100ms 防抖与目录过滤，实时保持图谱拓扑最新。
- **循环依赖审计 (`action: circular`) (Phase 2)**:
  - 基于 Tarjan 强连通分量 (SCC) 与 DFS 染色法算法，一键检测代码库中所有的闭合环路（如 `A -> B -> C -> A`），输出完整闭环链路与受波及文件清单。
- **架构健康度与耦合度度量 (`action: metrics`) (Phase 2)**:
  - 统计每个模块的扇入（Afferent Coupling, $Ca$）、扇出（Efferent Coupling, $Ce$）与不稳定度（$I = Ce / (Ca + Ce)$）。
  - 输出 Top Hubs 核心枢纽符号榜，精准定位 God Class 与高频核心调用节点。
- **重构爆炸半径三级智能分级 (`action: impact`) (Phase 2)**:
  - 细化为 🔴 **Tier 0 Direct Breaking**（直接依赖该签名的外部 Callers/Importers）、🟡 **Tier 1 Internal Cascading**（同文件内部级联受影响的函数）与 🔵 **Tier 2 Transitive Importers**（上游间接引用模块）。
- **Re-export 完整支持 (Phase 1)**:
  - 解析 `export * from './mod'` 与具名别名重导出 `export { a, b as c } from './mod'`，建立符号导出传递链路。
- **tsconfig Paths 别名解析 (Phase 1)**:
  - 自动识别 `tsconfig.json` / `jsconfig.json` 的 `compilerOptions.baseUrl` 与 `paths` 别名映射（如 `@/*`）。
- **OOP 继承与实现拓扑提取 (Phase 1)**:
  - 解析类与接口的 `heritageClauses`，建立 `extends` 继承和 `implements` 实现边。
- **4-Tier 作用域调用链精准消歧 (Phase 1)**:
  - 优先级阶梯：同文件/同类 -> 显式 import 绑定 -> 命名空间导入 -> 唯一全局匹配，彻底消除跨文件同名函数误报。
- **Mermaid 拓扑图与防 Token 溢出 (Phase 1)**:
  - 节点数 $\le 25$ 时自动生成交互式 Mermaid 流程图。
  - 节点数 $> 50$ 时智能折叠截断并输出 Top 30 核心节点，防止大模型 Context 溢出。

#### 🏗 架构与重构 (Architecture & Refactoring)
- 按 Clean Architecture 分层规范重构为 `src/core/`、`src/parsers/`、`src/analytics/` 与 `src/render/`。
- 对外 100% 保持现有 API 及根目录导出的向后兼容性。
- 配置独立的 TypeScript 编译与 Vitest 单测环境，全套 20 个单元测试 100% 绿灯通过，TypeScript 严格类型检查 0 错误。

---

## [0.1.2] - 2026-08-17

### 🚀 初始版本发布
- 实现基础 TypeScript AST 静态解析与内存有向图存储。
- 提供 `dependencies`、`call_graph` 与基础 `impact` 三类核心 Action。
- 提供零配置 CLI 启动器 `bin/dsh-lens.js`。
