# DeepSeek Lens (`@trench-xinxin/dsh-tool-lens`)

[![npm version](https://img.shields.io/npm/v/@trench-xinxin/dsh-tool-lens.svg)](https://www.npmjs.com/package/@trench-xinxin/dsh-tool-lens)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek-Harness%20Plugin-0066FF.svg)](https://github.com/deepseek-ai/deepseek-harness)

**DeepSeek Lens** 是专为 **DeepSeek Harness** 智能体底座打造的高性能、确定性 AST 代码图谱与拓扑分析工具插件。

它为 AI Agent 赋予深度的代码结构与全局感知能力，支持即时模块依赖分析、函数/类方法调用链追踪以及重构改动影响面（Blast Radius）分析。

---

## ⚡ 零配置一键即用（免改任何文件）

无需编写任何 YAML 配置文件，直接通过 `npx` 一行命令即可启动预载 Lens 图谱能力的 DeepSeek Harness：

```bash
# 🚀 零配置一键启动 Web 界面
npx @trench-xinxin/dsh-tool-lens

# 或直接运行一次性任务
npx @trench-xinxin/dsh-tool-lens "使用 lens 工具分析 src/index.ts 的模块依赖"
```

---

## 🌟 核心特性

1. **📦 模块与文件依赖分析 (`dependencies`)**
   - 精准解析 ES 模块与 CommonJS 的 `import` / `export` 引用。
   - 支持 Monorepo 与本地跨包路径映射。

2. **📞 函数与方法调用链路 (`call_graph`)**
   - 深入解析普通函数、箭头函数以及类成员方法。
   - 支持追踪**上游调用者（Inbound Callers）**、**下游被调用者（Outbound Callees）**或双向调用链。
   - 完美解析跨文件对象实例方法调用（如 `analyzer.analyzeSourceCode()`）。

3. **💥 重构影响面分析 (`impact`)**
   - 评估修改或删除某个符号/文件对整个项目的潜在爆炸半径。
   - 快速列出所有直接与间接依赖该符号的文件与函数。

4. **🔍 智能模糊与短名匹配**
   - 自动解析类成员短名（例如传入 `analyzeSourceCode` 自动匹配 `CodeAnalyzer.analyzeSourceCode`）。
   - 自动解析相对路径后缀（例如传入 `src/index.ts` 自动匹配 `packages/lens/tool-lens/src/index.ts`）。

5. **🎨 DeepSeek Harness 原生适配**
   - 自动注册到 `ctx.tools`，并向 `ctx.systemPrompt` 注入工具指引。
   - 为大模型推理生成紧凑的 Markdown 结构，同时为 Web UI 轨迹面板提供结构化卡片渲染。

---

## 🚀 高级接入方式（手动配置 Cordis YAML）

如果你需要在自己的 Cordis Profile 或工程配置文件中引用：

### 1. 安装

```bash
pnpm add @trench-xinxin/dsh-tool-lens
# 或使用 npm / yarn
npm install @trench-xinxin/dsh-tool-lens
```

### 2. 配置文件 (`cordis.yml`)

```yaml
- insert:
    - id: tool-lens
      name: '@trench-xinxin/dsh-tool-lens'
      config:
        maxDepth: 3
```

---

## 📖 工具参数说明

大模型通过 `lens` 工具与代码图谱交互：

| 参数名 | 类型 | 必填 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `action` | `enum` | **是** | — | `'dependencies'` (模块依赖), `'call_graph'` (函数调用链), 或 `'impact'` (改动影响面)。 |
| `target` | `string` | **是** | — | 待分析的符号名称、方法名或文件相对路径。 |
| `depth` | `number` | 否 | `3` | 最大图谱遍历深度（1 到 5 层）。 |
| `direction` | `enum` | 否 | `both` | `'inbound'` (上游调用/引用), `'outbound'` (下游依赖/调用), 或 `'both'` (双向)。 |
| `scope` | `string` | 否 | `.` | 限制扫描的子目录范围（默认整个工作区）。 |

---

## 💡 使用示例与大模型交互效果

### 场景一：分析模块依赖关系
**用户**：*“请使用 lens 工具分析 `packages/lens/tool-lens/src/index.ts` 的模块依赖关系”*

**输出效果**：
```markdown
### Lens: dependencies for `packages/lens/tool-lens/src/index.ts`
*Found 30 connected node(s) and 41 relationship(s).*

**Root Node(s):**
- **[file]** `packages/lens/tool-lens/src/index.ts`

**Connected Symbols / Files:**
- `packages/lens/tool-lens/src/analyzer.ts`:
  - [class] `CodeAnalyzer` (line 19)
- `packages/lens/tool-lens/src/render.ts`:
  - [function] `formatGraphMarkdown` (line 14)
...
```

### 场景二：重构影响面评估
**用户**：*“如果我修改 analyzeSourceCode 函数，会影响哪些地方？”*

**输出效果**：
```markdown
### Lens: impact for `CodeAnalyzer.analyzeSourceCode`
*Found 5 connected node(s) and 5 relationship(s).*

> **Summary**: Modifying 'CodeAnalyzer.analyzeSourceCode' potentially impacts 3 file(s) and 5 symbol(s).
```

---

## 🛠 目录结构

```
packages/lens/tool-lens/
├── bin/
│   └── dsh-lens.js   # 零配置命令行启动器
├── src/
│   ├── index.ts      # Cordis 插件入口与 defineTool 注册
│   ├── analyzer.ts   # TypeScript AST 解析与跨文件多阶段符号/调用提取
│   ├── graph.ts      # 内存有向图存储与 BFS 深度遍历算法
│   ├── render.ts     # Markdown 输出与 UI 卡片纯函数 Presenter
│   ├── types.ts      # 核心数据模型与参数类型定义
│   └── invariant.ts  # Invariant 伴生插件
├── tests/
│   └── lens.spec.ts  # 完整的 Vitest 单元测试集
├── package.json
├── LICENSE
├── README.md
└── README.zh.md
```

---

## 📄 开源协议

MIT License © 2026 Trench / DeepSeek Lens Contributors.
