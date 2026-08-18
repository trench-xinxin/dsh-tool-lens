/**
 * Full-stack cross-language API contract linker (connecting frontend HTTP calls to backend route handlers).
 * @module @trench-xinxin/dsh-tool-lens/analytics/api-contracts
 */

import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import type { GraphStore } from '../core/graph.ts'
import type {
  ApiContractMatch,
  ApiContractsResult,
  CodeGraphNode,
  CodeGraphResult,
} from '../core/types.ts'

export interface ExtractedClientApiCall {
  filePath: string
  url: string
  method: string
  callerSymbolName?: string
  line: number
}

export interface ExtractedServerEndpoint {
  filePath: string
  url: string
  method: string
  handlerSymbolName: string
  line: number
}

/**
 * Normalizes an API path for fuzzy matching (e.g. `/api/v1/users/{id}` vs `/api/v1/users/:id` -> `/api/v1/users/*`).
 */
export function normalizeApiPath(path: string): string {
  return path
    .trim()
    .replace(/\{[^}]+\}/g, '*')
    .replace(/:[a-zA-Z0-9_]+/g, '*')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
}

/**
 * Scans files in the indexed workspace to match frontend client calls to backend server handlers.
 */
export function buildApiContractsResult(
  graph: GraphStore,
  workspaceRootOrFiles?: string | Map<string, string>,
  explicitFileSources?: Map<string, string>,
): CodeGraphResult {
  const clientCalls: ExtractedClientApiCall[] = []
  const serverEndpoints: ExtractedServerEndpoint[] = []

  let workspaceRoot: string | undefined
  let fileSources: Map<string, string> | undefined

  if (workspaceRootOrFiles instanceof Map) {
    fileSources = workspaceRootOrFiles
  } else if (typeof workspaceRootOrFiles === 'string') {
    workspaceRoot = workspaceRootOrFiles
    fileSources = explicitFileSources
  }

  const sourcesToScan = new Map<string, string>()

  if (fileSources && fileSources.size > 0) {
    for (const [p, content] of fileSources.entries()) {
      sourcesToScan.set(p, content)
    }
  } else if (workspaceRoot) {
    // Read sources from graph files on disk
    for (const node of graph.getAllNodes()) {
      if (node.kind === 'file' || node.kind === 'component') {
        try {
          const absPath = isAbsolute(node.filePath)
            ? node.filePath
            : resolve(workspaceRoot, node.filePath)
          const content = readFileSync(absPath, 'utf8')
          sourcesToScan.set(node.filePath, content)
        } catch {}
      }
    }
  }

  for (const [filePath, content] of sourcesToScan.entries()) {
    const lines = content.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      const lineNum = i + 1

      // 1. Frontend Client Requests (fetch, axios, request, http)
      const clientMatch = line.match(
        /\b(?:axios\.(get|post|put|delete|patch)|request\.(get|post|put|delete|patch)|http\.(get|post|put|delete|patch)|fetch)\s*\(\s*['"`]([^'"`]+)['"`]/i,
      )
      if (clientMatch) {
        const method = (clientMatch[1] || clientMatch[2] || clientMatch[3] || 'GET').toUpperCase()
        const url = clientMatch[4]!
        if (url.startsWith('/') || url.startsWith('http') || url.includes('/api/')) {
          clientCalls.push({
            filePath,
            url,
            method,
            line: lineNum,
          })
        }
      }

      // 2. Java Spring Routing: @GetMapping("/api/users"), @PostMapping("/api/orders"), @RequestMapping("/api/...")
      const springMatch = line.match(
        /@(?:(Get|Post|Put|Delete|Patch)Mapping|RequestMapping)\s*\(\s*(?:(?:value|path)\s*=\s*)?["']([^"']+)["']/i,
      )
      if (springMatch) {
        const method = (springMatch[1] || 'ALL').toUpperCase()
        const url = springMatch[2]!
        serverEndpoints.push({
          filePath,
          url,
          method,
          handlerSymbolName: `Handler:${lineNum}`,
          line: lineNum,
        })
      }

      // 3. Python FastAPI / Flask: @app.get("/api/users"), @router.post("/api/orders")
      const pyMatch = line.match(
        /@(?:app|router|api)\.(get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']/i,
      )
      if (pyMatch) {
        const method = pyMatch[1]!.toUpperCase()
        const url = pyMatch[2]!
        serverEndpoints.push({
          filePath,
          url,
          method,
          handlerSymbolName: `Handler:${lineNum}`,
          line: lineNum,
        })
      }

      // 4. Go Gin / Echo: r.GET("/api/users", handler), e.POST("/api/orders", ...)
      const goMatch = line.match(
        /\b(?:r|router|e|app|group|engine)\.(GET|POST|PUT|DELETE|PATCH)\s*\(\s*["']([^"']+)["']/i,
      )
      if (goMatch) {
        const method = goMatch[1]!.toUpperCase()
        const url = goMatch[2]!
        serverEndpoints.push({
          filePath,
          url,
          method,
          handlerSymbolName: `Handler:${lineNum}`,
          line: lineNum,
        })
      }
    }
  }

  const matchedContracts: ApiContractMatch[] = []
  const matchedClientIndices = new Set<number>()
  const matchedServerIndices = new Set<number>()

  for (let cIdx = 0; cIdx < clientCalls.length; cIdx++) {
    const client = clientCalls[cIdx]!
    const clientNorm = normalizeApiPath(client.url)

    for (let sIdx = 0; sIdx < serverEndpoints.length; sIdx++) {
      const server = serverEndpoints[sIdx]!
      const serverNorm = normalizeApiPath(server.url)

      if (
        clientNorm === serverNorm &&
        (server.method === 'ALL' || client.method === server.method)
      ) {
        matchedClientIndices.add(cIdx)
        matchedServerIndices.add(sIdx)

        const clientNode: CodeGraphNode = {
          id: `${client.filePath}#api_call:${client.line}`,
          name: `${client.method} ${client.url}`,
          kind: 'function',
          filePath: client.filePath,
          line: client.line,
        }

        const serverNode: CodeGraphNode = {
          id: `${server.filePath}#route_handler:${server.line}`,
          name: `[Handler] ${server.method} ${server.url}`,
          kind: 'function',
          filePath: server.filePath,
          line: server.line,
        }

        matchedContracts.push({
          urlPattern: client.url,
          httpMethod: client.method,
          clientCallNode: clientNode,
          serverHandlerNode: serverNode,
        })

        // Auto-stitch full-stack virtual edge into the graph!
        graph.addNode(clientNode)
        graph.addNode(serverNode)
        graph.addEdge({
          from: clientNode.id,
          to: serverNode.id,
          relation: 'calls',
        })
      }
    }
  }

  const unmatchedClientCalls: CodeGraphNode[] = clientCalls
    .filter((_, idx) => !matchedClientIndices.has(idx))
    .map((c) => ({
      id: `${c.filePath}#api_call:${c.line}`,
      name: `${c.method} ${c.url}`,
      kind: 'function',
      filePath: c.filePath,
      line: c.line,
    }))

  const unmatchedServerEndpoints: CodeGraphNode[] = serverEndpoints
    .filter((_, idx) => !matchedServerIndices.has(idx))
    .map((s) => ({
      id: `${s.filePath}#route_handler:${s.line}`,
      name: `[Handler] ${s.method} ${s.url}`,
      kind: 'function',
      filePath: s.filePath,
      line: s.line,
    }))

  const apiContractsResult: ApiContractsResult = {
    matchedContracts,
    unmatchedClientCalls,
    unmatchedServerEndpoints,
    totalContracts: matchedContracts.length,
  }

  const summary = `Full-stack API contracts audit: Discovered ${matchedContracts.length} connected end-to-end HTTP contract(s), with ${unmatchedClientCalls.length} unmatched client call(s) and ${unmatchedServerEndpoints.length} uninvoked server endpoint(s).`

  return {
    target: 'api_contracts',
    action: 'api_contracts',
    rootNodes: matchedContracts.map((m) => m.clientCallNode),
    nodes: [
      ...matchedContracts.map((m) => m.clientCallNode),
      ...matchedContracts.map((m) => m.serverHandlerNode),
    ],
    edges: matchedContracts.map((m) => ({
      from: m.clientCallNode.id,
      to: m.serverHandlerNode.id,
      relation: 'calls',
    })),
    summary,
    apiContracts: apiContractsResult,
  }
}
