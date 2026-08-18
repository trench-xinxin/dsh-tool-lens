/**
 * Shortest pathfinding and execution trace explorer between symbols or files.
 * @module @trench-xinxin/dsh-tool-lens/analytics/pathfinding
 */

import type { GraphStore } from '../core/graph.ts'
import type {
  CodeGraphEdge,
  CodeGraphNode,
  CodeGraphResult,
  PathfindingResult,
} from '../core/types.ts'

/**
 * Explores and computes the shortest invocation path from source node to target node.
 */
export function buildPathfindingResult(
  graph: GraphStore,
  fromQuery: string,
  toQuery: string,
  maxHops = 10,
): CodeGraphResult {
  const fromNodes = graph.findNodes(fromQuery)
  const toNodes = graph.findNodes(toQuery)

  if (fromNodes.length === 0 || toNodes.length === 0) {
    const missing = fromNodes.length === 0 ? `'${fromQuery}'` : `'${toQuery}'`
    return {
      target: `${fromQuery} -> ${toQuery}`,
      action: 'path',
      rootNodes: fromNodes,
      nodes: [],
      edges: [],
      summary: `Pathfinding failed: Node ${missing} could not be found in the index.`,
    }
  }

  const fromNode = fromNodes[0]!
  const toNode = toNodes[0]!

  if (fromNode.id === toNode.id) {
    return {
      target: `${fromNode.name} -> ${toNode.name}`,
      action: 'path',
      rootNodes: [fromNode],
      nodes: [fromNode],
      edges: [],
      summary: `Source and target are the same node: \`${fromNode.name}\`.`,
      pathfinding: {
        fromNode,
        toNode,
        path: [fromNode.id],
        edges: [],
        hops: [`0 hops: ${fromNode.name}`],
        isFound: true,
      },
    }
  }

  // BFS Queue: store current node ID and full path of edges so far
  const queue: { nodeId: string; path: string[]; edges: CodeGraphEdge[] }[] = [
    { nodeId: fromNode.id, path: [fromNode.id], edges: [] },
  ]
  const visited = new Set<string>([fromNode.id])

  let foundPath: { path: string[]; edges: CodeGraphEdge[] } | null = null

  while (queue.length > 0) {
    const current = queue.shift()!
    if (current.path.length - 1 >= maxHops) {
      continue
    }

    const outEdges = graph.getOutboundEdges(current.nodeId)
    for (const edge of outEdges) {
      if (edge.to === toNode.id) {
        foundPath = {
          path: [...current.path, edge.to],
          edges: [...current.edges, edge],
        }
        break
      }

      if (!visited.has(edge.to)) {
        visited.add(edge.to)
        queue.push({
          nodeId: edge.to,
          path: [...current.path, edge.to],
          edges: [...current.edges, edge],
        })
      }
    }

    if (foundPath) break
  }

  if (!foundPath) {
    return {
      target: `${fromNode.name} -> ${toNode.name}`,
      action: 'path',
      rootNodes: [fromNode],
      nodes: [fromNode, toNode],
      edges: [],
      summary: `No connecting path found from \`${fromNode.name}\` to \`${toNode.name}\` within ${maxHops} hops.`,
      pathfinding: {
        fromNode,
        toNode,
        path: [],
        edges: [],
        hops: [],
        isFound: false,
      },
    }
  }

  const pathNodes: CodeGraphNode[] = []
  const hops: string[] = []

  for (let i = 0; i < foundPath.path.length; i++) {
    const nId = foundPath.path[i]!
    const node = graph.getNode(nId)
    if (node) pathNodes.push(node)
  }

  for (let i = 0; i < foundPath.edges.length; i++) {
    const edge = foundPath.edges[i]!
    const fromN = graph.getNode(edge.from)?.name || edge.from
    const toN = graph.getNode(edge.to)?.name || edge.to
    hops.push(`Step ${i + 1}: \`${fromN}\` --[${edge.relation}]--> \`${toN}\``)
  }

  const pathResult: PathfindingResult = {
    fromNode,
    toNode,
    path: foundPath.path,
    edges: foundPath.edges,
    hops,
    isFound: true,
  }

  return {
    target: `${fromNode.name} -> ${toNode.name}`,
    action: 'path',
    rootNodes: [fromNode],
    nodes: pathNodes,
    edges: foundPath.edges,
    summary: `Found shortest path between \`${fromNode.name}\` and \`${toNode.name}\` in ${foundPath.edges.length} hop(s).`,
    pathfinding: pathResult,
  }
}
