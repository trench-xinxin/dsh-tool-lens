import Schema from "@deepseek-ai/schemastery";
import { ToolCallView, ToolResultView } from "@deepseek-ai/dsh-tools";
import { Context } from "@deepseek-ai/cordis";
//#region src/core/types.d.ts
/**
 * Core domain types and contracts for DeepSeek Lens.
 * @module @trench-xinxin/dsh-tool-lens/core/types
 */
type CodeNodeKind = 'file' | 'component' | 'function' | 'class' | 'interface' | 'type' | 'variable' | 'api_endpoint';
type CodeEdgeRelation = 'imports' | 'calls' | 'contains' | 'implements' | 'extends';
type CodeGraphAction = 'dependencies' | 'call_graph' | 'impact' | 'circular' | 'metrics' | 'path' | 'unused' | 'lint' | 'diff_impact' | 'slice' | 'api_contracts';
interface CodeGraphNode {
  /** Unique composite identifier: e.g., `src/index.ts` or `src/index.ts#apply:10` */
  id: string;
  /** Human-readable symbol name or file path */
  name: string;
  /** The kind of code construct */
  kind: CodeNodeKind;
  /** Relative file path */
  filePath: string;
  /** Starting line number (1-based), if applicable */
  line?: number;
  /** Ending line number (1-based), if applicable */
  endLine?: number;
  /** Additional metadata (e.g. HTTP method for api endpoints) */
  metadata?: Record<string, any>;
}
interface CodeGraphEdge {
  /** Source node ID */
  from: string;
  /** Target node ID */
  to: string;
  /** Type of relationship */
  relation: CodeEdgeRelation;
}
/** Represents a single detected circular dependency cycle */
interface CircularCycle {
  /** Sequence of file paths or symbol IDs forming the cycle */
  cycle: string[];
  /** Cycle length */
  length: number;
}
/** Diagnostic metrics for an individual module file */
interface ModuleMetric {
  filePath: string;
  /** Afferent coupling (Ca): number of incoming dependencies from other modules */
  afferentCoupling: number;
  /** Efferent coupling (Ce): number of outgoing dependencies to other modules */
  efferentCoupling: number;
  /** Instability index: I = Ce / (Ca + Ce), ranging from 0.0 (completely stable) to 1.0 (completely unstable) */
  instability: number;
}
/** Centrality hub ranking item */
interface TopHub {
  id: string;
  name: string;
  kind: CodeNodeKind;
  filePath: string;
  degree: number;
  inboundDegree: number;
  outboundDegree: number;
}
/** Comprehensive architecture health metrics for the indexed workspace */
interface ProjectMetrics {
  totalFiles: number;
  totalSymbols: number;
  totalEdges: number;
  modules: ModuleMetric[];
  topHubs: TopHub[];
  averageInstability: number;
}
/** Tiered blast-radius impact analysis for refactoring */
interface ImpactTiers {
  targetNode: CodeGraphNode;
  /** Tier 0: Direct external callers/consumers that will break if the API signature changes */
  directBreaking: CodeGraphNode[];
  /** Tier 1: Internal functions/methods within the same file/class affected by cascade */
  internalCascading: CodeGraphNode[];
  /** Tier 2: Upstream files that transitively import this module */
  transitiveImporters: CodeGraphNode[];
}
/** Shortest pathfinding result between two symbols or files */
interface PathfindingResult {
  fromNode: CodeGraphNode;
  toNode: CodeGraphNode;
  /** Sequence of node IDs in the shortest traversal chain */
  path: string[];
  /** Array of edges connecting the path nodes */
  edges: CodeGraphEdge[];
  /** Formatted step-by-step human-readable hops */
  hops: string[];
  isFound: boolean;
}
/** Dead code / Unreachable symbol analysis result */
interface DeadCodeResult {
  /** Files not imported or called by any active code */
  orphanFiles: CodeGraphNode[];
  /** Symbols with zero afferent callers or consumers */
  unusedSymbols: CodeGraphNode[];
  totalOrphans: number;
  totalUnusedSymbols: number;
}
/** Architecture layer boundary rule */
interface ArchitectureRule {
  /** Glob or regex pattern describing the source layer (e.g., `src/views/**` or `views`) */
  from: string;
  /** Glob or regex pattern describing the forbidden target layer (e.g., `src/infra/**` or `db`) */
  to: string;
  /** Human-readable explanation of why this dependency is forbidden */
  description?: string;
}
/** Detected architecture boundary violation */
interface ArchitectureViolation {
  fromNode: CodeGraphNode;
  toNode: CodeGraphNode;
  relation: CodeEdgeRelation;
  violatedRule: ArchitectureRule;
  reason: string;
}
/** Git diff change impact analysis */
interface GitDiffImpactResult {
  changedFiles: string[];
  changedSymbols: CodeGraphNode[];
  affectedUpstreamFiles: string[];
  affectedTestFiles: string[];
  breakingCallers: CodeGraphNode[];
  totalChangedFiles: number;
  totalAffectedFiles: number;
}
/** Architecture domain slice result */
interface ArchitectureSliceResult {
  domainSeed: string;
  cohesionScore: number;
  slicedNodes: CodeGraphNode[];
  internalEdges: CodeGraphEdge[];
  boundaryOutgoingEdges: CodeGraphEdge[];
}
/** Full-stack cross-language API contract match */
interface ApiContractMatch {
  urlPattern: string;
  httpMethod: string;
  clientCallNode: CodeGraphNode;
  serverHandlerNode: CodeGraphNode;
}
/** Full-stack API contracts audit result */
interface ApiContractsResult {
  matchedContracts: ApiContractMatch[];
  unmatchedClientCalls: CodeGraphNode[];
  unmatchedServerEndpoints: CodeGraphNode[];
  totalContracts: number;
}
interface CodeGraphResult {
  target: string;
  action: CodeGraphAction;
  rootNodes: CodeGraphNode[];
  nodes: CodeGraphNode[];
  edges: CodeGraphEdge[];
  summary: string;
  circularCycles?: CircularCycle[];
  metrics?: ProjectMetrics;
  impactTiers?: ImpactTiers;
  pathfinding?: PathfindingResult;
  deadCode?: DeadCodeResult;
  architectureViolations?: ArchitectureViolation[];
  diffImpact?: GitDiffImpactResult;
  sliceResult?: ArchitectureSliceResult;
  apiContracts?: ApiContractsResult;
}
interface LensArgs {
  action: CodeGraphAction;
  target?: string;
  to?: string;
  rules?: ArchitectureRule[] | string;
  commit?: string;
  depth?: number;
  direction?: 'inbound' | 'outbound' | 'both';
  scope?: string;
}
/** Intermediate serialized data for an indexed file */
interface FileIndexCache {
  filePath: string;
  mtimeMs: number;
  hash: string;
  nodes: CodeGraphNode[];
  edges: CodeGraphEdge[];
  imports: string[];
  bindings: Record<string, {
    importedName: string;
    localName: string;
    sourcePath: string;
    isNamespace?: boolean;
  }>;
  pendingCalls: {
    callerId: string;
    calleeName: string;
    calleeObject?: string;
  }[];
  pendingHeritages: {
    sourceId: string;
    targetName: string;
    relation: 'extends' | 'implements';
  }[];
}
/** Snapshot for disk persistence (.dsh/lens-cache.json) */
interface CacheSnapshot {
  version: string;
  timestamp: number;
  rootDir: string;
  files: Record<string, FileIndexCache>;
}
/** Status of a file during incremental delta check */
type FileDeltaStatus = 'unchanged' | 'modified' | 'added' | 'deleted';
/** Statistics of an incremental indexing run */
interface IncrementalIndexStats {
  totalFiles: number;
  cachedFiles: number;
  indexedFiles: number;
  deletedFiles: number;
  durationMs: number;
}
/** Language parser driver contract for multi-ecosystem extensibility */
interface LanguageDriver {
  readonly name: string;
  readonly extensions: readonly string[];
  canHandle(filePath: string): boolean;
}
//#endregion
//#region src/core/graph.d.ts
/**
 * An in-memory directed graph with bidirectional adjacency indexes
 * supporting fast depth-bounded exploration, cycle detection, and architecture metrics.
 */
