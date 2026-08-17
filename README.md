# DeepSeek Lens (`@trench-xinxin/dsh-tool-lens`)

<p align="left">
  <b>English</b> | <a href="./README.zh.md">简体中文</a>
</p>

[![npm version](https://img.shields.io/npm/v/@trench-xinxin/dsh-tool-lens.svg)](https://www.npmjs.com/package/@trench-xinxin/dsh-tool-lens)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek-Harness%20Plugin-0066FF.svg)](https://github.com/deepseek-ai/deepseek-harness)

**DeepSeek Lens** is a high-performance, deterministic AST code graph and topological analysis plugin built for the **DeepSeek Harness** agent ecosystem.

It provides autonomous AI agents with structural codebase vision — enabling instant dependency mapping, function/method call hierarchy tracing, and refactoring blast-radius impact analysis across JavaScript and TypeScript projects.

---

## ⚡ Zero-Config Instant Launch

You can launch DeepSeek Harness with Lens pre-loaded **with zero configuration** directly via `npx`:

```bash
# 🚀 Instant zero-config launch (Web UI)
npx @trench-xinxin/dsh-tool-lens

# Or run one-shot tasks
npx @trench-xinxin/dsh-tool-lens "Use the lens tool to inspect the dependencies of src/index.ts"
```

No YAML files, no manual configuration required!

---

## 🌟 Key Capabilities

1. **📦 File & Module Dependencies (`dependencies`)**
   - Resolves direct and transitive ES module and CommonJS `import` / `export` paths.
   - Maps module relationships across monorepos and local packages.

2. **📞 Call Graph Hierarchies (`call_graph`)**
   - Analyzes function declarations, arrow functions, and class member methods.
   - Traces **inbound callers** (who calls this function), **outbound callees** (what does this function call), or bidirectional hierarchies.
   - Seamlessly links cross-file instance method calls (e.g. `analyzer.analyzeSourceCode()`).

3. **💥 Refactoring Blast Radius (`impact`)**
   - Evaluates the upstream impact of modifying or deleting a symbol or file.
   - Identifies all files and symbols that depend on the target.

4. **🔍 Smart Fuzzy & Suffix Matching**
   - Automatically resolves short method names (e.g. `analyzeSourceCode` resolves to `CodeAnalyzer.analyzeSourceCode`).
   - Resolves relative subpaths (e.g. `src/index.ts` matches `packages/lens/tool-lens/src/index.ts`).

5. **🎨 DeepSeek Harness Native Presentation**
   - Automatically registers with `ctx.tools` and injects guidance into `ctx.systemPrompt`.
   - Generates clean, concise Markdown for LLM reasoning and structured cards for the Web UI trajectory inspector.

---

## 🚀 Advanced Setup (Manual / Cordis YAML)

If you are embedding Lens into custom Cordis profiles:

### 1. Installation

```bash
pnpm add @trench-xinxin/dsh-tool-lens
# or with npm / yarn
npm install @trench-xinxin/dsh-tool-lens
```

### 2. Configuration (`cordis.yml`)

Mount the plugin in your Cordis profile or as a runtime overlay patch:

```yaml
- insert:
    - id: tool-lens
      name: '@trench-xinxin/dsh-tool-lens'
      config:
        maxDepth: 3
```

---

## 📖 Tool Parameter Reference

The model interacts with Lens via the `lens` tool schema:

| Parameter | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `action` | `enum` | **Yes** | — | `'dependencies'` (imports), `'call_graph'` (callers/callees), or `'impact'` (blast radius). |
| `target` | `string` | **Yes** | — | Target symbol name, function/method name, or relative file path. |
| `depth` | `number` | No | `3` | Maximum graph traversal depth (1 to 5). |
| `direction` | `enum` | No | `both` | `'inbound'` (upstream callers), `'outbound'` (downstream callees), or `'both'`. |
| `scope` | `string` | No | `.` | Subdirectory path to restrict scanning. |

---

## 💡 Example Prompt & Model Experience

### Scenario A: Exploring Module Dependencies
**User**: *"Please use the lens tool to analyze the module dependencies of `packages/lens/tool-lens/src/index.ts`"*

**Model Output**:
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

### Scenario B: Impact / Blast Radius Analysis
**User**: *"What is the blast radius if I refactor the `analyzeSourceCode` method?"*

**Model Output**:
```markdown
### Lens: impact for `CodeAnalyzer.analyzeSourceCode`
*Found 5 connected node(s) and 5 relationship(s).*

> **Summary**: Modifying 'CodeAnalyzer.analyzeSourceCode' potentially impacts 3 file(s) and 5 symbol(s).
```

---

## 🛠 Project Structure

```
packages/lens/tool-lens/
├── bin/
│   └── dsh-lens.js   # Zero-config CLI executable
├── src/
│   ├── index.ts      # Cordis plugin entrypoint & defineTool registration
│   ├── analyzer.ts   # TypeScript AST parser & multi-pass symbol/call extractor
│   ├── graph.ts      # In-memory directed graph store with BFS traversal
│   ├── render.ts     # Markdown & UI Presentation card formatters
│   ├── types.ts      # Domain models, node/edge types, and arguments schema
│   └── invariant.ts  # Package invariant companion
├── tests/
│   └── lens.spec.ts  # Comprehensive Vitest test suite
├── package.json
├── LICENSE
├── README.md
└── README.zh.md
```

---

## 📄 License

MIT License © 2026 Trench / DeepSeek Lens Contributors.
