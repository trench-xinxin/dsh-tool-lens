/**
 * AST extraction and symbol analysis engine for TypeScript and JavaScript codebases.
 * @module @deepseek-ai/dsh-tool-codegraph/analyzer
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join, normalize, relative, resolve } from 'node:path'
import ts from 'typescript'
import { GraphStore } from './graph.ts'
import type { CodeGraphNode, CodeNodeKind } from './types.ts'

const SUPPORTED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const IGNORED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'lib', 'build', '.dsh', 'coverage'])

interface PendingCall {
  callerNode: CodeGraphNode
  calleeName: string
  sourceRelPath: string
}

/**
 * Parses files in a workspace into an AST and populates a GraphStore
 * with file, symbol, import, and call hierarchy relations.
 */
export class CodeAnalyzer {
  private readonly graph: GraphStore
  private readonly fileSymbols = new Map<string, Map<string, CodeGraphNode>>()
  private readonly fileImports = new Map<string, Set<string>>()
  private readonly pendingCalls: PendingCall[] = []

  constructor(graph?: GraphStore) {
    this.graph = graph ?? new GraphStore()
  }

  /** Get the underlying GraphStore. */
  getGraph(): GraphStore {
    return this.graph
  }

  /**
   * Recursively scans and analyzes all source files under the root directory.
   * @param rootDir - Root directory to index.
   * @param signal - Optional abort signal to cancel long scans.
   */
  async indexDirectory(rootDir: string, signal?: AbortSignal): Promise<GraphStore> {
    const files = this.collectSourceFiles(rootDir, signal)

    for (const filePath of files) {
      if (signal?.aborted) {
        break
      }
      try {
        const content = readFileSync(filePath, 'utf8')
        const relPath = normalize(relative(rootDir, filePath))
        this.analyzeSourceCode(relPath, content, rootDir, false)
      } catch {
        // Skip unparseable or binary files gracefully
      }
    }

    this.linkAllCalls()
    return this.graph
  }

  /**
   * Analyzes single file content and registers symbols and relations into the graph.
   * @param relPath - Relative path of the file from workspace root.
   * @param content - File text content.
   * @param rootDir - Workspace root directory.
   * @param autoLink - Whether to resolve calls immediately (defaults to true for standalone use).
   */
  analyzeSourceCode(relPath: string, content: string, rootDir: string, autoLink = true): void {
    const fileNodeId = relPath
    const fileNode: CodeGraphNode = {
      id: fileNodeId,
      name: relPath,
      kind: 'file',
      filePath: relPath,
    }
    this.graph.addNode(fileNode)

    const sourceFile = ts.createSourceFile(
      relPath,
      content,
      ts.ScriptTarget.Latest,
      true,
      relPath.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )

    let symbolsInFile = this.fileSymbols.get(relPath)
    if (!symbolsInFile) {
      symbolsInFile = new Map<string, CodeGraphNode>()
      this.fileSymbols.set(relPath, symbolsInFile)
    }

    let importsInFile = this.fileImports.get(relPath)
    if (!importsInFile) {
      importsInFile = new Set<string>()
      this.fileImports.set(relPath, importsInFile)
    }

    const definedFunctionsInFile: CodeGraphNode[] = []

    // Pass 1: Extract imports, exports, and top-level definitions
    const visitDefinitions = (node: ts.Node) => {
      // 1. Imports
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const importTarget = node.moduleSpecifier.text
        const resolvedPath = this.resolveModulePath(relPath, importTarget, rootDir)

        if (resolvedPath) {
          importsInFile!.add(resolvedPath)
          const targetFileNode: CodeGraphNode = {
            id: resolvedPath,
            name: resolvedPath,
            kind: 'file',
            filePath: resolvedPath,
          }
          this.graph.addNode(targetFileNode)
          this.graph.addEdge({
            from: fileNodeId,
            to: resolvedPath,
            relation: 'imports',
          })
        }
      }

      // 2. Function Declarations
      if (ts.isFunctionDeclaration(node) && node.name) {
        const symbolNode = this.createSymbolNode(sourceFile, node, node.name.text, 'function', relPath)
        this.graph.addNode(symbolNode)
        this.graph.addEdge({ from: fileNodeId, to: symbolNode.id, relation: 'contains' })
        symbolsInFile!.set(symbolNode.name, symbolNode)
        definedFunctionsInFile.push(symbolNode)
      }

      // 3. Class Declarations & Methods
      if (ts.isClassDeclaration(node) && node.name) {
        const classNode = this.createSymbolNode(sourceFile, node, node.name.text, 'class', relPath)
        this.graph.addNode(classNode)
        this.graph.addEdge({ from: fileNodeId, to: classNode.id, relation: 'contains' })
        symbolsInFile!.set(classNode.name, classNode)

        for (const member of node.members) {
          if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
            const memberShortName = member.name.text
            const fullMethodName = `${classNode.name}.${memberShortName}`
            const methodNode = this.createSymbolNode(
              sourceFile,
              member,
              fullMethodName,
              'function',
              relPath,
            )
            this.graph.addNode(methodNode)
            this.graph.addEdge({ from: classNode.id, to: methodNode.id, relation: 'contains' })
            symbolsInFile!.set(fullMethodName, methodNode)
            if (!symbolsInFile!.has(memberShortName)) {
              symbolsInFile!.set(memberShortName, methodNode)
            }
            definedFunctionsInFile.push(methodNode)
          }
        }
      }

