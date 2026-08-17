/**
 * Model-facing `lens` tool for symbol call hierarchies, file dependencies,
 * and refactoring impact graphs using deterministic AST analysis.
 *
 * Namespace plugin (named exports, no default export).
 * @module @deepseek-ai/dsh-tool-lens
 */

import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { CodeAnalyzer } from './analyzer.ts'
import { formatGraphMarkdown, presentLensCall, presentLensResult } from './render.ts'
import type { CodeGraphResult, LensArgs } from './types.ts'

export * from './types.ts'
export * from './graph.ts'
export * from './analyzer.ts'
export * from './render.ts'

/** Cordis plugin name for diagnostics and composition. */
export const name = 'tool-lens'

/** Services required by this plugin. */
export const inject = ['tools', 'systemPrompt']

/** System prompt guidance describing the purpose and usage of the tool. */
export const LENS_PROMPT_TEXT =
  'Use the lens tool when you need to understand symbol relationships across files, such as tracking callers/callees of a function, exploring module dependencies, or evaluating the blast radius of a refactoring change.'

/** Plugin configuration schema. */
export interface Config {
  /** Maximum default graph traversal depth (default: 3). */
  maxDepth?: number
}

export const Config: Schema<Config> = Schema.object({
  maxDepth: Schema.number().default(3).description('Default maximum graph search depth'),
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

  // 1. Inject guidance into the system prompt
  ctx.systemPrompt?.section({
    name: 'tool:lens',
    order: 120,
    text: LENS_PROMPT_TEXT,
  })

  // 2. Register the model-facing tool
  ctx.tools.register(
    defineTool({
      name: 'lens',
      description:
        'Inspect symbol call hierarchies, file dependencies, and refactoring impact graphs using AST static analysis.',
      parameters: {
        action: {
          type: 'string',
          required: true,
          enum: ['dependencies', 'call_graph', 'impact'],
          description:
            'The type of graph query: dependencies (file/module imports), call_graph (function callers/callees), or impact (blast radius analysis).',
        },
        target: {
          type: 'string',
          required: true,
          description: 'Target symbol name, function name, or relative file path to analyze.',
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
        render: (_args, result) => [{ type: 'text', text: formatGraphMarkdown(result as CodeGraphResult) }],
      },
      presentCall: (args) => presentLensCall(args as LensArgs),
      presentResult: (args, res) => presentLensResult(args as LensArgs, res),
      async execute(args, options) {
        const lensArgs = args as LensArgs
        const workspaceRoot = process.cwd()
        const scanDir = lensArgs.scope ? resolve(workspaceRoot, lensArgs.scope) : workspaceRoot

        // 1. AST Indexing
        const analyzer = new CodeAnalyzer()
        const store = await analyzer.indexDirectory(scanDir, options.signal)

        // 2. Match Target Nodes
        const matchedNodes = store.findNodes(args.target)

        if (matchedNodes.length === 0) {
          const emptyResult: CodeGraphResult = {
            target: args.target,
            action: args.action,
            rootNodes: [],
            nodes: [],
            edges: [],
            summary: `No matching symbol or file found for target '${args.target}' in scope '${args.scope ?? '.'}'.`,
          }
          return emptyResult
        }

        // 3. Graph Traversal
        const depth = Math.min(args.depth ?? defaultDepth, 5)
        let direction: 'inbound' | 'outbound' | 'both' = args.direction ?? 'both'

        if (args.action === 'impact') {
          // Impact analysis tracks upstream dependants/callers
          direction = args.direction ?? 'inbound'
        } else if (args.action === 'dependencies') {
          // Dependencies default to imports/dependencies
          direction = args.direction ?? 'outbound'
        }

        const rootIds = matchedNodes.map((n) => n.id)
        const traversal = store.traverse(rootIds, direction, depth)

        // 4. Summarize
        let summary = ''
        if (args.action === 'impact') {
          const impactedFiles = new Set(traversal.nodes.map((n) => n.filePath)).size
          summary = `Modifying '${args.target}' potentially impacts ${impactedFiles} file(s) and ${traversal.nodes.length} symbol(s).`
        } else if (args.action === 'dependencies') {
          summary = `Explored ${traversal.nodes.length} node(s) across depth ${depth}.`
        } else {
          summary = `Discovered ${traversal.nodes.length} connected symbol(s) in call graph.`
        }

        const result: CodeGraphResult = {
          target: args.target,
          action: args.action,
          rootNodes: matchedNodes,
          nodes: traversal.nodes,
          edges: traversal.edges,
          summary,
        }

        return result
      },
    }),
  )
}
