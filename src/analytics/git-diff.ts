/**
 * Git diff incremental change impact analyzer and regression test recommender.
 * @module @trench-xinxin/dsh-tool-lens/analytics/git-diff
 */

import { execSync } from 'node:child_process'
import { normalize } from 'node:path'
import type { GraphStore } from '../core/graph.ts'
import type {
  CodeGraphNode,
  CodeGraphResult,
  GitDiffImpactResult,
} from '../core/types.ts'

function isTestFile(filePath: string): boolean {
  return (
    filePath.includes('.spec.') ||
    filePath.includes('.test.') ||
    filePath.includes('__tests__') ||
    filePath.endsWith('_test.go') ||
    filePath.endsWith('Test.java') ||
    filePath.endsWith('Tests.java')
  )
}

/**
 * Extracts changed files and symbols from git diff and calculates upstream impact.
 */
export function analyzeGitDiffImpact(
  graph: GraphStore,
  workspaceRoot: string,
  commit?: string,
  rawChangedFiles?: string[],
): CodeGraphResult {
  let changedFilePaths: string[] = []

  if (rawChangedFiles && rawChangedFiles.length > 0) {
    changedFilePaths = rawChangedFiles.map((f) => normalize(f))
  } else {
    try {
      if (commit) {
        const out = execSync(`git diff --name-only ${commit}`, {
          cwd: workspaceRoot,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore'],
        })
        changedFilePaths = out.split(/\r?\n/).map((f) => f.trim()).filter(Boolean)
      } else {
        // Uncommitted changes (staged + unstaged)
        const out = execSync('git status --porcelain', {
          cwd: workspaceRoot,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore'],
        })
        changedFilePaths = out
          .split(/\r?\n/)
          .map((line) => line.trim().slice(3))
          .filter(Boolean)
      }
    } catch {
      changedFilePaths = []
    }
  }

  // Deduplicate and normalize
  const uniqueChangedFiles = Array.from(new Set(changedFilePaths.map((f) => normalize(f))))

  const changedSymbolNodes: CodeGraphNode[] = []
  const affectedUpstreamFilesSet = new Set<string>()
  const breakingCallers: CodeGraphNode[] = []
  const affectedTestFilesSet = new Set<string>()

  // Locate all symbol nodes inside changed files
  for (const filePath of uniqueChangedFiles) {
    const fileNode = graph.getNode(filePath)
    if (fileNode) {
      changedSymbolNodes.push(fileNode)
    }

    const childSymbols = graph.findNodes(filePath)
    for (const sym of childSymbols) {
      if (sym.filePath === filePath && sym.kind !== 'file' && sym.kind !== 'component') {
        changedSymbolNodes.push(sym)
      }
    }
  }

  // Trace upstream callers and importers
  const changedNodeIds = changedSymbolNodes.map((n) => n.id)
  if (changedNodeIds.length > 0) {
    const traversal = graph.traverse(changedNodeIds, 'inbound', 3)

    for (const node of traversal.nodes) {
      if (!uniqueChangedFiles.includes(node.filePath)) {
        affectedUpstreamFilesSet.add(node.filePath)
        if (isTestFile(node.filePath)) {
          affectedTestFilesSet.add(node.filePath)
        }
      }
    }

    for (const edge of traversal.edges) {
      if (edge.relation === 'calls' && !uniqueChangedFiles.some((f) => edge.from.startsWith(f))) {
        const callerNode = graph.getNode(edge.from)
        if (callerNode && !breakingCallers.some((b) => b.id === callerNode.id)) {
          breakingCallers.push(callerNode)
        }
      }
    }
  }

  const affectedUpstreamFiles = Array.from(affectedUpstreamFilesSet)
  const affectedTestFiles = Array.from(affectedTestFilesSet)

  const diffImpact: GitDiffImpactResult = {
    changedFiles: uniqueChangedFiles,
    changedSymbols: changedSymbolNodes,
    affectedUpstreamFiles,
    affectedTestFiles,
    breakingCallers,
    totalChangedFiles: uniqueChangedFiles.length,
    totalAffectedFiles: affectedUpstreamFiles.length,
  }

  let summary = ''
  if (uniqueChangedFiles.length === 0) {
    summary = 'Working tree clean: No changed files detected in git diff.'
  } else {
    summary = `Git diff contains ${uniqueChangedFiles.length} modified file(s), impacting ${affectedUpstreamFiles.length} upstream file(s) across ${breakingCallers.length} breaking caller(s). Recommended ${affectedTestFiles.length} regression test file(s).`
  }

  return {
    target: commit ?? 'git-working-tree',
    action: 'diff_impact',
    rootNodes: changedSymbolNodes.slice(0, 10),
    nodes: [...changedSymbolNodes, ...breakingCallers],
    edges: [],
    summary,
    diffImpact,
  }
}
