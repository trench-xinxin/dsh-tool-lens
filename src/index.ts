/**
 * Model-facing `lens` tool for symbol call hierarchies, file dependencies,
 * circular dependency audit, architecture metrics, refactoring impact analysis,
 * pathfinding, dead code detection, architecture boundary linting,
 * git diff impact analysis, architecture slicing, and full-stack API contract tracing.
 *
 * Namespace plugin (named exports, no default export).
 * @module @trench-xinxin/dsh-tool-lens
 */

import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { CodeAnalyzer } from './analyzer.ts'
import { buildApiContractsResult } from './analytics/api-contracts.ts'
import { buildLintResult } from './analytics/architecture.ts'
import { buildCircularResult } from './analytics/circular.ts'
import { buildUnusedResult } from './analytics/deadcode.ts'
import { analyzeGitDiffImpact } from './analytics/git-diff.ts'
import { analyzeImpact } from './analytics/impact.ts'
import { buildMetricsResult } from './analytics/metrics.ts'
import { buildPathfindingResult } from './analytics/pathfinding.ts'
import { buildSliceResult } from './analytics/slicing.ts'
import { formatGraphMarkdown, presentLensCall, presentLensResult } from './render.ts'
import type { CodeGraphResult, LensArgs } from './types.ts'

export * from './core/types.ts'
export * from './core/graph.ts'
export * from './core/cache.ts'
export * from './parsers/config-parser.ts'
export * from './parsers/sfc-parser.ts'
export * from './parsers/python-parser.ts'
export * from './parsers/go-parser.ts'
export * from './parsers/rust-parser.ts'
export * from './parsers/java-parser.ts'
export * from './parsers/driver.ts'
export * from './parsers/ts-parser.ts'
export * from './parsers/watcher.ts'
export * from './analytics/circular.ts'
export * from './analytics/metrics.ts'
export * from './analytics/impact.ts'
export * from './analytics/pathfinding.ts'
export * from './analytics/deadcode.ts'
export * from './analytics/architecture.ts'
export * from './analytics/git-diff.ts'
export * from './analytics/slicing.ts'
export * from './analytics/api-contracts.ts'
export * from './render.ts'
export * from './analyzer.ts'

/** Cordis plugin name for diagnostics and composition. */
export const name = 'tool-lens'

/** Services required by this plugin. */
export const inject = ['tools', 'systemPrompt']

/** System prompt guidance describing the purpose and usage of the tool. */
export const LENS_PROMPT_TEXT =
  'Use the lens tool when you need to understand symbol relationships across files, tracking callers/callees, exploring module dependencies, auditing circular dependencies, evaluating architecture coupling metrics, tracing shortest call paths, discovering dead code, analyzing git diff changes, extracting domain architecture slices, connecting full-stack frontend-backend HTTP API contracts, or measuring the blast radius of refactoring.'

/** Plugin configuration schema. */
export interface Config {
  /** Maximum default graph traversal depth (default: 3). */
  maxDepth?: number
  /** Enable incremental caching for sub-20ms warm queries (default: true). */
  cache?: boolean
  /** Automatically watch workspace files for live graph updates (default: false). */
  watch?: boolean
}

export const Config: Schema<Config> = Schema.object({
  maxDepth: Schema.number().default(3).description('Default maximum graph search depth'),
  cache: Schema.boolean().default(true).description('Enable incremental mtime caching'),
  watch: Schema.boolean().default(false).description('Watch workspace source files for live graph updates'),
})

type ResolvedConfig = Required<Config>

/** Output JSON schema for defineTool runtime validation. */
const LENS_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    target: { type: 'string', required: true },
    action: { type: 'string', required: true },
    rootNodes: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          name: { type: 'string', required: true },
          kind: { type: 'string', required: true },
          filePath: { type: 'string', required: true },
          line: { type: 'integer' },
          endLine: { type: 'integer' },
        },
      },
    },
    nodes: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          name: { type: 'string', required: true },
          kind: { type: 'string', required: true },
          filePath: { type: 'string', required: true },
          line: { type: 'integer' },
          endLine: { type: 'integer' },
        },
      },
    },
    edges: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          from: { type: 'string', required: true },
          to: { type: 'string', required: true },
          relation: { type: 'string', required: true },
        },
      },
    },
    summary: { type: 'string', required: true },
    circularCycles: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          cycle: { type: 'array', items: { type: 'string' } },
          length: { type: 'integer' },
        },
      },
    },
    metrics: {
      type: 'object',
      additionalProperties: true,
    },
    impactTiers: {
      type: 'object',
      additionalProperties: true,
    },
    pathfinding: {
      type: 'object',
      additionalProperties: true,
    },
    deadCode: {
      type: 'object',
      additionalProperties: true,
    },
    architectureViolations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
      },
    },
    diffImpact: {
      type: 'object',
      additionalProperties: true,
    },
    sliceResult: {
      type: 'object',
      additionalProperties: true,
    },
    apiContracts: {
      type: 'object',
      additionalProperties: true,
    },
  },
} as const

