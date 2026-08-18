/**
 * Core domain types and contracts for DeepSeek Lens.
 * @module @trench-xinxin/dsh-tool-lens/core/types
 */

export type CodeNodeKind =
  | 'file'
  | 'component'
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'variable'
  | 'api_endpoint'

export type CodeEdgeRelation = 'imports' | 'calls' | 'contains' | 'implements' | 'extends'

export type CodeGraphAction =
  | 'dependencies'
  | 'call_graph'
  | 'impact'
  | 'circular'
  | 'metrics'
  | 'path'
  | 'unused'
  | 'lint'
  | 'diff_impact'
  | 'slice'
  | 'api_contracts'

export interface CodeGraphNode {
  /** Unique composite identifier: e.g., `src/index.ts` or `src/index.ts#apply:10` */
  id: string
  /** Human-readable symbol name or file path */
  name: string
  /** The kind of code construct */
  kind: CodeNodeKind
  /** Relative file path */
  filePath: string
  /** Starting line number (1-based), if applicable */
  line?: number
  /** Ending line number (1-based), if applicable */
  endLine?: number
  /** Additional metadata (e.g. HTTP method for api endpoints) */
  metadata?: Record<string, any>
}

export interface CodeGraphEdge {
  /** Source node ID */
  from: string
  /** Target node ID */
  to: string
  /** Type of relationship */
  relation: CodeEdgeRelation
}

/** Represents a single detected circular dependency cycle */
export interface CircularCycle {
  /** Sequence of file paths or symbol IDs forming the cycle */
  cycle: string[]
  /** Cycle length */
  length: number
}

/** Diagnostic metrics for an individual module file */
export interface ModuleMetric {
  filePath: string
  /** Afferent coupling (Ca): number of incoming dependencies from other modules */
  afferentCoupling: number
  /** Efferent coupling (Ce): number of outgoing dependencies to other modules */
  efferentCoupling: number
  /** Instability index: I = Ce / (Ca + Ce), ranging from 0.0 (completely stable) to 1.0 (completely unstable) */
  instability: number
}

/** Centrality hub ranking item */
export interface TopHub {
  id: string
  name: string
  kind: CodeNodeKind
  filePath: string
  degree: number
  inboundDegree: number
  outboundDegree: number
}

/** Comprehensive architecture health metrics for the indexed workspace */
export interface ProjectMetrics {
  totalFiles: number
  totalSymbols: number
  totalEdges: number
  modules: ModuleMetric[]
  topHubs: TopHub[]
  averageInstability: number
}

/** Tiered blast-radius impact analysis for refactoring */
export interface ImpactTiers {
  targetNode: CodeGraphNode
  /** Tier 0: Direct external callers/consumers that will break if the API signature changes */
  directBreaking: CodeGraphNode[]
  /** Tier 1: Internal functions/methods within the same file/class affected by cascade */
  internalCascading: CodeGraphNode[]
  /** Tier 2: Upstream files that transitively import this module */
  transitiveImporters: CodeGraphNode[]
}

/** Shortest pathfinding result between two symbols or files */
export interface PathfindingResult {
  fromNode: CodeGraphNode
  toNode: CodeGraphNode
  /** Sequence of node IDs in the shortest traversal chain */
  path: string[]
  /** Array of edges connecting the path nodes */
  edges: CodeGraphEdge[]
  /** Formatted step-by-step human-readable hops */
  hops: string[]
  isFound: boolean
}

/** Dead code / Unreachable symbol analysis result */
export interface DeadCodeResult {
  /** Files not imported or called by any active code */
  orphanFiles: CodeGraphNode[]
  /** Symbols with zero afferent callers or consumers */
  unusedSymbols: CodeGraphNode[]
  totalOrphans: number
  totalUnusedSymbols: number
}

/** Architecture layer boundary rule */
export interface ArchitectureRule {
  /** Glob or regex pattern describing the source layer (e.g., `src/views/**` or `views`) */
  from: string
  /** Glob or regex pattern describing the forbidden target layer (e.g., `src/infra/**` or `db`) */
  to: string
  /** Human-readable explanation of why this dependency is forbidden */
  description?: string
}

/** Detected architecture boundary violation */
export interface ArchitectureViolation {
  fromNode: CodeGraphNode
  toNode: CodeGraphNode
  relation: CodeEdgeRelation
  violatedRule: ArchitectureRule
  reason: string
}

/** Git diff change impact analysis */
export interface GitDiffImpactResult {
  changedFiles: string[]
  changedSymbols: CodeGraphNode[]
  affectedUpstreamFiles: string[]
  affectedTestFiles: string[]
  breakingCallers: CodeGraphNode[]
  totalChangedFiles: number
  totalAffectedFiles: number
}

/** Architecture domain slice result */
export interface ArchitectureSliceResult {
  domainSeed: string
  cohesionScore: number
  slicedNodes: CodeGraphNode[]
  internalEdges: CodeGraphEdge[]
  boundaryOutgoingEdges: CodeGraphEdge[]
}

/** Full-stack cross-language API contract match */
export interface ApiContractMatch {
  urlPattern: string
  httpMethod: string
  clientCallNode: CodeGraphNode
  serverHandlerNode: CodeGraphNode
}

/** Full-stack API contracts audit result */
export interface ApiContractsResult {
  matchedContracts: ApiContractMatch[]
  unmatchedClientCalls: CodeGraphNode[]
  unmatchedServerEndpoints: CodeGraphNode[]
  totalContracts: number
}

export interface CodeGraphResult {
  target: string
  action: CodeGraphAction
  rootNodes: CodeGraphNode[]
  nodes: CodeGraphNode[]
  edges: CodeGraphEdge[]
  summary: string
  circularCycles?: CircularCycle[]
  metrics?: ProjectMetrics
  impactTiers?: ImpactTiers
  pathfinding?: PathfindingResult
  deadCode?: DeadCodeResult
  architectureViolations?: ArchitectureViolation[]
  diffImpact?: GitDiffImpactResult
  sliceResult?: ArchitectureSliceResult
  apiContracts?: ApiContractsResult
}

export interface LensArgs {
  action: CodeGraphAction
  target?: string
  to?: string
  rules?: ArchitectureRule[] | string
  commit?: string
  depth?: number
  direction?: 'inbound' | 'outbound' | 'both'
  scope?: string
}

/** Intermediate serialized data for an indexed file */
export interface FileIndexCache {
  filePath: string
  mtimeMs: number
  hash: string
  nodes: CodeGraphNode[]
  edges: CodeGraphEdge[]
  imports: string[]
  bindings: Record<string, { importedName: string; localName: string; sourcePath: string; isNamespace?: boolean }>
  pendingCalls: { callerId: string; calleeName: string; calleeObject?: string }[]
  pendingHeritages: { sourceId: string; targetName: string; relation: 'extends' | 'implements' }[]
}

/** Snapshot for disk persistence (.dsh/lens-cache.json) */
export interface CacheSnapshot {
  version: string
  timestamp: number
  rootDir: string
  files: Record<string, FileIndexCache>
}

/** Status of a file during incremental delta check */
export type FileDeltaStatus = 'unchanged' | 'modified' | 'added' | 'deleted'

/** Statistics of an incremental indexing run */
export interface IncrementalIndexStats {
  totalFiles: number
  cachedFiles: number
  indexedFiles: number
  deletedFiles: number
  durationMs: number
}

/** Language parser driver contract for multi-ecosystem extensibility */
export interface LanguageDriver {
  readonly name: string
  readonly extensions: readonly string[]
  canHandle(filePath: string): boolean
}
