/**
 * In-memory directed graph store and high-performance traversal/analytics algorithms.
 * @module @trench-xinxin/dsh-tool-lens/core/graph
 */

import type {
  CircularCycle,
  CodeEdgeRelation,
  CodeGraphEdge,
  CodeGraphNode,
  ImpactTiers,
  ModuleMetric,
  ProjectMetrics,
  TopHub,
} from './types.ts'

/**
 * An in-memory directed graph with bidirectional adjacency indexes
 * supporting fast depth-bounded exploration, cycle detection, and architecture metrics.
 */
export class GraphStore {
  private readonly nodes = new Map<string, CodeGraphNode>()
  private readonly outbound = new Map<string, Set<CodeGraphEdge>>()
  private readonly inbound = new Map<string, Set<CodeGraphEdge>>()

  /** Add or update a node in the graph. */
  addNode(node: CodeGraphNode): void {
    this.nodes.set(node.id, node)
    if (!this.outbound.has(node.id)) {
      this.outbound.set(node.id, new Set())
    }
    if (!this.inbound.has(node.id)) {
      this.inbound.set(node.id, new Set())
    }
  }

  /** Add a directed edge from source to target. */
  addEdge(edge: CodeGraphEdge): void {
    if (!this.outbound.has(edge.from)) {
      this.outbound.set(edge.from, new Set())
    }
    if (!this.inbound.has(edge.to)) {
      this.inbound.set(edge.to, new Set())
    }
    this.outbound.get(edge.from)!.add(edge)
    this.inbound.get(edge.to)!.add(edge)
  }

  /** Batch add nodes and edges to graph. */
  bulkAdd(nodes: CodeGraphNode[], edges: CodeGraphEdge[]): void {
    for (const node of nodes) {
      this.addNode(node)
    }
    for (const edge of edges) {
      this.addEdge(edge)
    }
  }

  /**
   * Safely removes all nodes and edges belonging to a file path.
   * Cleans up both outbound and inbound edges from connecting external nodes.
   */
  removeFile(filePath: string): void {
    const targetNodeIds = new Set<string>()

    for (const node of this.nodes.values()) {
      if (node.filePath === filePath || node.id === filePath) {
        targetNodeIds.add(node.id)
      }
    }

    if (targetNodeIds.size === 0) return

    for (const id of targetNodeIds) {
      // 1. Remove all outbound edges originating from id
      const outEdges = this.outbound.get(id)
      if (outEdges) {
        for (const edge of outEdges) {
          const targetInbound = this.inbound.get(edge.to)
          if (targetInbound) {
            targetInbound.delete(edge)
          }
        }
        this.outbound.delete(id)
      }

      // 2. Remove all inbound edges pointing to id
      const inEdges = this.inbound.get(id)
      if (inEdges) {
        for (const edge of inEdges) {
          const sourceOutbound = this.outbound.get(edge.from)
          if (sourceOutbound) {
            sourceOutbound.delete(edge)
          }
        }
        this.inbound.delete(id)
      }

      // 3. Delete node record
      this.nodes.delete(id)
    }
  }

  /** Retrieve a node by its unique ID. */
  getNode(id: string): CodeGraphNode | undefined {
    return this.nodes.get(id)
  }

  /** Retrieve all nodes. */
  getAllNodes(): CodeGraphNode[] {
    return Array.from(this.nodes.values())
  }

  /** Retrieve all edges. */
  getAllEdges(): CodeGraphEdge[] {
    const allEdges: CodeGraphEdge[] = []
    for (const edgeSet of this.outbound.values()) {
      for (const edge of edgeSet) {
        allEdges.push(edge)
      }
    }
    return allEdges
  }

  /** Get outbound edges for a node. */
  getOutboundEdges(nodeId: string): CodeGraphEdge[] {
    const edges = this.outbound.get(nodeId)
    return edges ? Array.from(edges) : []
  }

