import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ToolsService from '@deepseek-ai/dsh-tools'
import SystemPromptService from '@deepseek-ai/dsh-system-prompt'
import * as ToolLens from '../src/index.ts'
import {
  CodeAnalyzer,
  GraphStore,
  formatGraphMarkdown,
  presentLensCall,
  presentLensResult,
} from '../src/index.ts'
import type { CodeGraphResult, LensArgs } from '../src/types.ts'

describe('GraphStore', () => {
  it('stores nodes and directed edges correctly', () => {
    const store = new GraphStore()

    store.addNode({ id: 'a.ts', name: 'a.ts', kind: 'file', filePath: 'a.ts' })
    store.addNode({ id: 'b.ts', name: 'b.ts', kind: 'file', filePath: 'b.ts' })
    store.addNode({ id: 'c.ts', name: 'c.ts', kind: 'file', filePath: 'c.ts' })

    store.addEdge({ from: 'a.ts', to: 'b.ts', relation: 'imports' })
    store.addEdge({ from: 'b.ts', to: 'c.ts', relation: 'imports' })

    expect(store.size).toBe(3)
    expect(store.getNode('a.ts')?.name).toBe('a.ts')

    // Outbound traversal from a.ts with depth 1
    const depth1 = store.traverse(['a.ts'], 'outbound', 1)
    expect(depth1.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['a.ts', 'b.ts']))
    expect(depth1.nodes.find((n) => n.id === 'c.ts')).toBeUndefined()

    // Outbound traversal from a.ts with depth 2
    const depth2 = store.traverse(['a.ts'], 'outbound', 2)
    expect(depth2.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['a.ts', 'b.ts', 'c.ts']))

    // Inbound traversal from c.ts with depth 2
    const inbound = store.traverse(['c.ts'], 'inbound', 2)
    expect(inbound.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['c.ts', 'b.ts', 'a.ts']))
  })

  it('finds nodes by query string', () => {
    const store = new GraphStore()
    store.addNode({
      id: 'src/auth.ts#login:10',
      name: 'login',
      kind: 'function',
      filePath: 'src/auth.ts',
      line: 10,
    })

    expect(store.findNodes('login')).toHaveLength(1)
    expect(store.findNodes('auth.ts')).toHaveLength(1)
    expect(store.findNodes('nonexistent')).toHaveLength(0)
  })
})

describe('CodeAnalyzer', () => {
  it('extracts imports, functions, classes, and intra-file calls', () => {
    const analyzer = new CodeAnalyzer()
    const code = `
      import { util } from './util.ts'

      export function helper() {
        return 42
      }

      export function main() {
        helper()
      }

      export class Service {
        run() {
          helper()
        }
      }
    `

    analyzer.analyzeSourceCode('src/main.ts', code, '/root')
    const graph = analyzer.getGraph()

    expect(graph.getNode('src/main.ts')).toBeDefined()
    expect(graph.findNodes('helper')).toHaveLength(1)
    expect(graph.findNodes('main')).toHaveLength(1)
    expect(graph.findNodes('Service')).toHaveLength(1)
    expect(graph.findNodes('Service.run')).toHaveLength(1)
    // Short-name lookup for member method
    expect(graph.findNodes('run')).toHaveLength(1)
    // Suffix path lookup
    expect(graph.findNodes('main.ts')).toHaveLength(1)

    // Verify main calls helper
    const mainNode = graph.findNodes('main')[0]!
    const helperNode = graph.findNodes('helper')[0]!
    const traversal = graph.traverse([mainNode.id], 'outbound', 1)

    expect(traversal.nodes.map((n) => n.id)).toContain(helperNode.id)
    expect(traversal.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: mainNode.id,
          to: helperNode.id,
          relation: 'calls',
        }),
      ]),
    )

    // Verify Service.run calls helper
    const serviceRunNode = graph.findNodes('Service.run')[0]!
    const runTraversal = graph.traverse([serviceRunNode.id], 'outbound', 1)
    expect(runTraversal.nodes.map((n) => n.id)).toContain(helperNode.id)
  })
})