declare class GraphStore {
  private readonly nodes;
  private readonly outbound;
  private readonly inbound;
  /** Add or update a node in the graph. */
  addNode(node: CodeGraphNode): void;
  /** Add a directed edge from source to target. */
  addEdge(edge: CodeGraphEdge): void;
  /** Batch add nodes and edges to graph. */
  bulkAdd(nodes: CodeGraphNode[], edges: CodeGraphEdge[]): void;
  /**
   * Safely removes all nodes and edges belonging to a file path.
   * Cleans up both outbound and inbound edges from connecting external nodes.
   */
  removeFile(filePath: string): void;
  /** Retrieve a node by its unique ID. */
  getNode(id: string): CodeGraphNode | undefined;
  /** Retrieve all nodes. */
  getAllNodes(): CodeGraphNode[];
  /** Retrieve all edges. */
  getAllEdges(): CodeGraphEdge[];
  /** Get outbound edges for a node. */
  getOutboundEdges(nodeId: string): CodeGraphEdge[];
  /** Get inbound edges for a node. */
  getInboundEdges(nodeId: string): CodeGraphEdge[];
  /** Find all nodes whose name, filePath, or ID match the query string. */
  findNodes(query: string): CodeGraphNode[];
  /**
   * Breadth-first traversal up to maxDepth starting from the specified root IDs.
   * @param rootIds - The starting node IDs.
   * @param direction - 'inbound' (upstream callers/importers), 'outbound' (downstream callees/dependencies), or 'both'.
   * @param maxDepth - Maximum edge traversal depth.
   */
  traverse(rootIds: string[], direction?: 'inbound' | 'outbound' | 'both', maxDepth?: number): {
    nodes: CodeGraphNode[];
    edges: CodeGraphEdge[];
  };
  /**
   * Detects all circular dependency cycles (e.g., file imports A -> B -> C -> A).
   * Uses DFS cycle detection with canonical cycle normalization to avoid duplicates.
   */
  findCircularDependencies(options?: {
    edgeRelation?: CodeEdgeRelation;
    scopePrefix?: string;
  }): CircularCycle[];
  /**
   * Computes architecture coupling metrics (Ca, Ce, Instability) and Top Hubs.
   */
  calculateMetrics(): ProjectMetrics;
  /**
   * Analyzes refactoring blast-radius impact for a specific node with 3 tiers.
   */
  analyzeImpactTiers(targetId: string): ImpactTiers | undefined;
  /** Total number of nodes in the graph. */
  get size(): number;
  /** Clear all graph data. */
  clear(): void;
}
//#endregion
//#region src/core/cache.d.ts
declare class IncrementalCacheStore {
  private readonly cache;
  /** Get cached index for a relative file path. */
  get(relPath: string): FileIndexCache | undefined;
  /** Set or update cached index for a file. */
  set(relPath: string, fileCache: FileIndexCache): void;
  /** Check if a file is in cache. */
  has(relPath: string): boolean;
  /** Delete a file from cache. */
  delete(relPath: string): boolean;
  /** Clear all cached file data. */
  clear(): void;
  /** Total number of cached files. */
  get size(): number;
  /** List of all relative file paths currently cached. */
  getAllFiles(): string[];
  /**
   * Fast SHA-256 content hashing.
   */
  computeHash(content: string): string;
  /**
   * Determines if a file has changed by inspecting mtime and fallback content hash.
   * @param relPath - Relative path from rootDir
   * @param rootDir - Workspace root directory
   */
  checkFileStatus(relPath: string, rootDir: string): {
    status: FileDeltaStatus;
    mtimeMs: number;
    hash?: string;
    content?: string;
  };
  /**
   * Serializes current cache to disk JSON snapshot.
   * @param snapshotPath - File path (e.g. `<workspace>/.dsh/lens-cache.json`)
   * @param rootDir - Workspace root directory
   */
  saveToFile(snapshotPath: string, rootDir: string): boolean;
  /**
   * Loads cache snapshot from disk JSON file.
   * @param snapshotPath - File path to load
   */
  loadFromFile(snapshotPath: string): boolean;
}
//#endregion
//#region src/parsers/config-parser.d.ts
/**
 * tsconfig.json, pyproject.toml, go.mod, and Cargo.toml path mapping & module resolver.
 * @module @trench-xinxin/dsh-tool-lens/parsers/config-parser
 */
