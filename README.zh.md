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

**DeepSeek Lens** 是专为 **DeepSeek Harness** 智能体底座打造的高性能、确定性 AST 代码图谱与拓扑分析工具插件。

它弥补了大模型在大型代码库中“代码阅读盲目”、“全局拓扑模糊”、“重构破坏面预估不准”的固有短板，为 AI Agent 赋予深度的代码结构与全局感知能力，支持即时模块依赖分析、函数/类方法调用链追踪、OOP 继承拓扑、循环引用审计、架构耦合度度量以及重构爆炸半径三级分级评估。

---

## ⚡ 零配置一键即用（免改任何文件）

无需编写任何 YAML 配置文件，直接通过 `npx` 一行命令即可启动预载 Lens 图谱能力的 DeepSeek Harness：

```bash
# 🚀 零配置一键启动 Web 界面
npx @trench-xinxin/dsh-tool-lens

# 或直接运行一次性任务
npx @trench-xinxin/dsh-tool-lens "使用 lens 工具审计项目中的循环依赖"
```

---

## 🌟 核心特性矩阵 (v0.2.0)

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
   - **Rust (`.rs`)**：支持 `mod` 树、`Cargo.toml`、`trait` 定义、`impl Trait for Struct` 特质实现与关联方法。
   - **前端 SFC**：支持 Vue 3 SFC (`.vue`) 与 Svelte (`.svelte`)。

9. **⚡ 毫秒级增量缓存与实时 Watch 模式 (`incremental & watch`)**
   - 基于 `mtime` 与 `SHA-256` 内容哈希，二次查询未修改文件 100% 命中缓存，实现毫秒级响应（< 20ms）。
   - 自动支持 `.dsh/lens-cache.json` 磁盘快照持久化。
   - 提供 `LensWatcher` 100ms 防抖监听，源码变动时自动热同步图谱。

7. **📊 架构健康度与耦合度指标 (`metrics`)**
   - **扇入（Afferent Coupling, $Ca$）** 与 **扇出（Efferent Coupling, $Ce$）**。
   - **不稳定度（Instability, $I = Ce / (Ca + Ce)$）** 评估模块易碎性。
   - **Top Hubs 核心枢纽符号榜**：快速定位 God Class 与核心高频调用节点。

8. **🎨 Mermaid 可视化与 Token 防溢出**
   - 节点数 $\le 25$ 时自动生成交互式 Mermaid 拓扑流程图。
   - 节点数 $> 50$ 时启动智能折叠截断，彻底避免大模型 Context 溢出。

---

## 📖 工具参数与 Action 说明

大模型通过 `lens` 工具与代码图谱交互：

| 参数名 | 类型 | 必填 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `action` | `enum` | **是** | — | `'dependencies'` (模块依赖), `'call_graph'` (调用链), `'impact'` (改动分级影响面), `'circular'` (循环依赖审计), 或 `'metrics'` (耦合度健康分析)。 |
| `target` | `string` | 否 | `.` | 待分析的符号名称、方法名或文件相对路径（在 `circular` 与 `metrics` 模式下可选）。 |
| `depth` | `number` | 否 | `3` | 最大图谱遍历深度（1 到 5 层）。 |
| `direction` | `enum` | 否 | `both` | `'inbound'` (上游调用/引用), `'outbound'` (下游依赖/调用), 或 `'both'` (双向)。 |
| `scope` | `string` | 否 | `.` | 限制扫描的子目录范围（默认整个工作区）。 |

---

## 💡 使用示例与大模型交互效果

### 场景一：循环依赖审计
**用户**：*“请使用 lens 审计当前项目的循环依赖”*

```markdown
### Lens: Circular Dependency Audit
> ⚠️ Detected 1 circular dependency cycle(s) involving 3 file(s).

**Detected Cycles:**
#### Cycle #1 (3 nodes)
```text
src/a.ts 
  └──> src/b.ts 
  └──> src/c.ts 
  └──> src/a.ts
```
```

### 场景二：重构爆炸半径分级
**用户**：*“如果我修改 `CodeAnalyzer.analyzeSourceCode` 会影响哪些地方？”*

```markdown
### Lens: Refactoring Impact Analysis for `CodeAnalyzer.analyzeSourceCode`
> **Blast Radius**: Modifying 'CodeAnalyzer.analyzeSourceCode' results in 2 direct breaking caller(s), 1 internal cascade(s), and 3 transitive importer(s).

#### 🔴 Tier 0: Direct Breaking Risk (External Callers / Importers)
- **[function]** `runCli` (`bin/dsh-lens.js:20`)

#### 🟡 Tier 1: Internal Cascading Risk (Same-File Functions / Methods)
- **[function]** `CodeAnalyzer.indexDirectory` (`src/analyzer.ts:45`)
```

---

## 🏗 分层架构目录

```
packages/lens/tool-lens/
├── bin/
│   └── dsh-lens.js         # 零配置命令行启动器
├── src/
│   ├── core/
│   │   ├── types.ts        # 领域模型与契约定义
│   │   └── graph.ts        # 核心图存储、Tarjan 环路检测、度量指标与 BFS
│   ├── parsers/
│   │   ├── config-parser.ts# tsconfig 别名与模块解析
│   │   └── ts-parser.ts    # AST 解析、Re-export、OOP 继承与作用域消歧
│   ├── analytics/
│   │   ├── circular.ts     # 循环依赖分析器
│   │   ├── metrics.ts      # 架构耦合度与枢纽分析器
│   │   └── impact.ts       # 重构爆炸半径三级分级评估
│   ├── render/
│   │   ├── markdown.ts     # 紧凑 Markdown 格式化与 Token 裁剪
│   │   ├── mermaid.ts      # Mermaid 拓扑图生成器
│   │   └── presenter.ts    # DSH Web UI 卡片展示
│   ├── analyzer.ts         # CodeAnalyzer 统一门面 (Facade)
│   ├── graph.ts            # 兼容性导出
│   ├── render.ts           # 兼容性导出
│   ├── types.ts            # 兼容性导出
│   ├── index.ts            # Cordis 插件入口与 defineTool 注册
│   └── invariant.ts        # Invariant 伴生插件
├── tests/
│   └── lens.spec.ts        # 完整的 Vitest 单元测试集
├── package.json
└── tsdown.config.ts
```

---

## 📄 开源协议

MIT License © 2026 Trench / DeepSeek Lens Contributors.