describe('Presenters & Markdown Render', () => {
  it('formats graph result into structured markdown', () => {
    const sampleResult: CodeGraphResult = {
      target: 'main',
      action: 'call_graph',
      rootNodes: [{ id: 'src/main.ts#main:5', name: 'main', kind: 'function', filePath: 'src/main.ts', line: 5 }],
      nodes: [
        { id: 'src/main.ts#main:5', name: 'main', kind: 'function', filePath: 'src/main.ts', line: 5 },
        { id: 'src/main.ts#helper:2', name: 'helper', kind: 'function', filePath: 'src/main.ts', line: 2 },
      ],
      edges: [{ from: 'src/main.ts#main:5', to: 'src/main.ts#helper:2', relation: 'calls' }],
      summary: 'Found 2 node(s)',
    }

    const md = formatGraphMarkdown(sampleResult)
    expect(md).toContain('### Lens: call_graph for `main`')
    expect(md).toContain('**Root Node(s):**')
    expect(md).toContain('**Relationships & Calls:**')
    expect(md).toContain('`src/main.ts#main:5` --[calls]--> `src/main.ts#helper:2`')
  })

  it('produces valid pure call and result cards', () => {
    const args: LensArgs = { action: 'dependencies', target: 'src/index.ts' }
    const callView = presentLensCall(args)
    expect(callView.card).toBe('generic')
    if (callView.card === 'generic') {
      expect(callView.kind).toBe('search')
    }

    const resultView = presentLensResult(args, {
      content: [{ type: 'text', text: 'Result content' }],
      isError: false,
    })
    expect(resultView.card).toBe('generic')
    expect(resultView.title).toContain('dependencies')
  })
})

describe('Plugin Registration', () => {
  it('registers and executes lens tool onto ctx.tools', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPromptService)
    await ctx.plugin(ToolsService)
    await ctx.plugin(ToolLens, { maxDepth: 4 })

    const tool = ctx.tools.get('lens')
    expect(tool).toBeDefined()
    expect(tool?.name).toBe('lens')
    expect(tool?.description).toContain('AST static analysis')

    const signal = new AbortController().signal
    const rawResult = await ctx.tools.execute({
      signal,
      callId: 'call-1' as never,
      name: 'lens',
      arguments: {
        action: 'dependencies',
        target: 'src/index.ts',
        scope: 'packages/lens/tool-lens',
      },
    })
    expect(rawResult.isError).toBe(false)
    const result = rawResult.value as unknown as CodeGraphResult

    expect(result.action).toBe('dependencies')
    expect(result.rootNodes.length).toBeGreaterThan(0)
    expect(result.nodes.length).toBeGreaterThan(0)

    // Test impact analysis
    const rawImpact = await ctx.tools.execute({
      signal,
      callId: 'call-2' as never,
      name: 'lens',
      arguments: {
        action: 'impact',
        target: 'src/types.ts',
        scope: 'packages/lens/tool-lens',
      },
    })
    expect(rawImpact.isError).toBe(false)
    const impactResult = rawImpact.value as unknown as CodeGraphResult

    expect(impactResult.action).toBe('impact')
    expect(impactResult.summary).toContain('potentially impacts')

    // Test short-name member method query (like user session)
    const rawShortName = await ctx.tools.execute({
      signal,
      callId: 'call-short-name' as never,
      name: 'lens',
      arguments: {
        action: 'call_graph',
        target: 'analyzeSourceCode',
        scope: 'packages/lens/tool-lens',
      },
    })
    expect(rawShortName.isError).toBe(false)
    const shortNameResult = rawShortName.value as unknown as CodeGraphResult
    expect(shortNameResult.rootNodes.length).toBeGreaterThan(0)
    expect(shortNameResult.rootNodes[0]?.name).toBe('CodeAnalyzer.analyzeSourceCode')
    expect(shortNameResult.nodes.length).toBeGreaterThan(0)

    // Test nonexistent target
    const rawNonExistent = await ctx.tools.execute({
      signal,
      callId: 'call-3' as never,
      name: 'lens',
      arguments: {
        action: 'call_graph',
        target: 'nonExistentFunctionXYZ',
        scope: 'packages/lens/tool-lens',
      },
    })
    expect(rawNonExistent.isError).toBe(false)
    const nonExistent = rawNonExistent.value as unknown as CodeGraphResult

    expect(nonExistent.rootNodes).toHaveLength(0)
    expect(nonExistent.summary).toContain('No matching symbol')
  })
})