declare const SUPPORTED_EXTENSIONS: string[];
interface PathMappingRule {
  pattern: RegExp;
  prefix: string;
  targets: string[];
}
declare class ConfigParser {
  private readonly rootDir;
  private readonly baseUrl;
  private readonly pathRules;
  private goModuleName?;
  private rustCrateName?;
  constructor(rootDir: string);
  private loadTsConfig;
  private loadGoMod;
  private loadCargoToml;
  getGoModuleName(): string | undefined;
  getRustCrateName(): string | undefined;
  resolveAlias(specifier: string): string[];
}
/**
 * Resolves a module specifier to a relative file path in the workspace.
 * Supports TypeScript, Vue, Svelte, Python, Go, and Rust.
 */
declare function resolveModulePath(currentRelPath: string, moduleSpecifier: string, rootDir: string, configParser?: ConfigParser, knownFiles?: Iterable<string>): string | null;
//#endregion
//#region src/parsers/sfc-parser.d.ts
/**
 * Lightweight SFC (Single File Component) extractor for Vue 3 and Svelte.
 * Extracts `<script setup>` / `<script>` blocks and template component references without heavy external compilers.
 * @module @trench-xinxin/dsh-tool-lens/parsers/sfc-parser
 */
interface SFCExtractionResult {
  /** Combined JavaScript / TypeScript code extracted from `<script>` blocks */
  scriptContent: string;
  /** Script language: 'ts' | 'js' */
  lang: 'ts' | 'js';
  /** Component names referenced in `<template>` tags (e.g., ['ChildButton', 'UserAvatar']) */
  templateComponents: string[];
  /** Total line count of the SFC */
  totalLines: number;
}
/**
 * Converts a kebab-case tag name to PascalCase.
 * e.g., "my-button" -> "MyButton"
 */
