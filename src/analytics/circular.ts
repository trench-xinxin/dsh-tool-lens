/**
 * Circular dependency detection and analysis.
 * @module @trench-xinxin/dsh-tool-lens/analytics/circular
 */

import { GraphStore } from '../core/graph.ts'
import type { CircularCycle, CodeGraphResult } from '../core/types.ts'

export interface CircularAnalysisResult {
  cycles: CircularCycle[]
  totalCycles: number
  impactedFiles: string[]
}

/**
 * Runs circular dependency analysis on the provided GraphStore.
 * @param graph - Populated graph store
 * @param scope - Optional scope directory filter
 */
export function analyzeCircularDependencies(
  graph: GraphStore,
  scope?: string,
): CircularAnalysisResult {
  const cycles = graph.findCircularDependencies({
    edgeRelation: 'imports',
    scopePrefix: scope,
  })

  const impactedFileSet = new Set<string>()
  for (const cycle of cycles) {
    for (const item of cycle.cycle) {
      impactedFileSet.add(item)
    }
  }

  return {
    cycles,
    totalCycles: cycles.length,
    impactedFiles: Array.from(impactedFileSet),
  }
}

/**
 * Encapsulates circular analysis into a standard CodeGraphResult.
 */
export function buildCircularResult(
  graph: GraphStore,
  target: string,
  scope?: string,
): CodeGraphResult {
  const analysis = analyzeCircularDependencies(graph, scope)
  const rootNodes = target ? graph.findNodes(target) : []

  const summary =
    analysis.totalCycles === 0
      ? '✅ No circular dependencies detected in the workspace.'
      : `⚠️ Detected ${analysis.totalCycles} circular dependency cycle(s) involving ${analysis.impactedFiles.length} file(s).`

  return {
    target: target || 'workspace',
    action: 'circular',
    rootNodes,
    nodes: [],
    edges: [],
    summary,
    circularCycles: analysis.cycles,
  }
}