  /** Get inbound edges for a node. */
  getInboundEdges(nodeId: string): CodeGraphEdge[] {
    const edges = this.inbound.get(nodeId)
    return edges ? Array.from(edges) : []
  }

  /** Find all nodes whose name, filePath, or ID match the query string. */
  findNodes(query: string): CodeGraphNode[] {
    const raw = query.trim()
    if (!raw) return []
    const cleanQuery = raw.replace(/^[./\\]+/, '').replace(/\\/g, '/')
    const normalized = cleanQuery.toLowerCase()
    const rawNorm = raw.toLowerCase()
    const exactMatches: CodeGraphNode[] = []
    const fileSuffixMatches: CodeGraphNode[] = []
    const symbolSuffixMatches: CodeGraphNode[] = []
    const pathFallbackMatches: CodeGraphNode[] = []
    const fuzzyInclusionMatches: CodeGraphNode[] = []

    for (const node of this.nodes.values()) {
      const nodeId = node.id.toLowerCase()
      const nodeName = node.name.toLowerCase()
      const nodePath = node.filePath.toLowerCase().replace(/\\/g, '/')

      // 1. Exact ID / Name / FilePath match
      if (nodeId === normalized || nodeName === normalized || nodePath === normalized || nodeId === rawNorm || nodePath === rawNorm) {
        exactMatches.push(node)
        continue
      }

      // 2. Member method short-name match: e.g. target "analyzeSourceCode" matches "CodeAnalyzer.analyzeSourceCode"
      if (nodeName.endsWith(`.${normalized}`) || nodeName.endsWith(`#${normalized}`) || nodeId.endsWith(`#${normalized}`)) {
        symbolSuffixMatches.push(node)
        continue
      }

      // 3. File path suffix match on file/component nodes (e.g. "src/index.ts" matches "packages/core/src/index.ts")
      if (
        (node.kind === 'file' || node.kind === 'component') &&
        (nodePath.endsWith(`/${normalized}`) || nodePath === normalized || nodePath.endsWith(`/${cleanQuery.toLowerCase()}`))
      ) {
        fileSuffixMatches.push(node)
        continue
      }

      // 4. File path suffix match fallback on any node
      if (nodePath.endsWith(`/${normalized}`) || nodePath === normalized) {
        pathFallbackMatches.push(node)
        continue
      }

      // 5. Fuzzy inclusion
      if (nodeName.includes(normalized) || nodePath.includes(normalized)) {
        fuzzyInclusionMatches.push(node)
      }
    }

    if (exactMatches.length > 0) return exactMatches
    if (fileSuffixMatches.length > 0) return fileSuffixMatches
    if (symbolSuffixMatches.length > 0) return symbolSuffixMatches
    if (pathFallbackMatches.length > 0) return pathFallbackMatches
    return fuzzyInclusionMatches
  }

  /**
   * Breadth-first traversal up to maxDepth starting from the specified root IDs.
   * @param rootIds - The starting node IDs.
   * @param direction - 'inbound' (upstream callers/importers), 'outbound' (downstream callees/dependencies), or 'both'.
   * @param maxDepth - Maximum edge traversal depth.
   */
  traverse(
    rootIds: string[],
    direction: 'inbound' | 'outbound' | 'both' = 'both',
    maxDepth = 2,
  ): { nodes: CodeGraphNode[]; edges: CodeGraphEdge[] } {
    const visitedNodes = new Set<string>()
    const collectedEdges = new Set<CodeGraphEdge>()
    let currentLevel = new Set<string>()

    for (const id of rootIds) {
      if (this.nodes.has(id)) {
        visitedNodes.add(id)
        currentLevel.add(id)
      }
    }

    for (let depth = 0; depth < maxDepth && currentLevel.size > 0; depth++) {
      const nextLevel = new Set<string>()

      for (const nodeId of currentLevel) {
        if (direction === 'outbound' || direction === 'both') {
          const outEdges = this.outbound.get(nodeId)
          if (outEdges) {
            for (const edge of outEdges) {
              collectedEdges.add(edge)
              if (!visitedNodes.has(edge.to)) {
                visitedNodes.add(edge.to)
                nextLevel.add(edge.to)
              }
            }
          }
        }

        if (direction === 'inbound' || direction === 'both') {
          const inEdges = this.inbound.get(nodeId)
          if (inEdges) {
            for (const edge of inEdges) {
              collectedEdges.add(edge)
              if (!visitedNodes.has(edge.from)) {
                visitedNodes.add(edge.from)
                nextLevel.add(edge.from)
              }
            }
          }
        }
      }

      currentLevel = nextLevel
    }

    const resultNodes: CodeGraphNode[] = []
    for (const id of visitedNodes) {
      const node = this.nodes.get(id)
      if (node) {
        resultNodes.push(node)
      }
    }

    return {
      nodes: resultNodes,
      edges: Array.from(collectedEdges),
    }
  }

