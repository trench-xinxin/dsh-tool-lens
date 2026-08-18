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

  // 4. Specialized rendering for Pathfinding Action
  if (result.action === 'path') {
    return formatPathMarkdown(result)
  }

  // 5. Specialized rendering for Dead Code Action
  if (result.action === 'unused' && result.deadCode) {
    return formatUnusedMarkdown(result)
  }

  // 6. Specialized rendering for Architecture Lint Action
  if (result.action === 'lint') {
    return formatLintMarkdown(result)
  }

  // 7. Default rendering for dependencies & call_graph
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

  // Append Mermaid topology if graph size is within comfortable bounds
  const mermaid = generateMermaidDiagram(result.nodes, result.edges, 25)
  if (mermaid) {
    lines.push('', '#### Visual Topology', mermaid)
  }

  return lines.join('\n')
}

function formatPathMarkdown(result: CodeGraphResult): string {
  const p = result.pathfinding
  const lines: string[] = [
    `### Lens: Call Path Explorer (\`${result.target}\`)`,
    `> ${result.summary}`,
    '',
  ]

  if (p && p.isFound && p.hops.length > 0) {
    lines.push('**Execution Trace / Call Chain:**')
    for (const hop of p.hops) {
      lines.push(`- ${hop}`)
    }
    lines.push('')
  }

  const mermaid = generateMermaidDiagram(result.nodes, result.edges, 20)
  if (mermaid) {
    lines.push('#### Path Topology', mermaid)
  }

  return lines.join('\n')
}

