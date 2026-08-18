/**
 * Mermaid diagram generator for code topologies.
 * @module @trench-xinxin/dsh-tool-lens/render/mermaid
 */

import type { CodeGraphEdge, CodeGraphNode } from '../core/types.ts'

/**
 * Generates a Mermaid flowchart string from graph nodes and edges.
 * @param nodes - Nodes to render in diagram
 * @param edges - Edges connecting nodes
 * @param maxNodes - Max nodes to render before skipping diagram (default: 25)
 */
export function generateMermaidDiagram(
  nodes: CodeGraphNode[],
  edges: CodeGraphEdge[],
  maxNodes = 25,
): string | null {
  if (nodes.length === 0 || edges.length === 0 || nodes.length > maxNodes) {
    return null
  }

  const lines: string[] = ['```mermaid', 'graph TD']
  const nodeIdMap = new Map<string, string>()

  // 1. Assign short aliases for nodes to avoid syntax issues with symbols/paths
  let counter = 1
  for (const node of nodes) {
    const alias = `N${counter++}`
    nodeIdMap.set(node.id, alias)
    const label = sanitizeLabel(node.name || node.filePath)
    lines.push(`  ${alias}["${label}"]`)
  }

  // 2. Render edges
  const renderedEdges = new Set<string>()
  for (const edge of edges) {
    // Skip 'contains' edges in high-level mermaid diagrams to keep visual clarity
    if (edge.relation === 'contains') continue

    const fromAlias = nodeIdMap.get(edge.from)
    const toAlias = nodeIdMap.get(edge.to)

    if (fromAlias && toAlias && fromAlias !== toAlias) {
      const edgeKey = `${fromAlias}->${toAlias}:${edge.relation}`
      if (!renderedEdges.has(edgeKey)) {
        renderedEdges.add(edgeKey)
        const relLabel = sanitizeLabel(edge.relation)
        lines.push(`  ${fromAlias} -->|${relLabel}| ${toAlias}`)
      }
    }
  }

  if (renderedEdges.size === 0) {
    return null
  }

  lines.push('```')
  return lines.join('\n')
}

function sanitizeLabel(text: string): string {
  return text.replace(/"/g, "'").replace(/[<>]/g, '')
}