/**
 * Register the `lens` tool and its system-prompt guidance.
 * @param ctx - Cordis Context with injected services.
 * @param config - Plugin configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = config as ResolvedConfig
  const defaultDepth = resolved.maxDepth ?? 3
  const useCache = resolved.cache ?? true
  const enableWatch = resolved.watch ?? false

  // 1. Session-level singleton analyzer for high-speed cache reuse across queries
  const analyzer = new CodeAnalyzer()

  if (enableWatch) {
    const workspaceRoot = process.cwd()
    analyzer.createWatcher(workspaceRoot)
  }

  // 2. Inject guidance into the system prompt
  ctx.systemPrompt?.section({
    name: 'tool:lens',
    order: 120,
    text: LENS_PROMPT_TEXT,
  })

  // 3. Register the model-facing tool
  ctx.tools.register(
    defineTool<LensArgs, CodeGraphResult>({
      name: 'lens',
      description:
        'Inspect symbol call hierarchies, file dependencies, circular dependencies, architecture metrics, shortest call paths, dead code, git diff changes, domain slices, full-stack API contracts, and refactoring impact graphs across TypeScript, Vue, Svelte, Python, Go, Rust, and Java codebases.',
      parameters: {
        action: {
          type: 'string',
          required: true,
          enum: [
            'dependencies',
            'call_graph',
            'impact',
            'circular',
            'metrics',
            'path',
            'unused',
            'lint',
            'diff_impact',
            'slice',
            'api_contracts',
          ],
          description:
            'The type of graph query: dependencies (file imports), call_graph (function calls), impact (blast radius), circular (cycle audit), metrics (coupling health), path (shortest invocation trace), unused (dead code audit), lint (layer boundary rules), diff_impact (git changes impact), slice (domain subgraph), or api_contracts (full-stack HTTP routing contracts).',
        },
        target: {
          type: 'string',
          description: 'Target symbol name, function name, relative file path, or domain seed to analyze.',
        },
        to: {
          type: 'string',
          description: 'Destination target symbol or file for pathfinding (action: path).',
        },
        rules: {
          type: 'string',
          description: 'JSON array string of architectural boundary rules (action: lint).',
        },
        commit: {
          type: 'string',
          description: 'Git commit hash or range to compare against (action: diff_impact).',
        },
        depth: {
          type: 'number',
          description: `Graph traversal depth (default: ${defaultDepth}, max: 5).`,
        },
        direction: {
          type: 'string',
          enum: ['inbound', 'outbound', 'both'],
          description:
            "Traversal direction: 'inbound' (callers/importers), 'outbound' (callees/imports), or 'both'.",
        },
        scope: {
          type: 'string',
          description: 'Subdirectory path to restrict the scan scope (defaults to workspace root).',
        },
      },
      output: {
        schema: LENS_OUTPUT_SCHEMA,
        render: (_args: LensArgs, result: CodeGraphResult) => [
          { type: 'text', text: formatGraphMarkdown(result) },
        ],
      },
      presentCall: (args: LensArgs) => presentLensCall(args),
      presentResult: (args: LensArgs, res: { content: readonly { type: string; text?: string }[]; isError: boolean }) =>
        presentLensResult(args, res),
      async execute(args: LensArgs, options: { signal?: AbortSignal }): Promise<CodeGraphResult> {
        const lensArgs = args as LensArgs
        const workspaceRoot = process.cwd()
        const scanDir = lensArgs.scope ? resolve(workspaceRoot, lensArgs.scope) : workspaceRoot

        // AST Indexing (Incremental with cache)
        const store = await analyzer.indexDirectory(scanDir, options.signal, {
          forceReindex: !useCache,
        })

        const targetQuery = lensArgs.target?.trim() ?? ''

        // 1. Action: Circular Dependency Audit
        if (lensArgs.action === 'circular') {
          return buildCircularResult(store, targetQuery, lensArgs.scope)
        }

        // 2. Action: Architecture Health Metrics
        if (lensArgs.action === 'metrics') {
          return buildMetricsResult(store, targetQuery)
        }

        // 3. Action: Dead Code & Unused Symbols Audit
        if (lensArgs.action === 'unused') {
          return buildUnusedResult(store, lensArgs.scope)
        }

        // 4. Action: Architecture Layer Rules Lint
        if (lensArgs.action === 'lint') {
          return buildLintResult(store, lensArgs.rules)
        }

        // 5. Action: Git Diff Impact Analysis
        if (lensArgs.action === 'diff_impact') {
          return analyzeGitDiffImpact(store, workspaceRoot, lensArgs.commit)
        }

        // 6. Action: Architecture Subgraph Slice
        if (lensArgs.action === 'slice') {
          if (!targetQuery) {
            return {
              target: '',
              action: 'slice',
              rootNodes: [],
              nodes: [],
              edges: [],
              summary: "Error: 'target' domain seed is required for action 'slice'.",
            }
          }
          const sliceHops = Math.min(lensArgs.depth ?? 2, 4)
          return buildSliceResult(store, targetQuery, sliceHops)
        }

        // 7. Action: Full-Stack Cross-Language API Contracts
        if (lensArgs.action === 'api_contracts') {
          return buildApiContractsResult(store)
        }

        // 8. Action: Pathfinding Shortest Invocation Chain
        if (lensArgs.action === 'path') {
          if (!targetQuery || !lensArgs.to) {
            return {
              target: targetQuery,
              action: 'path',
              rootNodes: [],
              nodes: [],
              edges: [],
              summary: "Error: Both 'target' (from) and 'to' parameters are required for action 'path'.",
            }
          }
          return buildPathfindingResult(store, targetQuery, lensArgs.to)
        }

        // 9. Actions requiring single target matching (impact, dependencies, call_graph)
        if (!targetQuery) {
          return {
            target: '',
            action: lensArgs.action,
            rootNodes: [],
            nodes: [],
            edges: [],
            summary: `Error: 'target' parameter is required for action '${lensArgs.action}'.`,
          }
        }

        const matchedNodes = store.findNodes(targetQuery)

        if (matchedNodes.length === 0) {
          const emptyResult: CodeGraphResult = {
            target: targetQuery,
            action: lensArgs.action,
            rootNodes: [],
            nodes: [],
            edges: [],
            summary: `No matching symbol or file found for target '${targetQuery}' in scope '${lensArgs.scope ?? '.'}'.`,
          }
          return emptyResult
        }

        const depth = Math.min(lensArgs.depth ?? defaultDepth, 5)

        // Handle Impact Blast Radius Action
        if (lensArgs.action === 'impact') {
          const impactAnalysis = analyzeImpact(store, targetQuery, depth)
          const rootIds = matchedNodes.map((n) => n.id)
          const traversal = store.traverse(rootIds, 'inbound', depth)

          return {
            target: targetQuery,
            action: 'impact',
            rootNodes: matchedNodes,
            nodes: traversal.nodes,
            edges: traversal.edges,
            summary: impactAnalysis.summary,
            impactTiers: impactAnalysis.impactTiers,
          }
        }

        // Handle standard dependencies / call_graph
        let direction: 'inbound' | 'outbound' | 'both' = lensArgs.direction ?? 'both'
        if (lensArgs.action === 'dependencies') {
          direction = lensArgs.direction ?? 'outbound'
        }

        const rootIds = matchedNodes.map((n) => n.id)
        const traversal = store.traverse(rootIds, direction, depth)

        let summary = ''
        if (lensArgs.action === 'dependencies') {
          summary = `Explored ${traversal.nodes.length} node(s) across depth ${depth}.`
        } else {
          summary = `Discovered ${traversal.nodes.length} connected symbol(s) in call graph.`
        }

        return {
          target: targetQuery,
          action: lensArgs.action,
          rootNodes: matchedNodes,
          nodes: traversal.nodes,
          edges: traversal.edges,
          summary,
        }
      },
    }),
  )
}
