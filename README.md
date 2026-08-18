# DeepSeek Lens (`@trench-xinxin/dsh-tool-lens`)

<p align="left">
  <b>English</b> | <a href="https://github.com/0409wx/dsh-tool-lens/blob/main/README.zh.md">简体中文</a>
</p>

[![npm version](https://img.shields.io/npm/v/@trench-xinxin/dsh-tool-lens.svg)](https://www.npmjs.com/package/@trench-xinxin/dsh-tool-lens)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/0409wx/dsh-tool-lens/blob/main/LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek-Harness%20Plugin-0066FF.svg)](https://github.com/deepseek-ai/deepseek-harness)

**DeepSeek Lens** is a high-performance, deterministic AST code graph and topological analysis tool plugin specifically designed for the **DeepSeek Harness** agent foundation.

It empowers AI Agents with deep codebase topological awareness, enabling instant module dependency exploration, disambiguated symbol call hierarchies, OOP inheritance tracing, circular dependency audits, architectural coupling metrics, and 3-tier refactoring blast-radius analysis.

---

## ⚡ Zero-Config Instant Launcher

Launch DeepSeek Harness pre-loaded with DeepSeek Lens without modifying any YAML configurations:

```bash
# 🚀 Zero-config launch Web UI
npx @trench-xinxin/dsh-tool-lens

# Or execute a one-off prompt
npx @trench-xinxin/dsh-tool-lens "Use lens tool to audit circular dependencies in this workspace"
```

---

## 🌟 Core Features (v0.2.0)

1. **📦 Module & Dependency Topology (`dependencies`)**
   - Precise static analysis of ES and CommonJS `import` / `export` declarations.
   - **Full Re-export Resolution**: Supports `export * from './mod'` and named aliased re-exports.
   - **Path Mapping**: Automatically resolves `tsconfig.json` `compilerOptions.paths` aliases (e.g., `@/*`).

2. **📞 Scope-Disambiguated Call Hierarchies (`call_graph`)**
   - Resolves functions, arrow functions, and class member methods.
   - **4-Tier Scope Awareness**: Prioritizes same-file, explicit imports (`import { fn }`), and namespace imports (`Mod.fn`), completely eliminating false positives from duplicate function names across the workspace.
   - **OOP Heritage Extraction**: Extracts `extends` and `implements` relations for classes and interfaces.

3. **💥 Tiered Refactoring Blast-Radius Analysis (`impact`)**
   - Assesses the downstream and upstream impact of changing or removing symbols.
   - **3-Tier Risk Classification**:
     - 🔴 **Tier 0 Direct Breaking**: External callers and direct importers that will break on signature changes.
     - 🟡 **Tier 1 Internal Cascading**: Functions/methods within the same file/class affected by cascade.
     - 🔵 **Tier 2 Transitive Importers**: Upstream modules transitively importing this file.

4. **🔄 Circular Dependency Auditing (`circular`)**
   - Tarjan SCC and DFS cycle detection algorithm detects closed loops (e.g. `A -> B -> C -> A`).
   - Outputs full cycle loops and involved file lists to avoid runtime initialization deadlocks.

5. **⚡ Sub-20ms Incremental Cache & Live Watch Mode (`incremental & watch`)**
   - High-performance `mtime` and `SHA-256` content hashing skips AST re-parsing for unchanged files.
   - Automatically supports `.dsh/lens-cache.json` disk snapshots.
   - Built-in `LensWatcher` (100ms debounce) for live topological synchronization during code editing.

6. **📊 Architectural Coupling & Health Metrics (`metrics`)**
   - Evaluates **Afferent Coupling ($Ca$)** and **Efferent Coupling ($Ce$)**.
   - Calculates **Instability ($I = Ce / (Ca + Ce)$)** to evaluate module fragility.
   - Identifies **Top Centrality Hubs** to locate God Classes and core architecture anchors.

7. **🎨 Mermaid Visual Topologies & Token Safeguard**
   - Automatically renders interactive Mermaid flowcharts when nodes $\le 25$.
   - Automatically truncates and summarizes large graphs when nodes $> 50$ to avoid LLM context overflow.

---

## 📖 Tool Parameters & Actions

| Parameter | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `action` | `enum` | **Yes** | — | `'dependencies'`, `'call_graph'`, `'impact'`, `'circular'`, or `'metrics'`. |
| `target` | `string` | No | `.` | Target symbol name, method name, or relative file path (optional for `circular` and `metrics`). |
| `depth` | `number` | No | `3` | Graph traversal depth limit (1 to 5). |
| `direction` | `enum` | No | `both` | `'inbound'`, `'outbound'`, or `'both'`. |
| `scope` | `string` | No | `.` | Subdirectory path to restrict scan scope. |

---

## 🏗 Layered Architecture

```
packages/lens/tool-lens/
├── bin/
│   └── dsh-lens.js         # Zero-config CLI launcher
├── src/
│   ├── core/
│   │   ├── types.ts        # Domain types and contracts
│   │   └── graph.ts        # GraphStore, Tarjan cycles, metrics & BFS
│   ├── parsers/
│   │   ├── config-parser.ts# tsconfig path mapping & resolver
│   │   └── ts-parser.ts    # AST parsing, Re-exports, OOP & call resolution
│   ├── analytics/
│   │   ├── circular.ts     # Circular dependency analyzer
│   │   ├── metrics.ts      # Architectural coupling metrics
│   │   └── impact.ts       # 3-tier refactoring blast-radius analysis
│   ├── render/
│   │   ├── markdown.ts     # Compact markdown formatter & token truncation
│   │   ├── mermaid.ts      # Mermaid topology generator
│   │   └── presenter.ts    # DSH Web UI presenters
│   ├── analyzer.ts         # CodeAnalyzer Facade
│   ├── index.ts            # Cordis plugin entry & defineTool
│   └── invariant.ts        # Invariant companion
├── tests/
│   └── lens.spec.ts        # Vitest test suite
├── package.json
└── tsdown.config.ts
```

---

## 📄 License

MIT License © 2026 Trench / DeepSeek Lens Contributors.
