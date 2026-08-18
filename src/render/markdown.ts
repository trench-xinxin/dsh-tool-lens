/**
 * Markdown rendering and token-efficient formatting for DeepSeek Lens responses.
 * @module @trench-xinxin/dsh-tool-lens/render/markdown
 */

import type { CodeGraphNode, CodeGraphResult } from '../core/types.ts'
import { generateMermaidDiagram } from './mermaid.ts'

const MAX_RENDER_NODES = 50
const TRUNCATE_TOP_K = 30

/**
 * Formats a CodeGraphResult into structured, compact markdown for the model response.
 * @param result - The graph query result.
 * @returns Human and model-readable markdown summary.
 */
export function formatGraphMarkdown(result: CodeGraphResult): string {
  // 1. Specialized rendering for Circular Dependency Action
  if (result.action === 'circular') {
    return formatCircularMarkdown(result)
  }

  // 2. Specialized rendering for Architecture Metrics Action
  if (result.action === 'metrics') {
    return formatMetricsMarkdown(result)
  }

  // 3. Specialized rendering for Refactoring Impact Action
  if (result.action === 'impact' && result.impactTiers) {
    return formatImpactMarkdown(result)
  }

  // 4. Default rendering for dependencies & call_graph
  const lines: string[] = [
    `### Lens: ${result.action} for \`${result.target}\``,
    `*Found ${result.nodes.length} connected node(s) and ${result.edges.length} relationship(s).*`,
    '',
  ]

  if (result.rootNodes.length > 0) {
    lines.push('**Root Node(s):**')
    for (const root of result.rootNodes) {
      lines.push(`- **[${root.kind}]** \`${root.name}\` (${root.filePath}${root.line ? `:${root.line}` : ''})`)
    }
    lines.push('')
  }

  if (result.nodes.length > 0) {
    lines.push('**Connected Symbols / Files:**')
    const displayNodes =
      result.nodes.length > MAX_RENDER_NODES ? result.nodes.slice(0, TRUNCATE_TOP_K) : result.nodes

    const groupedByFile = new Map<string, CodeGraphNode[]>()
    for (const node of displayNodes) {
      if (!groupedByFile.has(node.filePath)) {
        groupedByFile.set(node.filePath, [])
      }
      groupedByFile.get(node.filePath)!.push(node)
    }

    for (const [filePath, nodes] of groupedByFile.entries()) {
      lines.push(`- \`${filePath}\`:`)
      for (const node of nodes) {
        if (node.kind !== 'file') {
          lines.push(`  - [${node.kind}] \`${node.name}\`${node.line ? ` (line ${node.line})` : ''}`)
        }
      }
    }

    if (result.nodes.length > MAX_RENDER_NODES) {
      const omitted = result.nodes.length - TRUNCATE_TOP_K
      lines.push(`- *... and ${omitted} more nodes omitted for brevity.*`)
    }
    lines.push('')
  }

  if (result.edges.length > 0) {
    lines.push('**Relationships & Calls:**')
    const displayEdges =
      result.edges.length > MAX_RENDER_NODES ? result.edges.slice(0, TRUNCATE_TOP_K) : result.edges

    for (const edge of displayEdges) {
      lines.push(`- \`${edge.from}\` --[${edge.relation}]--> \`${edge.to}\``)
    }

    if (result.edges.length > MAX_RENDER_NODES) {
      const omitted = result.edges.length - TRUNCATE_TOP_K
      lines.push(`- *... and ${omitted} more relationships omitted for brevity.*`)
    }
    lines.push('')
  }

  if (result.summary) {
    lines.push(`> **Summary**: ${result.summary}`)
  }

  // 5. Append Mermaid topology if graph size is within comfortable bounds
  const mermaid = generateMermaidDiagram(result.nodes, result.edges, 25)
  if (mermaid) {
    lines.push('', '#### Visual Topology', mermaid)
  }

  return lines.join('\n')
}

function formatCircularMarkdown(result: CodeGraphResult): string {
  const lines: string[] = [`### Lens: Circular Dependency Audit`, `> ${result.summary}`, '']

  if (!result.circularCycles || result.circularCycles.length === 0) {
    return lines.join('\n')
  }

  lines.push('**Detected Cycles:**')
  result.circularCycles.forEach((item, index) => {
    lines.push(`#### Cycle #${index + 1} (${item.length} nodes)`)
    lines.push('```text')
    lines.push(item.cycle.join(' \n  └──> '))
    lines.push('```')
  })

  return lines.join('\n')
}

function formatMetricsMarkdown(result: CodeGraphResult): string {
  const metrics = result.metrics
  if (!metrics) {
    return `### Lens: Architecture Metrics\n> ${result.summary}`
  }

  const lines: string[] = [
    `### Lens: Architecture Health & Coupling Metrics`,
    `> **Workspace Overview**: ${metrics.totalFiles} files, ${metrics.totalSymbols} symbols, ${metrics.totalEdges} relations. Average Instability: **${metrics.averageInstability}**`,
    '',
    '#### Top Centrality Hubs (Key Architecture Anchor Points)',
    '| Symbol / File | Kind | Location | Total Degree | Inbound | Outbound |',
    '| :--- | :--- | :--- | :---: | :---: | :---: |',
  ]

  for (const hub of metrics.topHubs.slice(0, 10)) {
    lines.push(
      `| \`${hub.name}\` | ${hub.kind} | \`${hub.filePath}\` | ${hub.degree} | ${hub.inboundDegree} | ${hub.outboundDegree} |`,
    )
  }

  lines.push('', '#### Module Coupling & Fragility Matrix (Top 10)')
  lines.push('| Module File | Afferent ($Ca$) | Efferent ($Ce$) | Instability ($I$) |')
  lines.push('| :--- | :---: | :---: | :---: |')

  for (const mod of metrics.modules.slice(0, 10)) {
    lines.push(
      `| \`${mod.filePath}\` | ${mod.afferentCoupling} | ${mod.efferentCoupling} | ${mod.instability} |`,
    )
  }

  return lines.join('\n')
}

function formatImpactMarkdown(result: CodeGraphResult): string {
  const tiers = result.impactTiers!
  const lines: string[] = [
    `### Lens: Refactoring Impact Analysis for \`${result.target}\``,
    `> **Blast Radius**: ${result.summary}`,
    '',
  ]

  if (tiers.directBreaking.length > 0) {
    lines.push('#### 🔴 Tier 0: Direct Breaking Risk (External Callers / Importers)')
    for (const node of tiers.directBreaking) {
      lines.push(`- **[${node.kind}]** \`${node.name}\` (\`${node.filePath}${node.line ? `:${node.line}` : ''}\`)`)
    }
    lines.push('')
  }

  if (tiers.internalCascading.length > 0) {
    lines.push('#### 🟡 Tier 1: Internal Cascading Risk (Same-File Functions / Methods)')
    for (const node of tiers.internalCascading) {
      lines.push(`- **[${node.kind}]** \`${node.name}\` (\`${node.filePath}${node.line ? `:${node.line}` : ''}\`)`)
    }
    lines.push('')
  }

  if (tiers.transitiveImporters.length > 0) {
    lines.push('#### 🔵 Tier 2: Transitive Importers (Upstream Modules)')
    for (const node of tiers.transitiveImporters) {
      lines.push(`- **[${node.kind}]** \`${node.name}\` (\`${node.filePath}\`)`)
    }
    lines.push('')
  }

  const mermaid = generateMermaidDiagram(result.nodes, result.edges, 25)
  if (mermaid) {
    lines.push('#### Impact Propagation Topology', mermaid)
  }

  return lines.join('\n')
}