declare function kebabToPascal(str: string): string;
/**
 * Parses a Vue SFC (.vue) or Svelte component (.svelte) content.
 */
declare function extractSFCBlocks(content: string, filePath: string): SFCExtractionResult;
//#endregion
//#region src/parsers/python-parser.d.ts
interface ParsedSymbolDef {
  name: string;
  kind: CodeNodeKind;
  line: number;
  endLine: number;
  parentName?: string;
}
interface ParsedHeritageDef {
  sourceName: string;
  targetName: string;
  relation: 'extends' | 'implements';
}
interface ParsedImportDef {
  specifier: string;
  importedName: string;
  localName: string;
  isNamespace?: boolean;
}
interface ParsedCallDef {
  callerName: string;
  calleeName: string;
  calleeObject?: string;
}
interface ParsedSourceResult {
  symbols: ParsedSymbolDef[];
  imports: ParsedImportDef[];
  heritages: ParsedHeritageDef[];
  calls: ParsedCallDef[];
}
/**
 * Parses Python source code into symbols, imports, heritages, and calls.
 */
declare function parsePythonSource(content: string, _relPath: string): ParsedSourceResult;
//#endregion
//#region src/parsers/go-parser.d.ts
/**
 * Parses Go source code into symbols, imports, heritages, and calls.
 */
