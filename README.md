# DeepSeek Lens (`@trench-xinxin/dsh-tool-lens`)

<p align="left">
  <b>English</b> | <a href="https://github.com/trench-xinxin/dsh-tool-lens/blob/main/README.zh.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/trench-xinxin/dsh-tool-lens/actions/workflows/ci.yml"><img src="https://github.com/trench-xinxin/dsh-tool-lens/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://npmjs.com/package/@trench-xinxin/dsh-tool-lens"><img src="https://img.shields.io/npm/v/@trench-xinxin/dsh-tool-lens.svg" alt="npm version" /></a>
  <a href="https://npmjs.com/package/@trench-xinxin/dsh-tool-lens"><img src="https://img.shields.io/npm/dm/@trench-xinxin/dsh-tool-lens.svg" alt="npm downloads" /></a>
  [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/trench-xinxin/dsh-tool-lens/blob/main/LICENSE)
</p>[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek-Harness%20Plugin-0066FF.svg)](https://github.com/deepseek-ai/deepseek-harness)

**DeepSeek Lens** is a high-performance, deterministic AST code graph and architectural analysis tool plugin designed for the **DeepSeek Harness** agent foundation.

It empowers AI Agents with deep codebase topological awareness, enabling instant module dependency exploration, disambiguated symbol call hierarchies, OOP inheritance tracing, circular dependency audits, architectural coupling metrics, Git diff change impact audits, domain architecture slicing, and full-stack API contract tracking.

---

## ⚡ Zero-Config All-in-One Launcher (No Extra Setup Required)

> 💡 **Stand-alone Execution**: You **do NOT need to pre-install `@deepseek-ai/dsh`**, nor do you need to start any background Harness services beforehand.  
> Running the command below will automatically download the runtime, handle port allocation, and launch the complete Web UI with Lens pre-loaded:

```bash
# 🚀 Zero-config launch full Web UI (Out of the box)
npx @trench-xinxin/dsh-tool-lens

# Or execute a one-off prompt directly in terminal
npx @trench-xinxin/dsh-tool-lens "Use lens tool to audit circular dependencies in this workspace"
```

Once launched, your browser can access the Web UI at the indicated local address (e.g. `http://127.0.0.1:3080` or `http://127.0.0.1:3081`).

---

## 🌟 Core Features (v2.0)

1. **📦 Module & Dependency Topology (`dependencies`)**
   - Precise static analysis of ES and CommonJS `import` / `export` declarations.
   - **Full Re-export Resolution**: Supports `export * from './mod'` and named aliased re-exports.
   - **Path Mapping**: Automatically resolves `tsconfig.json` `compilerOptions.paths` aliases (e.g., `@/*`).

2. **📞 Scope-Disambiguated Call Hierarchies (`call_graph`)**
   - Resolves functions, arrow functions, and class member methods.
   - **4-Tier Scope Awareness**: Prioritizes same-file, explicit imports (`import { fn }`), and namespace imports (`Mod.fn`), completely eliminating false positives from duplicate function names across the workspace.
   - **OOP Heritage Extraction**: Extracts `extends` and `implements` relations for classes and interfaces.

3. **💥 Tiered Refactoring Blast-Radius Analysis (`impact`)**
   - Assesses downstream and upstream impact of changing or removing symbols.
   - **3-Tier Risk Classification**:
     - 🔴 **Tier 0 Direct Breaking**: External callers and direct importers breaking on signature changes.
     - 🟡 **Tier 1 Internal Cascading**: Functions/methods within the same file/class affected by cascade.
     - 🔵 **Tier 2 Transitive Importers**: Upstream modules transitively importing this file.

4. **🔄 Circular Dependency Auditing (`circular`)**
   - Tarjan SCC and DFS cycle detection algorithm detects closed loops (e.g. `A -> B -> C -> A`).
   - Outputs full cycle loops and involved file lists to avoid runtime initialization deadlocks.

5. **🧭 Shortest Call Path Exploration (`action: path`)**
   - Bidirectional BFS algorithm traces shortest execution paths and intermediate hops between any two symbols.

6. **🧹 Dead Code & Unused Symbol Audit (`action: unused`)**
   - Discovers unreferenced symbols and orphan files with zero afferent callers ($Ca = 0$).

7. **🛡 Architecture Layer Governance (`action: lint`)**
   - Enforces architectural boundary rules (e.g. `views/**` cannot directly import `infra/**`) to prevent layer decay.

8. **📝 Git Diff Impact & Test Recommender (`action: diff_impact`)**
   - Scans uncommitted working tree diffs or commit ranges, traces upstream breaking callers, and **recommends targeted regression test suites**.

9. **🧩 Domain Architecture Subgraph Slicing (`action: slice`)**
   - Extracts compact, high-cohesion domain slices (Ego-Networks) around seed symbols, computing cohesion scores and boundary dependencies.

10. **🌐 Full-Stack Cross-Language API Contracts (`action: api_contracts`)**
    - Automatically links frontend HTTP requests (`fetch`, `axios`, `request`) to backend route controllers (Java Spring, Python FastAPI, Go Gin), forming full-stack end-to-end call graphs.

11. **🌍 Polyglot Ecosystem Drivers (`Java / Python / Go / Rust / TS / SFC`)**
    - **Java (`.java`)**: `package`, Maven/Gradle paths, `class`, `interface`, `extends`, `implements`, and class method invocations.
    - **Python (`.py`)**: `def`, `class` inheritance, `self.method()`, and relative/absolute package imports.
    - **Go (`.go`)**: `package` scopes, `go.mod` module paths, Struct Embedding, and Receiver methods.
    - **Rust (`.rs`)**: `mod` modules, `struct`, `trait`, `impl Trait for Struct`, and method calls.
    - **Vue 3 & Svelte (`.vue`, `.svelte`)**: Full support for `<script setup>` and `<template>` component references.

---

## 📄 License

MIT License © 2026 Trench / DeepSeek Lens Contributors.