  /**
   * Detects all circular dependency cycles (e.g., file imports A -> B -> C -> A).
   * Uses DFS cycle detection with canonical cycle normalization to avoid duplicates.
   */
  findCircularDependencies(options?: {
    edgeRelation?: CodeEdgeRelation
    scopePrefix?: string
  }): CircularCycle[] {
    const relationFilter = options?.edgeRelation ?? 'imports'
    const scopePrefix = options?.scopePrefix

    // 1. Build adjacency list of relevant file/module nodes
    const adj = new Map<string, Set<string>>()
    const nodeIds = new Set<string>()

    for (const node of this.nodes.values()) {
      if (node.kind !== 'file') continue
      if (scopePrefix && !node.filePath.startsWith(scopePrefix)) continue
      nodeIds.add(node.id)
      adj.set(node.id, new Set())
    }

    for (const [fromId, edges] of this.outbound.entries()) {
      if (!nodeIds.has(fromId)) continue
      for (const edge of edges) {
        if (edge.relation === relationFilter && nodeIds.has(edge.to) && edge.to !== fromId) {
          adj.get(fromId)!.add(edge.to)
        }
      }
    }

    // 2. DFS cycle finding with path tracking
    const cycles: CircularCycle[] = []
    const visited = new Set<string>()
    const recursionStack: string[] = []
    const recursionSet = new Set<string>()
    const discoveredCyclesSignatures = new Set<string>()

    const dfs = (current: string) => {
      visited.add(current)
      recursionStack.push(current)
      recursionSet.add(current)

      const neighbors = adj.get(current)
      if (neighbors) {
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            dfs(neighbor)
          } else if (recursionSet.has(neighbor)) {
            const cycleStartIndex = recursionStack.indexOf(neighbor)
            if (cycleStartIndex !== -1) {
              const cyclePath = recursionStack.slice(cycleStartIndex)
              cyclePath.push(neighbor)

              const rawCycle = cyclePath.slice(0, -1)
              let minIndex = 0
              for (let i = 1; i < rawCycle.length; i++) {
                if (rawCycle[i]! < rawCycle[minIndex]!) {
                  minIndex = i
                }
              }
              const normalized = [
                ...rawCycle.slice(minIndex),
                ...rawCycle.slice(0, minIndex),
              ]
              const signature = normalized.join(' -> ')

              if (!discoveredCyclesSignatures.has(signature)) {
                discoveredCyclesSignatures.add(signature)
                cycles.push({
                  cycle: [...normalized, normalized[0]!],
                  length: normalized.length,
                })
              }
            }
          }
        }
      }

