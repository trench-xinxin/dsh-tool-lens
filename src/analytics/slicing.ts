/**
 * Domain-driven architecture subgraph slicer and cohesion evaluator.
 * @module @trench-xinxin/dsh-tool-lens/analytics/slicing
 */

import type { GraphStore } from '../core/graph.ts'
import type {
  ArchitectureSliceResult,
  CodeGraphEdge,
  CodeGraphNode,
  CodeGraphResult,
} from '../core/types.ts'

/**
 * Finds domain seed nodes by exact match or fuzzy path/name inclusion.
 */
export function findDomainSeedNodes(graph: GraphStore, domainQuery: string): CodeGraphNode[] {
  const exact = graph.findNodes(domainQuery)
  if (exact.length > 0) return exact

  const q = domainQuery.trim().toLowerCase()
  if (!q) return []

  const matches: CodeGraphNode[] = []
  for (const node of graph.getAllNodes()) {
    const p = node.filePath.toLowerCase()
    const n = node.name.toLowerCase()
    const id = node.id.toLowerCase()

    if (
      p.includes(`/${q}/`) ||
      p.includes(`/${q}.`) ||
      p.startsWith(`${q}/`) ||
      p.includes(q) ||
      n.includes(q) ||
      id.includes(q)
    ) {
      matches.push(node)
    }
  }
  return matches
}

/**
 * Extracts a high-cohesion architectural domain slice around seed query nodes.
 */
export function buildSliceResult(
  graph: GraphStore,
  domainQuery: string,
  maxHops = 2,
): CodeGraphResult {
  const seedNodes = findDomainSeedNodes(graph, domainQuery)

  if (seedNodes.length === 0) {
    return {
      target: domainQuery,
      action: 'slice',
      rootNodes: [],
      nodes: [],
      edges: [],
      summary: `No matching domain seeds found for query '${domainQuery}'.`,
    }
  }

  const seedIds = seedNodes.map((n) => n.id)
  // Traverse both inbound and outbound to capture full bidirectional domain context
  const traversal = graph.traverse(seedIds, 'both', maxHops)

  const slicedNodeIds = new Set(traversal.nodes.map((n) => n.id))
  const slicedNodes = traversal.nodes

  const internalEdges: CodeGraphEdge[] = []
  const boundaryOutgoingEdges: CodeGraphEdge[] = []

  for (const node of slicedNodes) {
    const outEdges = graph.getOutboundEdges(node.id)
    for (const edge of outEdges) {
      if (slicedNodeIds.has(edge.to)) {
        internalEdges.push(edge)
      } else {
        boundaryOutgoingEdges.push(edge)
      }
    }
  }

  const totalEdges = internalEdges.length + boundaryOutgoingEdges.length
  const cohesionScore = totalEdges > 0 ? internalEdges.length / totalEdges : 1.0

  const sliceResult: ArchitectureSliceResult = {
    domainSeed: domainQuery,
    cohesionScore: Number(cohesionScore.toFixed(2)),
    slicedNodes,
    internalEdges,
    boundaryOutgoingEdges,
  }

  const summary = `Domain slice for '${domainQuery}' extracted ${slicedNodes.length} node(s) with ${(cohesionScore * 100).toFixed(1)}% internal cohesion score (${internalEdges.length} internal edges, ${boundaryOutgoingEdges.length} boundary dependencies).`

  return {
    target: domainQuery,
    action: 'slice',
    rootNodes: seedNodes.slice(0, 10),
    nodes: slicedNodes,
    edges: internalEdges,
    summary,
    sliceResult,
  }
}
