/**
 * Rendering and UI presentation utilities for the `lens` tool.
 * @module @deepseek-ai/dsh-tool-lens/render
 */

import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
import type { CodeGraphNode, CodeGraphResult, LensArgs } from './types.ts'

/**
 * Formats a CodeGraphResult into structured markdown for the model response.
 * @param result - The graph query result.
 * @returns Human and model-readable markdown summary.
 */
export function formatGraphMarkdown(result: CodeGraphResult): string {
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
    const groupedByFile = new Map<string, CodeGraphNode[]>()
    for (const node of result.nodes) {
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
    lines.push('')
  }

  if (result.edges.length > 0) {
    lines.push('**Relationships & Calls:**')
    for (const edge of result.edges) {
      lines.push(`- \`${edge.from}\` --[${edge.relation}]--> \`${edge.to}\``)
    }
    lines.push('')
  }

  if (result.summary) {
    lines.push(`> **Summary**: ${result.summary}`)
  }

  return lines.join('\n')
}

/**
 * Pure presenter for the tool-call pending card.
 * @param args - Tool invocation arguments.
 */
export function presentLensCall(args: LensArgs): ToolCallView {
  return {
    card: 'generic',
    title: `Lens: ${args.action} on ${args.target}`,
    kind: 'search',
    ...(args.target.includes('/') ? { locations: [{ path: args.target }] } : {}),
  }
}

/**
 * Pure presenter for the completed tool result card.
 * @param args - Tool invocation arguments.
 * @param executionResult - Result envelope containing content and error state.
 */
export function presentLensResult(
  args: LensArgs,
  executionResult: { content: readonly { type: string; text?: string }[]; isError: boolean },
): ToolResultView {
  return {
    card: 'generic',
    title: executionResult.isError ? `Lens query failed` : `Lens: ${args.action} (${args.target})`,
  }
}
