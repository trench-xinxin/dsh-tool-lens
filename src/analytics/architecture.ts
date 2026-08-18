/**
 * Architecture layer boundary rules & dependency linting engine.
 * @module @trench-xinxin/dsh-tool-lens/analytics/architecture
 */

import type { GraphStore } from '../core/graph.ts'
import type {
  ArchitectureRule,
  ArchitectureViolation,
  CodeGraphResult,
} from '../core/types.ts'

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
  return new RegExp(`^${escaped}|${escaped}`)
}

/**
 * Checks all graph edges against architectural boundary and layer rules.
 */
export function buildLintResult(
  graph: GraphStore,
  rawRules?: ArchitectureRule[] | string,
): CodeGraphResult {
  let rules: ArchitectureRule[] = []

  if (typeof rawRules === 'string') {
    try {
      rules = JSON.parse(rawRules)
    } catch {
      rules = []
    }
  } else if (Array.isArray(rawRules)) {
    rules = rawRules
  }

  // Fallback default enterprise rule if none specified
  if (rules.length === 0) {
    rules = [
      {
        from: 'core',
        to: 'views',
        description: 'Core layer should not depend directly on Presentation/Views layer.',
      },
      {
        from: 'common',
        to: 'modules',
        description: 'Shared common libraries must not inversely depend on business modules.',
      },
    ]
  }

  const compiledRules = rules.map((r) => ({
    rule: r,
    fromPattern: globToRegex(r.from),
    toPattern: globToRegex(r.to),
  }))

  const violations: ArchitectureViolation[] = []
  const allEdges = graph.getAllEdges()

  for (const edge of allEdges) {
    const fromNode = graph.getNode(edge.from)
    const toNode = graph.getNode(edge.to)
    if (!fromNode || !toNode || fromNode.filePath === toNode.filePath) {
      continue
    }

    for (const item of compiledRules) {
      const fromMatches = item.fromPattern.test(fromNode.filePath)
      const toMatches = item.toPattern.test(toNode.filePath)

      if (fromMatches && toMatches) {
        violations.push({
          fromNode,
          toNode,
          relation: edge.relation,
          violatedRule: item.rule,
          reason: item.rule.description ?? `Forbidden layer boundary: \`${item.rule.from}\` -> \`${item.rule.to}\``,
        })
      }
    }
  }

  let summary = ''
  if (violations.length === 0) {
    summary = `✅ Architecture compliant: Evaluated ${rules.length} rule(s) across ${allEdges.length} edge(s) with 0 violations.`
  } else {
    summary = `🚨 Found ${violations.length} architecture boundary violation(s) across ${rules.length} evaluated rule(s).`
  }

  return {
    target: 'architecture',
    action: 'lint',
    rootNodes: [],
    nodes: violations.map((v) => v.fromNode),
    edges: violations.map((v) => ({ from: v.fromNode.id, to: v.toNode.id, relation: v.relation })),
    summary,
    architectureViolations: violations,
  }
}
