/**
 * Refactoring blast radius impact analysis with 3-tier risk grading.
 * @module @trench-xinxin/dsh-tool-lens/analytics/impact
 */

import { GraphStore } from '../core/graph.ts'
import type { CodeGraphNode, CodeGraphResult, ImpactTiers } from '../core/types.ts'

export interface ImpactAnalysisResult {
  rootNodes: CodeGraphNode[]
  traversalNodes: CodeGraphNode[]
  impactTiers?: ImpactTiers
  summary: string
}

/**
 * Evaluates the blast radius of modifying a target symbol or file.
 * @param graph - Populated graph store
 * @param target - Target symbol or file query
 * @param depth - Traversal depth (default: 3)
 */
export function analyzeImpact(
  graph: GraphStore,
  target: string,
  depth = 3,
): ImpactAnalysisResult {
  const matchedNodes = graph.findNodes(target)
  if (matchedNodes.length === 0) {
    return {
      rootNodes: [],
      traversalNodes: [],
      summary: `No matching symbol or file found for impact target '${target}'.`,
    }
  }

  const rootNode = matchedNodes[0]!
  const tiers = graph.analyzeImpactTiers(rootNode.id)
  const traversal = graph.traverse([rootNode.id], 'inbound', depth)

  const directCount = tiers?.directBreaking.length ?? 0
  const internalCount = tiers?.internalCascading.length ?? 0
  const transitiveCount = tiers?.transitiveImporters.length ?? 0

  const summary = `Modifying '${target}' results in ${directCount} direct breaking caller(s), ${internalCount} internal cascade(s), and ${transitiveCount} transitive importer(s).`

  return {
    rootNodes: matchedNodes,
    traversalNodes: traversal.nodes,
    impactTiers: tiers,
    summary,
  }
}
