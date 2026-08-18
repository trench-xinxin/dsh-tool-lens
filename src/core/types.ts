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

export type CodeEdgeRelation = 'imports' | 'calls' | 'contains' | 'implements' | 'extends'

export type CodeGraphAction = 'dependencies' | 'call_graph' | 'impact' | 'circular' | 'metrics'

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
}

export interface LensArgs {
  action: CodeGraphAction
  target?: string
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
