/**
 * Dead code & unreachable symbol detector using graph reachability analysis.
 * @module @trench-xinxin/dsh-tool-lens/analytics/deadcode
 */

import type { GraphStore } from '../core/graph.ts'
import type { CodeGraphNode, CodeGraphResult, DeadCodeResult } from '../core/types.ts'

const ENTRY_POINT_PATTERNS = [
  /index\.[a-z]+$/i,
  /main\.[a-z]+$/i,
  /app\.[a-z]+$/i,
  /server\.[a-z]+$/i,
  /cli\.[a-z]+$/i,
  /\.dsh\/lens/i,
  /vite\.config/i,
  /webpack\.config/i,
]

function isEntryPoint(filePath: string): boolean {
  return ENTRY_POINT_PATTERNS.some((pattern) => pattern.test(filePath))
}

/**
 * Audits the codebase for orphan files and unreachable exported symbols.
 */
export function buildUnusedResult(graph: GraphStore, scope?: string): CodeGraphResult {
  const allNodes = graph.getAllNodes()
  const orphanFiles: CodeGraphNode[] = []
  const unusedSymbols: CodeGraphNode[] = []

  for (const node of allNodes) {
    if (scope && !node.filePath.startsWith(scope)) {
      continue
    }

    // 1. Orphan File Check
    if (node.kind === 'file' || node.kind === 'component') {
      if (!isEntryPoint(node.filePath)) {
        const inEdges = graph.getInboundEdges(node.id).filter((e) => e.relation === 'imports')
        if (inEdges.length === 0) {
          orphanFiles.push(node)
        }
      }
      continue
    }

    // 2. Unused Symbol Check (functions, classes, interfaces, variables)
    if (node.kind === 'function' || node.kind === 'class' || node.kind === 'interface') {
      // Inbound calls or implementations from outside
      const inCalls = graph.getInboundEdges(node.id).filter((e) => e.relation === 'calls' || e.relation === 'implements' || e.relation === 'extends')
      if (inCalls.length === 0 && !isEntryPoint(node.filePath)) {
        unusedSymbols.push(node)
      }
    }
  }

  const deadCodeData: DeadCodeResult = {
    orphanFiles,
    unusedSymbols,
    totalOrphans: orphanFiles.length,
    totalUnusedSymbols: unusedSymbols.length,
  }

  let summary = ''
  if (orphanFiles.length === 0 && unusedSymbols.length === 0) {
    summary = '✅ Clean architecture: No dead code or orphan files detected.'
  } else {
    summary = `⚠️ Detected ${orphanFiles.length} orphan file(s) and ${unusedSymbols.length} unreachable symbol(s).`
  }

  return {
    target: scope ?? 'workspace',
    action: 'unused',
    rootNodes: [],
    nodes: [...orphanFiles, ...unusedSymbols],
    edges: [],
    summary,
    deadCode: deadCodeData,
  }
}