function formatUnusedMarkdown(result: CodeGraphResult): string {
  const d = result.deadCode!
  const lines: string[] = [
    '### Lens: Dead Code & Unreachable Symbols Audit',
    `> ${result.summary}`,
    '',
  ]

  if (d.orphanFiles.length > 0) {
    lines.push(`**Orphan Files (${d.orphanFiles.length}):**`)
    for (const f of d.orphanFiles) {
      lines.push(`- 📄 \`${f.filePath}\` (no external imports)`)
    }
    lines.push('')
  }

  if (d.unusedSymbols.length > 0) {
    lines.push(`**Unreferenced Symbols (${d.unusedSymbols.length}):**`)
    lines.push('| Kind | Symbol Name | File Location | Line |')
    lines.push('| :--- | :--- | :--- | :--- |')
    for (const sym of d.unusedSymbols.slice(0, 30)) {
      lines.push(`| ${sym.kind} | \`${sym.name}\` | \`${sym.filePath}\` | ${sym.line ?? '-'} |`)
    }
    if (d.unusedSymbols.length > 30) {
      lines.push(`| ... | *${d.unusedSymbols.length - 30} more unreferenced symbols* | | |`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

function formatLintMarkdown(result: CodeGraphResult): string {
  const violations = result.architectureViolations ?? []
  const lines: string[] = [
    '### Lens: Architecture Layer & Dependency Lint',
    `> ${result.summary}`,
    '',
  ]

  if (violations.length > 0) {
    lines.push('**Boundary Violations Detected:**')
    for (let i = 0; i < violations.length; i++) {
      const v = violations[i]!
      lines.push(`#### Violation #${i + 1}: \`${v.fromNode.name}\` -> \`${v.toNode.name}\``)
      lines.push(`- **From:** \`${v.fromNode.filePath}\` (${v.fromNode.kind})`)
      lines.push(`- **To:** \`${v.toNode.filePath}\` (${v.toNode.kind})`)
      lines.push(`- **Relation:** \`${v.relation}\``)
      lines.push(`- **Reason:** 🚨 ${v.reason}`)
      lines.push('')
    }
  }

  return lines.join('\n')
}

function formatCircularMarkdown(result: CodeGraphResult): string {
  const cycles = result.circularCycles ?? []
  const lines: string[] = [
    '### Lens: Circular Dependency Audit',
    `> ${result.summary}`,
    '',
  ]

  if (cycles.length === 0) {
    lines.push('No circular dependency cycles detected in the targeted scope.')
    return lines.join('\n')
  }

  lines.push(`**Detected Cycles (${cycles.length}):**`)
  for (let i = 0; i < cycles.length; i++) {
    const item = cycles[i]!
    lines.push(`#### Cycle #${i + 1} (Length: ${item.length})`)
    const chain = item.cycle.map((id) => `\`${id}\``).join(' ➔ ')
    lines.push(`- **Chain:** ${chain}`)
    lines.push('')
  }

  const mermaid = generateMermaidDiagram(result.nodes, result.edges, 20)
  if (mermaid) {
    lines.push('#### Circular Topology', mermaid)
  }

  return lines.join('\n')
}

function formatMetricsMarkdown(result: CodeGraphResult): string {
  const m = result.metrics
  if (!m) return result.summary

  const lines: string[] = [
    '### Lens: Architecture Health & Coupling Metrics',
    `> Indexed **${m.totalFiles} files**, **${m.totalSymbols} symbols**, and **${m.totalEdges} relationships**. Average module instability: **${(m.averageInstability * 100).toFixed(1)}%**.`,
    '',
  ]

  if (m.topHubs.length > 0) {
    lines.push('**Top Centrality Hubs (God Classes & Core Symbols):**')
    lines.push('| Rank | Kind | Symbol / File | Total Degree | Inbound (Ca) | Outbound (Ce) |')
    lines.push('| :--- | :--- | :--- | :--- | :--- | :--- |')
    m.topHubs.slice(0, 10).forEach((hub, idx) => {
      lines.push(
        `| #${idx + 1} | ${hub.kind} | \`${hub.name}\` | **${hub.degree}** | ${hub.inboundDegree} | ${hub.outboundDegree} |`,
      )
    })
    lines.push('')
  }

  if (m.modules.length > 0) {
    lines.push('**Module Coupling & Fragility Matrix:**')
    lines.push('| Module File | Afferent (Ca) | Efferent (Ce) | Instability (I) | Assessment |')
    lines.push('| :--- | :--- | :--- | :--- | :--- |')
    m.modules.slice(0, 15).forEach((mod) => {
      const assess =
        mod.instability === 0
          ? '🛡 Very Stable'
          : mod.instability >= 0.8
            ? '⚠️ Fragile'
            : '⚖ Balanced'
      lines.push(
        `| \`${mod.filePath}\` | ${mod.afferentCoupling} | ${mod.efferentCoupling} | ${(mod.instability * 100).toFixed(0)}% | ${assess} |`,
      )
    })
    lines.push('')
  }

  return lines.join('\n')
}

function formatImpactMarkdown(result: CodeGraphResult): string {
  const tiers = result.impactTiers!
  const lines: string[] = [
    `### Lens: Refactoring Impact & Blast Radius for \`${result.target}\``,
    `> ${result.summary}`,
    '',
    `**Target Node:** [${tiers.targetNode.kind}] \`${tiers.targetNode.name}\` (${tiers.targetNode.filePath}${tiers.targetNode.line ? `:${tiers.targetNode.line}` : ''})`,
    '',
  ]

  if (tiers.directBreaking.length > 0) {
    lines.push(`#### 🔴 Tier 0: Direct Breaking (${tiers.directBreaking.length})`)
    for (const n of tiers.directBreaking) {
      lines.push(`- **[${n.kind}]** \`${n.name}\` (${n.filePath}${n.line ? `:${n.line}` : ''})`)
    }
    lines.push('')
  }

  if (tiers.internalCascading.length > 0) {
    lines.push(`#### 🟡 Tier 1: Internal Cascading (${tiers.internalCascading.length})`)
    for (const n of tiers.internalCascading) {
      lines.push(`- **[${n.kind}]** \`${n.name}\` (${n.filePath}${n.line ? `:${n.line}` : ''})`)
    }
    lines.push('')
  }

  if (tiers.transitiveImporters.length > 0) {
    lines.push(`#### 🔵 Tier 2: Transitive Importers (${tiers.transitiveImporters.length})`)
    for (const n of tiers.transitiveImporters) {
      lines.push(`- **[${n.kind}]** \`${n.name}\` (${n.filePath})`)
    }
    lines.push('')
  }

  const mermaid = generateMermaidDiagram(result.nodes, result.edges, 25)
  if (mermaid) {
    lines.push('#### Impact Topology Flowchart', mermaid)
  }

  return lines.join('\n')
}