declare function parseGoSource(content: string, _relPath: string): ParsedSourceResult;
//#endregion
//#region src/parsers/rust-parser.d.ts
/**
 * Parses Rust source code into symbols, imports, heritages, and calls.
 */
declare function parseRustSource(content: string, _relPath: string): ParsedSourceResult;
//#endregion
//#region src/parsers/java-parser.d.ts
/**
 * Parses Java source code into symbols, imports, heritages, and calls.
 */
declare function parseJavaSource(content: string, _relPath: string): ParsedSourceResult;
//#endregion
//#region src/parsers/driver.d.ts
declare class TSLanguageDriver implements LanguageDriver {
  readonly name = "typescript";
  readonly extensions: readonly [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
  canHandle(filePath: string): boolean;
}
declare class SFCLanguageDriver implements LanguageDriver {
  readonly name = "sfc";
  readonly extensions: readonly [".vue", ".svelte"];
  canHandle(filePath: string): boolean;
}
declare class PythonLanguageDriver implements LanguageDriver {
  readonly name = "python";
  readonly extensions: readonly [".py"];
  canHandle(filePath: string): boolean;
}
declare class GoLanguageDriver implements LanguageDriver {
  readonly name = "go";
  readonly extensions: readonly [".go"];
  canHandle(filePath: string): boolean;
}
declare class RustLanguageDriver implements LanguageDriver {
  readonly name = "rust";
  readonly extensions: readonly [".rs"];
  canHandle(filePath: string): boolean;
}
declare class JavaLanguageDriver implements LanguageDriver {
  readonly name = "java";
  readonly extensions: readonly [".java"];
  canHandle(filePath: string): boolean;
}
declare class DriverRegistry {
  private readonly drivers;
  constructor();
  register(driver: LanguageDriver): void;
  getDriverForFile(filePath: string): LanguageDriver | undefined;
  isSupported(filePath: string): boolean;
}
//#endregion
//#region src/parsers/ts-parser.d.ts
/**
 * Parses files in a workspace into an AST and populates a GraphStore
 * across TypeScript, JavaScript, Vue SFC, Svelte, Python, Go, and Rust codebases.
 */
declare class TSParser {
  private readonly graph;
  private configParser?;
  private readonly cacheStore;
  private readonly driverRegistry;
  private readonly fileSymbols;
  private readonly fileImports;
  private readonly fileBindings;
  private readonly pendingCalls;
  private readonly pendingHeritages;
  constructor(graph?: GraphStore, cacheStore?: IncrementalCacheStore);
  /** Get the underlying GraphStore. */
  getGraph(): GraphStore;
  /** Get the underlying IncrementalCacheStore. */
  getCacheStore(): IncrementalCacheStore;
  /** Get the DriverRegistry. */
  getDriverRegistry(): DriverRegistry;
  /**
   * Recursively scans and analyzes all source files under the root directory with incremental caching.
   * @param rootDir - Root directory to index.
   * @param signal - Optional abort signal to cancel long scans.
   */
  indexDirectory(rootDir: string, signal?: AbortSignal): Promise<GraphStore>;
  /**
   * High-performance incremental directory indexing.
   * Reuses AST results for unchanged files and only parses modified/added files.
   */
  indexDirectoryIncremental(rootDir: string, signal?: AbortSignal): Promise<IncrementalIndexStats>;
  /**
   * Invalidates a single file and reloads it incrementally into the graph.
   */
  invalidateAndReloadFile(relPath: string, rootDir: string): void;
  /**
   * Analyzes single file content and registers symbols and relations into the graph.
   * Supports TypeScript, JavaScript, Vue SFC, Svelte, Python, Go, and Rust.
   */
  analyzeSourceCode(relPath: string, content: string, rootDir: string, autoLink?: boolean): void;
  /**
   * Common handler for non-TypeScript ecosystem languages (Python, Go, Rust).
   */
  private analyzeGenericParsedResult;
  /**
   * Dedicated TypeScript, JavaScript, Vue SFC, and Svelte AST analysis.
   */
  private analyzeTsAndSfcSourceCode;
  /** Restores memory state and GraphStore from a cached file entry. */
  private restoreFromCache;
  private removeFileFromMemoryIndex;
  /** Resolves all pending function and method calls across files using 4-tier scope awareness. */
  private linkAllCalls;
  /** Resolves all pending extends and implements OOP relationships. */
  private linkAllHeritages;
  private createSymbolNode;
  private extractCallsInSymbol;
  private collectSourceFiles;
}
//#endregion
//#region src/parsers/watcher.d.ts
/**
 * Workspace file change watcher with debounce and directory filter.
 * Automatically synchronizes AST graph state during active development.
 * @module @trench-xinxin/dsh-tool-lens/parsers/watcher
 */
interface WatcherOptions {
  debounceMs?: number;
  onFilesChanged: (changedRelPaths: string[]) => void | Promise<void>;
}
declare class LensWatcher {
  private readonly rootDir;
  private watcher;
  private readonly pendingChanges;
  private debounceTimer;
  private readonly debounceMs;
  private readonly onFilesChanged;
  private isClosed;
  constructor(rootDir: string, options: WatcherOptions);
  /** Starts watching the root directory recursively. */
  start(): boolean;
  /** Closes the active watcher. */
  close(): void;
  private scheduleFlush;
}
//#endregion
//#region src/analytics/circular.d.ts
interface CircularAnalysisResult {
  cycles: CircularCycle[];
  totalCycles: number;
  impactedFiles: string[];
}
/**
 * Runs circular dependency analysis on the provided GraphStore.
 * @param graph - Populated graph store
 * @param scope - Optional scope directory filter
 */
declare function analyzeCircularDependencies(graph: GraphStore, scope?: string): CircularAnalysisResult;
/**
 * Encapsulates circular analysis into a standard CodeGraphResult.
 */
declare function buildCircularResult(graph: GraphStore, target: string, scope?: string): CodeGraphResult;
//#endregion
//#region src/analytics/metrics.d.ts
/**
 * Computes architectural metrics across all indexed modules and symbols.
 * @param graph - Populated graph store
 */
declare function analyzeProjectMetrics(graph: GraphStore): ProjectMetrics;
/**
 * Encapsulates architecture metrics into a standard CodeGraphResult.
 */
declare function buildMetricsResult(graph: GraphStore, target?: string): CodeGraphResult;
//#endregion
//#region src/analytics/impact.d.ts
interface ImpactAnalysisResult {
  rootNodes: CodeGraphNode[];
  traversalNodes: CodeGraphNode[];
  impactTiers?: ImpactTiers;
  summary: string;
}
/**
 * Evaluates the blast radius of modifying a target symbol or file.
 * @param graph - Populated graph store
 * @param target - Target symbol or file query
 * @param depth - Traversal depth (default: 3)
 */
declare function analyzeImpact(graph: GraphStore, target: string, depth?: number): ImpactAnalysisResult;
//#endregion
//#region src/analytics/pathfinding.d.ts
/**
 * Explores and computes the shortest invocation path from source node to target node.
 */
declare function buildPathfindingResult(graph: GraphStore, fromQuery: string, toQuery: string, maxHops?: number): CodeGraphResult;
//#endregion
//#region src/analytics/deadcode.d.ts
/**
 * Audits the codebase for orphan files and unreachable exported symbols.
 */
declare function buildUnusedResult(graph: GraphStore, scope?: string): CodeGraphResult;
//#endregion
//#region src/analytics/architecture.d.ts
/**
 * Checks all graph edges against architectural boundary and layer rules.
 */
declare function buildLintResult(graph: GraphStore, rawRules?: ArchitectureRule[] | string): CodeGraphResult;
//#endregion
//#region src/analytics/git-diff.d.ts
/**
 * Extracts changed files and symbols from git diff and calculates upstream impact.
 */
declare function analyzeGitDiffImpact(graph: GraphStore, workspaceRoot: string, commit?: string, rawChangedFiles?: string[]): CodeGraphResult;
//#endregion
//#region src/analytics/slicing.d.ts
/**
 * Finds domain seed nodes by exact match or fuzzy path/name inclusion.
 */
declare function findDomainSeedNodes(graph: GraphStore, domainQuery: string): CodeGraphNode[];
/**
 * Extracts a high-cohesion architectural domain slice around seed query nodes.
 */
declare function buildSliceResult(graph: GraphStore, domainQuery: string, maxHops?: number): CodeGraphResult;
//#endregion
//#region src/analytics/api-contracts.d.ts
interface ExtractedClientApiCall {
  filePath: string;
  url: string;
  method: string;
  callerSymbolName?: string;
  line: number;
}
interface ExtractedServerEndpoint {
  filePath: string;
  url: string;
  method: string;
  handlerSymbolName: string;
  line: number;
}
/**
 * Normalizes an API path for fuzzy matching (e.g. `/api/v1/users/{id}` vs `/api/v1/users/:id` -> `/api/v1/users/*`).
 */
declare function normalizeApiPath(path: string): string;
/**
 * Scans files in the indexed workspace to match frontend client calls to backend server handlers.
 */
declare function buildApiContractsResult(graph: GraphStore, workspaceRootOrFiles?: string | Map<string, string>, explicitFileSources?: Map<string, string>): CodeGraphResult;
//#endregion
//#region src/render/mermaid.d.ts
/**
 * Generates a Mermaid flowchart string from graph nodes and edges.
 * @param nodes - Nodes to render in diagram
 * @param edges - Edges connecting nodes
 * @param maxNodes - Max nodes to render before skipping diagram (default: 25)
 */
declare function generateMermaidDiagram(nodes: CodeGraphNode[], edges: CodeGraphEdge[], maxNodes?: number): string | null;
//#endregion
//#region src/render/markdown.d.ts
/**
 * Formats a CodeGraphResult into structured, compact markdown for the model response.
 * @param result - The graph query result.
 * @returns Human and model-readable markdown summary.
 */
declare function formatGraphMarkdown(result: CodeGraphResult): string;
//#endregion
//#region src/render/presenter.d.ts
/**
 * Pure presenter for the tool-call pending card.
 * @param args - Tool invocation arguments.
 */
declare function presentLensCall(args: LensArgs): ToolCallView;
/**
 * Pure presenter for the completed tool result card.
 * @param args - Tool invocation arguments.
 * @param executionResult - Result envelope containing content and error state.
 */
declare function presentLensResult(args: LensArgs, executionResult: {
  content: readonly {
    type: string;
    text?: string;
  }[];
  isError: boolean;
}): ToolResultView;
//#endregion
//#region src/analyzer.d.ts
/**
 * Facade providing high-level directory indexing, single-file AST parsing,
 * incremental caching, and workspace watching.
 */
declare class CodeAnalyzer {
  private readonly parser;
  private watcher;
  constructor(graph?: GraphStore, cacheStore?: IncrementalCacheStore);
  /** Get the underlying GraphStore. */
  getGraph(): GraphStore;
  /** Get the underlying IncrementalCacheStore. */
  getCacheStore(): IncrementalCacheStore;
  /**
   * Recursively scans and analyzes all source files under the root directory.
   * Leverages incremental cache by default for sub-20ms warm queries.
   * @param rootDir - Root directory to index.
   * @param signal - Optional abort signal to cancel long scans.
   * @param options - Optional flags (e.g., forceReindex to bypass cache).
   */
  indexDirectory(rootDir: string, signal?: AbortSignal, options?: {
    forceReindex?: boolean;
  }): Promise<GraphStore>;
  /**
   * Runs incremental directory indexing and returns execution statistics.
   */
  indexDirectoryIncremental(rootDir: string, signal?: AbortSignal): Promise<IncrementalIndexStats>;
  /**
   * Analyzes single file content and registers symbols and relations into the graph.
   * @param relPath - Relative path of the file from workspace root.
   * @param content - File text content.
   * @param rootDir - Workspace root directory.
   * @param autoLink - Whether to resolve calls and heritages immediately.
   */
  analyzeSourceCode(relPath: string, content: string, rootDir: string, autoLink?: boolean): void;
  /**
   * Hot-reloads a single file incrementally upon modification.
   */
  invalidateAndReloadFile(relPath: string, rootDir: string): void;
  /**
   * Creates and starts a filesystem watcher to keep the AST graph synchronized in real-time.
   */
  createWatcher(rootDir: string, debounceMs?: number): LensWatcher;
  /** Closes any active workspace watcher. */
  closeWatcher(): void;
}
//#endregion
//#region src/index.d.ts
/** Cordis plugin name for diagnostics and composition. */
declare const name = "tool-lens";
/** Services required by this plugin. */
declare const inject: string[];
/** System prompt guidance describing the purpose and usage of the tool. */
declare const LENS_PROMPT_TEXT: string;
/** Plugin configuration schema. */
interface Config {
  /** Maximum default graph traversal depth (default: 3). */
  maxDepth?: number;
  /** Enable incremental caching for sub-20ms warm queries (default: true). */
  cache?: boolean;
  /** Automatically watch workspace files for live graph updates (default: false). */
  watch?: boolean;
}
declare const Config: Schema<Config>;
/**
 * Register the `lens` tool and its system-prompt guidance.
 * @param ctx - Cordis Context with injected services.
 * @param config - Plugin configuration.
 */
declare function apply(ctx: Context, config?: Config): void;
//#endregion
export { ApiContractMatch, ApiContractsResult, ArchitectureRule, ArchitectureSliceResult, ArchitectureViolation, CacheSnapshot, CircularAnalysisResult, CircularCycle, CodeAnalyzer, CodeEdgeRelation, CodeGraphAction, CodeGraphEdge, CodeGraphNode, CodeGraphResult, CodeNodeKind, Config, ConfigParser, DeadCodeResult, DriverRegistry, ExtractedClientApiCall, ExtractedServerEndpoint, FileDeltaStatus, FileIndexCache, GitDiffImpactResult, GoLanguageDriver, GraphStore, ImpactAnalysisResult, ImpactTiers, IncrementalCacheStore, IncrementalIndexStats, JavaLanguageDriver, LENS_PROMPT_TEXT, LanguageDriver, LensArgs, LensWatcher, ModuleMetric, ParsedCallDef, ParsedHeritageDef, ParsedImportDef, ParsedSourceResult, ParsedSymbolDef, PathMappingRule, PathfindingResult, ProjectMetrics, PythonLanguageDriver, RustLanguageDriver, SFCExtractionResult, SFCLanguageDriver, SUPPORTED_EXTENSIONS, TSLanguageDriver, TSParser, TopHub, WatcherOptions, analyzeCircularDependencies, analyzeGitDiffImpact, analyzeImpact, analyzeProjectMetrics, apply, buildApiContractsResult, buildCircularResult, buildLintResult, buildMetricsResult, buildPathfindingResult, buildSliceResult, buildUnusedResult, extractSFCBlocks, findDomainSeedNodes, formatGraphMarkdown, generateMermaidDiagram, inject, kebabToPascal, name, normalizeApiPath, parseGoSource, parseJavaSource, parsePythonSource, parseRustSource, presentLensCall, presentLensResult, resolveModulePath };