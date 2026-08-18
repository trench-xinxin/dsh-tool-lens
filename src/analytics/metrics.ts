/**
 * Architecture health, module coupling, and centrality hub metrics analysis.
 * @module @trench-xinxin/dsh-tool-lens/analytics/metrics
 */

import { GraphStore } from '../core/graph.ts'
import type { CodeGraphResult, ProjectMetrics } from '../core/types.ts'

/**
 * Computes architectural metrics across all indexed modules and symbols.
 * @param graph - Populated graph store
 */
export function analyzeProjectMetrics(graph: GraphStore): ProjectMetrics {
  return graph.calculateMetrics()
}

/**
 * Encapsulates architecture metrics into a standard CodeGraphResult.
 */
export function buildMetricsResult(
  graph: GraphStore,
  target?: string,
): CodeGraphResult {
  const metrics = analyzeProjectMetrics(graph)
  const rootNodes = target ? graph.findNodes(target) : []

  const summary = `Evaluated ${metrics.totalFiles} file(s), ${metrics.totalSymbols} symbol(s), and ${metrics.totalEdges} relation(s). Average instability: ${metrics.averageInstability}.`

  return {
    target: target || 'workspace',
    action: 'metrics',
    rootNodes,
    nodes: [],
    edges: [],
    summary,
    metrics,
  }
}