      recursionSet.delete(current)
      recursionStack.pop()
    }

    for (const id of nodeIds) {
      if (!visited.has(id)) {
        dfs(id)
      }
    }

    return cycles.sort((a, b) => a.length - b.length)
  }

  /**
   * Computes architecture coupling metrics (Ca, Ce, Instability) and Top Hubs.
   */
  calculateMetrics(): ProjectMetrics {
    const fileNodes = Array.from(this.nodes.values()).filter(
      (n) => n.kind === 'file' || n.kind === 'component',
    )
    const fileMap = new Map<string, CodeGraphNode>()
    for (const f of fileNodes) {
      fileMap.set(f.id, f)
    }

    const moduleMetrics: ModuleMetric[] = []
    let totalInstability = 0

    for (const file of fileNodes) {
      const inEdges = this.inbound.get(file.id) ?? new Set()
      const caSet = new Set<string>()
      for (const e of inEdges) {
        if (e.relation === 'imports' && e.from !== file.id && fileMap.has(e.from)) {
          caSet.add(e.from)
        }
      }
      const ca = caSet.size

      const outEdges = this.outbound.get(file.id) ?? new Set()
      const ceSet = new Set<string>()
      for (const e of outEdges) {
        if (e.relation === 'imports' && e.to !== file.id && fileMap.has(e.to)) {
          ceSet.add(e.to)
        }
      }
      const ce = ceSet.size

      const totalCoupling = ca + ce
      const instability = totalCoupling === 0 ? 0 : Number((ce / totalCoupling).toFixed(3))
      totalInstability += instability

      moduleMetrics.push({
        filePath: file.filePath,
        afferentCoupling: ca,
        efferentCoupling: ce,
        instability,
      })
    }

    moduleMetrics.sort((a, b) => b.afferentCoupling - a.afferentCoupling || b.efferentCoupling - a.efferentCoupling)

    const hubs: TopHub[] = []
    for (const node of this.nodes.values()) {
      const inCount = this.inbound.get(node.id)?.size ?? 0
      const outCount = this.outbound.get(node.id)?.size ?? 0
      const degree = inCount + outCount

      if (degree > 0) {
        hubs.push({
          id: node.id,
          name: node.name,
          kind: node.kind,
          filePath: node.filePath,
          degree,
          inboundDegree: inCount,
          outboundDegree: outCount,
        })
      }
    }

    hubs.sort((a, b) => b.degree - a.degree)
    const topHubs = hubs.slice(0, 10)

    const averageInstability =
      fileNodes.length > 0 ? Number((totalInstability / fileNodes.length).toFixed(3)) : 0

    return {
      totalFiles: fileNodes.length,
      totalSymbols: this.nodes.size - fileNodes.length,
      totalEdges: this.getAllEdges().length,
      modules: moduleMetrics,
      topHubs,
      averageInstability,
    }
  }

  /**
   * Analyzes refactoring blast-radius impact for a specific node with 3 tiers.
   */
  analyzeImpactTiers(targetId: string): ImpactTiers | undefined {
    const targetNode = this.nodes.get(targetId)
    if (!targetNode) return undefined

    const directBreaking = new Set<CodeGraphNode>()
    const internalCascading = new Set<CodeGraphNode>()
    const transitiveImporters = new Set<CodeGraphNode>()

    const inEdges = this.inbound.get(targetId) ?? new Set()
    for (const edge of inEdges) {
      if (edge.relation === 'contains') continue
      const callerNode = this.nodes.get(edge.from)
      if (!callerNode) continue

      if (callerNode.filePath === targetNode.filePath) {
        internalCascading.add(callerNode)
      } else {
        directBreaking.add(callerNode)
      }
    }

    const fullTraversal = this.traverse([targetId], 'inbound', 3)
    for (const node of fullTraversal.nodes) {
      if (node.id === targetId) continue
      if (!directBreaking.has(node) && !internalCascading.has(node)) {
        transitiveImporters.add(node)
      }
    }

    return {
      targetNode,
      directBreaking: Array.from(directBreaking),
      internalCascading: Array.from(internalCascading),
      transitiveImporters: Array.from(transitiveImporters),
    }
  }

  /** Total number of nodes in the graph. */
  get size(): number {
    return this.nodes.size
  }

  /** Clear all graph data. */
  clear(): void {
    this.nodes.clear()
    this.outbound.clear()
    this.inbound.clear()
  }
}
