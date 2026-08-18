# DeepSeek Lens (`@trench-xinxin/dsh-tool-lens`)

<p align="left">
  <a href="https://github.com/trench-xinxin/dsh-tool-lens/blob/main/README.md">English</a> | <b>简体中文</b>
</p>

<p align="center">
  <a href="https://github.com/trench-xinxin/dsh-tool-lens/actions/workflows/ci.yml"><img src="https://github.com/trench-xinxin/dsh-tool-lens/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://npmjs.com/package/@trench-xinxin/dsh-tool-lens"><img src="https://img.shields.io/npm/v/@trench-xinxin/dsh-tool-lens.svg" alt="npm version" /></a>
  <a href="https://npmjs.com/package/@trench-xinxin/dsh-tool-lens"><img src="https://img.shields.io/npm/dm/@trench-xinxin/dsh-tool-lens.svg" alt="npm downloads" /></a>
  [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/trench-xinxin/dsh-tool-lens/blob/main/LICENSE)
</p>[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek-Harness%20Plugin-0066FF.svg)](https://github.com/deepseek-ai/deepseek-harness)

**DeepSeek Lens** 是专为 **DeepSeek Harness** 智能体底座打造的高性能、确定性 AST 代码图谱与架构治理分析插件。

它弥补了大模型在大型代码库中“代码阅读盲目”、“全局拓扑模糊”、“重构破坏面预估不准”的固有短板，为 AI Agent 赋予深度的代码结构与全局感知能力，支持即时模块依赖分析、函数/类方法调用链追踪、OOP 继承拓扑、循环引用审计、架构耦合度度量、Git 变更增量影响审计、业务领域架构智能切片以及跨前后端全栈 API 契约追踪。

---

## ⚡ 零配置一键即用（无需额外安装或启动 DeepSeek Harness）

> 💡 **核心优势**：你**无需提前安装**任何 `@deepseek-ai/dsh` 全局命令，也**无需在后台单独手动启动任何 Harness 服务**！  
> 直接运行以下一条命令，脚手架将全自动下载运行时、智能避让端口并直接拉起预载 Lens 工具的完整 Web 界面：

```bash
# 🚀 零配置一键拉起 Web 交互界面（开箱即用）
npx @trench-xinxin/dsh-tool-lens

# 或直接在终端执行一次性自然语言代码分析任务
npx @trench-xinxin/dsh-tool-lens "使用 lens 工具审计项目中的循环依赖"
```

启动成功后，浏览器会自动打开或访问提示的本地地址（如 `http://127.0.0.1:3080` 或 `http://127.0.0.1:3081`）。

---

## 🌟 核心特性矩阵 (v2.0)

1. **📦 模块与依赖拓扑 (`dependencies`)**
   - 精准解析 ES 模块与 CommonJS 的 `import` / `export` 引用。
   - **Re-export 完整支持**：支持 `export * from './mod'` 及具名别名重导出。
   - **Path Mapping**：自动识别 `tsconfig.json` 的 `compilerOptions.paths` 别名（如 `@/*`）。

2. **📞 精准消歧调用链 (`call_graph`)**
   - 深入解析普通函数、箭头函数以及类成员方法。
   - **4-Tier 作用域消歧**：优先绑定同文件、显式导入（`import { fn }`）与命名空间导入（`Mod.fn`），彻底消除全局同名函数误报。
   - **OOP 关系提取**：自动提取类与接口的 `extends` 继承和 `implements` 实现拓扑。

3. **💥 重构影响面智能分级 (`impact`)**
   - 评估修改或删除某个符号/文件对整个项目的潜在爆炸半径。
   - **三级风险智能分级**：
     - 🔴 **Tier 0 Direct Breaking**：直接依赖该符号/接口的外部 Callers 与直接 Importers。
     - 🟡 **Tier 1 Internal Cascading**：同模块内部受级联影响的函数。
     - 🔵 **Tier 2 Transitive Importers**：上游间接引入该模块的文件。

4. **🔄 闭合循环依赖审计 (`circular`)**
   - 基于 Tarjan 强连通分量与 DFS 染色算法，一键检测所有闭合环路（如 `A -> B -> C -> A`）。
   - 输出环路链路与受波及文件清单，规避运行时初始化死锁与内存泄露。

5. **🧭 最短调用路径寻路 (`action: path`)**
   - 基于双向 BFS 算法，秒级探查两点间（`target` -> `to`）的最短跨模块执行轨迹与调用通路。

6. **🧹 孤岛死代码与无引用符号审计 (`action: unused`)**
   - 基于全图拓扑可达性分析，自动过滤入口文件，审计入度 $Ca = 0$ 的孤岛文件与未被任何代码调用的导出符号。

7. **🛡 架构分层防腐规则检查 (`action: lint`)**
   - 支持自定义分层防腐规则（如 `views/**` 禁止直接调用 `infra/**`），一键拦截跨层违规依赖边。

8. **📝 Git Diff 增量变更影响与回归测试矩阵 (`action: diff_impact`)**
   - 自动扫描工作区 `git diff`（或指定 commit `HEAD~1`），精准提取本次修改的具体文件和方法，沿图谱反向追踪所有下游破坏范围，并**智能推荐需要回归测试的文件清单**。

9. **🧩 业务领域架构智能切片 (`action: slice`)**
   - 在大型单体/微服务项目中，根据种子节点（如 `auth` 或 `order`）自动提取紧密内聚的领域子图（Ego Network / Subgraph Slice），剔除无关边界噪声，输出内聚度评分。

10. **🌐 跨前后端全栈 API 契约自动关联 (`action: api_contracts`)**
    - 自动识别前端（Vue / TS / Svelte）的 `axios.get('/api/users')` / `fetch` 请求，与后端（Java Spring `@GetMapping`、Python FastAPI `@app.get`、Go Gin `r.GET`）路由控制器建立**跨语言虚拟调用边**，真正打通**从前端 UI 组件直达后端数据库/服务实现的方法级端到端全链路图谱**！

11. **🌍 多语言生态驱动全景支持 (`Java / Python / Go / Rust / TS / SFC`)**
    - **Java (`.java`)**：支持 `package`、Maven/Gradle 结构、`class`、`interface`、`extends` 继承、`implements` 接口实现与类静态/实例方法调用。
    - **Python (`.py`)**：支持 `def`、`class` 继承、`self.method()` 及相对/绝对包导入分析。
    - **Go (`.go`)**：支持 `package` 作用域、`go.mod` 模块路径、Struct Embedding 与 Receiver 成员方法。
    - **Rust (`.rs`)**：支持 `mod` 模块、`struct`、`trait`、`impl Trait for Struct` 及方法调用。
    - **Vue 3 & Svelte (`.vue`, `.svelte`)**：支持 `<script setup>`、`<template>` 内组件标签引用与单文件组件解析。

---

## 🛠️ 参数契约定义

大模型通过 `lens` 工具与代码图谱交互：

| 参数名 | 类型 | 必填 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `action` | `enum` | **是** | — | `'diff_impact'`, `'api_contracts'`, `'slice'`, `'path'`, `'impact'`, `'dependencies'`, `'call_graph'`, `'circular'`, `'unused'`, `'lint'`, `'metrics'`。 |
| `target` | `string` | 否 | `.` | 待分析的符号名称、方法名、文件相对路径或领域种子（在某些全局模式下可选）。 |
| `to` | `string` | 否 | — | 路径寻路的目标符号或文件路径（在 `action: path` 模式下使用）。 |
| `rules` | `string` | 否 | — | 自定义架构分层防腐规则 JSON 字符串（在 `action: lint` 模式下使用）。 |
| `commit` | `string` | 否 | — | Git 比较的目标 Commit Hash 或范围（在 `action: diff_impact` 模式下使用）。 |
| `depth` | `number` | 否 | `3` | 最大图谱遍历深度（1 到 5 层）。 |
| `direction` | `enum` | 否 | `both` | `'inbound'` (上游调用/引用), `'outbound'` (下游依赖/调用), 或 `'both'` (双向)。 |
| `scope` | `string` | 否 | `.` | 限制扫描的子目录范围（默认当前工作区）。 |

---

## 💡 使用示例与大模型交互效果

### 场景一：Git 变更增量影响审计
**用户**：*“我刚改了几个文件，帮我分析下当前变更的影响面和回归测试建议”*

```markdown
### Lens: Git Diff Change Impact & Regression Matrix (`git-working-tree`)
> Git diff contains 2 modified file(s), impacting 5 upstream file(s) across 3 breaking caller(s). Recommended 2 regression test file(s).

**Modified Files (2):**
- 📝 `src/core/types.ts`
- 📝 `src/parsers/ts-parser.ts`

**Direct Breaking Upstream Callers (3):**
- 🔴 **[function]** `analyzeSourceCode` (`src/analyzer.ts:45`)
- 🔴 **[function]** `buildCircularResult` (`src/analytics/circular.ts:18`)

**🎯 Recommended Regression Test Suite (2):**
- 🧪 `tests/lens.spec.ts`
```

---

### 场景二：跨前后端全栈 API 契约追踪
**用户**：*“审计全栈前后端接口调用关系”*

```markdown
### Lens: Full-Stack End-to-End API Contracts
> Full-stack API contracts audit: Discovered 8 connected end-to-end HTTP contract(s).

| Method | URL Route | Frontend Client Call | Backend Server Handler |
| :--- | :--- | :--- | :--- |
| **GET** | `/api/v1/users` | `frontend/UserList.vue:15` | `backend/UserController.java:28` |
| **POST** | `/api/v1/orders` | `frontend/OrderView.ts:42` | `backend/order_service.py:55` |
```

---

## 📄 开源协议

MIT License © 2026 Trench / DeepSeek Lens Contributors.