      // 4. Variable Functions (const foo = () => {})
      if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
            const funcNode = this.createSymbolNode(sourceFile, decl, decl.name.text, 'function', relPath)
            this.graph.addNode(funcNode)
            this.graph.addEdge({ from: fileNodeId, to: funcNode.id, relation: 'contains' })
            symbolsInFile!.set(funcNode.name, funcNode)
            definedFunctionsInFile.push(funcNode)
          }
        }
      }

      // 5. Interface & Type Declarations
      if (ts.isInterfaceDeclaration(node)) {
        const ifaceNode = this.createSymbolNode(sourceFile, node, node.name.text, 'interface', relPath)
        this.graph.addNode(ifaceNode)
        this.graph.addEdge({ from: fileNodeId, to: ifaceNode.id, relation: 'contains' })
        symbolsInFile!.set(ifaceNode.name, ifaceNode)
      }

      if (ts.isTypeAliasDeclaration(node)) {
        const typeNode = this.createSymbolNode(sourceFile, node, node.name.text, 'type', relPath)
        this.graph.addNode(typeNode)
        this.graph.addEdge({ from: fileNodeId, to: typeNode.id, relation: 'contains' })
        symbolsInFile!.set(typeNode.name, typeNode)
      }

      ts.forEachChild(node, visitDefinitions)
    }

    visitDefinitions(sourceFile)

    // Pass 2: Collect function calls inside each defined function in this file
    for (const funcNode of definedFunctionsInFile) {
      this.extractCallsInSymbol(sourceFile, funcNode, (calleeName) => {
        this.pendingCalls.push({
          callerNode: funcNode,
          calleeName,
          sourceRelPath: relPath,
        })
      })
    }

    if (autoLink) {
      this.linkAllCalls()
    }
  }

  /** Resolves all pending function and method calls across files. */
  private linkAllCalls(): void {
    for (const call of this.pendingCalls) {
      let targetNode: CodeGraphNode | undefined

      // 1. Lookup in same file
      const sameFileSymbols = this.fileSymbols.get(call.sourceRelPath)
      targetNode = sameFileSymbols?.get(call.calleeName)

      // 2. Lookup in directly imported files
      if (!targetNode) {
        const importedPaths = this.fileImports.get(call.sourceRelPath)
        if (importedPaths) {
          for (const importedPath of importedPaths) {
            const importedSymbols = this.fileSymbols.get(importedPath)
            if (importedSymbols?.has(call.calleeName)) {
              targetNode = importedSymbols.get(call.calleeName)
              break
            }
          }
        }
      }

      // 3. Global lookup in all indexed files
      if (!targetNode) {
        for (const [, symbols] of this.fileSymbols) {
          if (symbols.has(call.calleeName)) {
            targetNode = symbols.get(call.calleeName)
            break
          }
        }
      }

      if (targetNode && targetNode.id !== call.callerNode.id) {
        this.graph.addEdge({
          from: call.callerNode.id,
          to: targetNode.id,
          relation: 'calls',
        })
      }
    }

    this.pendingCalls.length = 0
  }

  private createSymbolNode(
    sourceFile: ts.SourceFile,
    node: ts.Node,
    name: string,
    kind: CodeNodeKind,
    filePath: string,
  ): CodeGraphNode {
    const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd())
    const line = start.line + 1
    const endLine = end.line + 1

    return {
      id: `${filePath}#${name}:${line}`,
      name,
      kind,
      filePath,
      line,
      endLine,
    }
  }

  private extractCallsInSymbol(
    sourceFile: ts.SourceFile,
    symbolNode: CodeGraphNode,
    onCall: (calleeName: string) => void,
  ): void {
    const visitCalls = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const expr = node.expression
        if (ts.isIdentifier(expr)) {
          onCall(expr.text)
        } else if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) {
          onCall(expr.name.text)
          if (ts.isIdentifier(expr.expression)) {
            onCall(`${expr.expression.text}.${expr.name.text}`)
          }
        }
      }
      ts.forEachChild(node, visitCalls)
    }

    // Traverse the AST matching the symbol's line boundaries
    const visitRange = (node: ts.Node) => {
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
      const currentLine = start.line + 1
      if (symbolNode.line && symbolNode.endLine && currentLine >= symbolNode.line && currentLine <= symbolNode.endLine) {
        visitCalls(node)
      } else {
        ts.forEachChild(node, visitRange)
      }
    }

    visitRange(sourceFile)
  }

  private resolveModulePath(currentRelPath: string, importPath: string, rootDir: string): string | null {
    if (!importPath.startsWith('.')) {
      return null
    }

    const currentDir = dirname(join(rootDir, currentRelPath))
    const targetBase = resolve(currentDir, importPath)

    for (const ext of SUPPORTED_EXTENSIONS) {
      if (existsSync(targetBase + ext)) {
        return normalize(relative(rootDir, targetBase + ext))
      }
    }

    for (const ext of SUPPORTED_EXTENSIONS) {
      const indexCandidate = join(targetBase, 'index' + ext)
      if (existsSync(indexCandidate)) {
        return normalize(relative(rootDir, indexCandidate))
      }
    }

    if (existsSync(targetBase) && statSync(targetBase).isFile()) {
      return normalize(relative(rootDir, targetBase))
    }

    return normalize(relative(rootDir, targetBase))
  }

  private collectSourceFiles(dir: string, signal?: AbortSignal): string[] {
    const results: string[] = []
    if (!existsSync(dir)) return results

    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (signal?.aborted) break
      if (IGNORED_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) continue

      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        results.push(...this.collectSourceFiles(fullPath, signal))
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase()
        if (SUPPORTED_EXTENSIONS.has(ext)) {
          results.push(fullPath)
        }
      }
    }

    return results
  }
}
