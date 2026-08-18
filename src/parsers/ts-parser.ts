/**
 * AST extraction and symbol analysis engine for TypeScript, JavaScript, Vue SFC, and Svelte.
 * Handles Re-exports, OOP extends/implements heritage, Scope-Aware call resolution,
 * SFC template components, and high-performance incremental caching.
 * @module @trench-xinxin/dsh-tool-lens/parsers/ts-parser
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { extname, join, normalize, relative } from 'node:path'
import ts from 'typescript'
import { IncrementalCacheStore } from '../core/cache.ts'
import { GraphStore } from '../core/graph.ts'
import type {
  CodeGraphEdge,
  CodeGraphNode,
  CodeNodeKind,
  FileIndexCache,
  IncrementalIndexStats,
} from '../core/types.ts'
import { ConfigParser, resolveModulePath, SUPPORTED_EXTENSIONS } from './config-parser.ts'
import { DriverRegistry } from './driver.ts'
import { extractSFCBlocks } from './sfc-parser.ts'

const IGNORED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'lib', 'build', '.dsh', 'coverage'])

interface ImportBinding {
  importedName: string
  localName: string
  sourcePath: string
  isNamespace?: boolean
}

interface PendingCall {
  callerNode: CodeGraphNode
  calleeName: string
  calleeObject?: string
  sourceRelPath: string
}

interface PendingHeritage {
  sourceNode: CodeGraphNode
  targetName: string
  relation: 'extends' | 'implements'
  sourceRelPath: string
}

/**
 * Parses files in a workspace into an AST and populates a GraphStore
 * with file, component, symbol, import, extends, implements, and scope-aware call hierarchy relations.
 */
export class TSParser {
  private readonly graph: GraphStore
  private configParser?: ConfigParser
  private readonly cacheStore: IncrementalCacheStore
  private readonly driverRegistry = new DriverRegistry()
  private readonly fileSymbols = new Map<string, Map<string, CodeGraphNode>>()
  private readonly fileImports = new Map<string, Set<string>>()
  private readonly fileBindings = new Map<string, Map<string, ImportBinding>>()
  private readonly pendingCalls: PendingCall[] = []
  private readonly pendingHeritages: PendingHeritage[] = []

  constructor(graph?: GraphStore, cacheStore?: IncrementalCacheStore) {
    this.graph = graph ?? new GraphStore()
    this.cacheStore = cacheStore ?? new IncrementalCacheStore()
  }

  /** Get the underlying GraphStore. */
  getGraph(): GraphStore {
    return this.graph
  }

  /** Get the underlying IncrementalCacheStore. */
  getCacheStore(): IncrementalCacheStore {
    return this.cacheStore
  }

  /** Get the DriverRegistry. */
  getDriverRegistry(): DriverRegistry {
    return this.driverRegistry
  }

  /**
   * Recursively scans and analyzes all source files under the root directory with incremental caching.
   * @param rootDir - Root directory to index.
   * @param signal - Optional abort signal to cancel long scans.
   */
  async indexDirectory(rootDir: string, signal?: AbortSignal): Promise<GraphStore> {
    await this.indexDirectoryIncremental(rootDir, signal)
    return this.graph
  }

  /**
   * High-performance incremental directory indexing.
   * Reuses AST results for unchanged files and only parses modified/added files.
   */
  async indexDirectoryIncremental(
    rootDir: string,
    signal?: AbortSignal,
  ): Promise<IncrementalIndexStats> {
    const startTime = Date.now()
    this.configParser = new ConfigParser(rootDir)

    const diskFiles = this.collectSourceFiles(rootDir, signal)
    const diskFileRelSet = new Set<string>()

    let cachedCount = 0
    let indexedCount = 0
    let deletedCount = 0

    // 1. Process active disk files
    for (const filePath of diskFiles) {
      if (signal?.aborted) break
      const relPath = normalize(relative(rootDir, filePath))
      diskFileRelSet.add(relPath)

      const statusInfo = this.cacheStore.checkFileStatus(relPath, rootDir)

      if (statusInfo.status === 'unchanged') {
        const cached = this.cacheStore.get(relPath)
        if (cached) {
          this.restoreFromCache(cached)
          cachedCount++
          continue
        }
      }

      try {
        const content = statusInfo.content ?? readFileSync(filePath, 'utf8')
        this.graph.removeFile(relPath)
        this.removeFileFromMemoryIndex(relPath)
        this.analyzeSourceCode(relPath, content, rootDir, false)
        indexedCount++
      } catch {
        // Gracefully ignore unparseable files
      }
    }

    // 2. Handle deleted files
    for (const cachedFile of this.cacheStore.getAllFiles()) {
      if (!diskFileRelSet.has(cachedFile)) {
        this.graph.removeFile(cachedFile)
        this.removeFileFromMemoryIndex(cachedFile)
        this.cacheStore.delete(cachedFile)
        deletedCount++
      }
    }

    // 3. Link cross-file dependencies and calls
    this.linkAllCalls()
    this.linkAllHeritages()

    return {
      totalFiles: diskFiles.length,
      cachedFiles: cachedCount,
      indexedFiles: indexedCount,
      deletedFiles: deletedCount,
      durationMs: Date.now() - startTime,
    }
  }

  /**
   * Invalidates a single file and reloads it incrementally into the graph.
   */
  invalidateAndReloadFile(relPath: string, rootDir: string): void {
    if (!this.configParser) {
      this.configParser = new ConfigParser(rootDir)
    }

    const normRelPath = normalize(relPath)
    this.graph.removeFile(normRelPath)
    this.removeFileFromMemoryIndex(normRelPath)
    this.cacheStore.delete(normRelPath)

    const absPath = join(rootDir, normRelPath)
    if (existsSync(absPath)) {
      try {
        const content = readFileSync(absPath, 'utf8')
        this.analyzeSourceCode(normRelPath, content, rootDir, false)
      } catch {}
    }

    this.linkAllCalls()
    this.linkAllHeritages()
  }

  /**
   * Analyzes single file or SFC component content and registers symbols and relations into the graph.
   * @param relPath - Relative path of the file from workspace root.
   * @param content - File text content.
   * @param rootDir - Workspace root directory.
   * @param autoLink - Whether to resolve calls and heritages immediately.
   */
  analyzeSourceCode(relPath: string, content: string, rootDir: string, autoLink = true): void {
    if (!this.configParser) {
      this.configParser = new ConfigParser(rootDir)
    }

    const isSFC = relPath.endsWith('.vue') || relPath.endsWith('.svelte')
    const primaryKind: CodeNodeKind = isSFC ? 'component' : 'file'

    const fileNodeId = relPath
    const fileNode: CodeGraphNode = {
      id: fileNodeId,
      name: relPath,
      kind: primaryKind,
      filePath: relPath,
    }
    this.graph.addNode(fileNode)

    let codeToParse = content
    let templateComponents: string[] = []

    if (isSFC) {
      const sfcData = extractSFCBlocks(content, relPath)
      codeToParse = sfcData.scriptContent
      templateComponents = sfcData.templateComponents
    }

    const sourceFile = ts.createSourceFile(
      relPath,
      codeToParse,
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

    let bindingsInFile = this.fileBindings.get(relPath)
    if (!bindingsInFile) {
      bindingsInFile = new Map<string, ImportBinding>()
      this.fileBindings.set(relPath, bindingsInFile)
    }

    const definedFunctionsInFile: CodeGraphNode[] = []
    const fileNodes: CodeGraphNode[] = [fileNode]
    const fileEdges: CodeGraphEdge[] = []

    // Pass 1: Extract imports, re-exports, and top-level definitions
    const visitDefinitions = (node: ts.Node) => {
      // 1. Imports
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const importTarget = node.moduleSpecifier.text
        const resolvedPath = resolveModulePath(
          relPath,
          importTarget,
          rootDir,
          this.configParser,
          this.fileSymbols.keys(),
        )

        if (resolvedPath) {
          importsInFile!.add(resolvedPath)
          const targetFileNode: CodeGraphNode = {
            id: resolvedPath,
            name: resolvedPath,
            kind: resolvedPath.endsWith('.vue') || resolvedPath.endsWith('.svelte') ? 'component' : 'file',
            filePath: resolvedPath,
          }
          this.graph.addNode(targetFileNode)
          const importEdge: CodeGraphEdge = {
            from: fileNodeId,
            to: resolvedPath,
            relation: 'imports',
          }
          this.graph.addEdge(importEdge)
          fileEdges.push(importEdge)

          if (node.importClause) {
            if (node.importClause.name) {
              const localName = node.importClause.name.text
              bindingsInFile!.set(localName, {
                importedName: 'default',
                localName,
                sourcePath: resolvedPath,
              })
            }

            if (node.importClause.namedBindings) {
              if (ts.isNamedImports(node.importClause.namedBindings)) {
                for (const elem of node.importClause.namedBindings.elements) {
                  const importedName = elem.propertyName ? elem.propertyName.text : elem.name.text
                  const localName = elem.name.text
                  bindingsInFile!.set(localName, {
                    importedName,
                    localName,
                    sourcePath: resolvedPath,
                  })
                }
              } else if (ts.isNamespaceImport(node.importClause.namedBindings)) {
                const namespaceName = node.importClause.namedBindings.name.text
                bindingsInFile!.set(namespaceName, {
                  importedName: '*',
                  localName: namespaceName,
                  sourcePath: resolvedPath,
                  isNamespace: true,
                })
              }
            }
          }
        }
      }

      // 2. Re-exports
      if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const exportTarget = node.moduleSpecifier.text
        const resolvedPath = resolveModulePath(
          relPath,
          exportTarget,
          rootDir,
          this.configParser,
          this.fileSymbols.keys(),
        )

        if (resolvedPath) {
          importsInFile!.add(resolvedPath)
          const targetFileNode: CodeGraphNode = {
            id: resolvedPath,
            name: resolvedPath,
            kind: resolvedPath.endsWith('.vue') || resolvedPath.endsWith('.svelte') ? 'component' : 'file',
            filePath: resolvedPath,
          }
          this.graph.addNode(targetFileNode)
          const reExportEdge: CodeGraphEdge = {
            from: fileNodeId,
            to: resolvedPath,
            relation: 'imports',
          }
          this.graph.addEdge(reExportEdge)
          fileEdges.push(reExportEdge)

          if (node.exportClause && ts.isNamedExports(node.exportClause)) {
            for (const elem of node.exportClause.elements) {
              const originalName = elem.propertyName ? elem.propertyName.text : elem.name.text
              const exportedName = elem.name.text
              bindingsInFile!.set(exportedName, {
                importedName: originalName,
                localName: exportedName,
                sourcePath: resolvedPath,
              })
            }
          }
        }
      }

      // 3. Function Declarations
      if (ts.isFunctionDeclaration(node) && node.name) {
        const symbolNode = this.createSymbolNode(sourceFile, node, node.name.text, 'function', relPath)
        this.graph.addNode(symbolNode)
        const containsEdge: CodeGraphEdge = { from: fileNodeId, to: symbolNode.id, relation: 'contains' }
        this.graph.addEdge(containsEdge)
        fileNodes.push(symbolNode)
        fileEdges.push(containsEdge)
        symbolsInFile!.set(symbolNode.name, symbolNode)
        definedFunctionsInFile.push(symbolNode)
      }

      // 4. Class Declarations & Methods & OOP Heritage
      if (ts.isClassDeclaration(node) && node.name) {
        const classNode = this.createSymbolNode(sourceFile, node, node.name.text, 'class', relPath)
        this.graph.addNode(classNode)
        const containsEdge: CodeGraphEdge = { from: fileNodeId, to: classNode.id, relation: 'contains' }
        this.graph.addEdge(containsEdge)
        fileNodes.push(classNode)
        fileEdges.push(containsEdge)
        symbolsInFile!.set(classNode.name, classNode)

        if (node.heritageClauses) {
          for (const clause of node.heritageClauses) {
            const relation =
              clause.token === ts.SyntaxKind.ExtendsKeyword ? 'extends' : 'implements'
            for (const type of clause.types) {
              if (ts.isIdentifier(type.expression)) {
                this.pendingHeritages.push({
                  sourceNode: classNode,
                  targetName: type.expression.text,
                  relation,
                  sourceRelPath: relPath,
                })
              }
            }
          }
        }

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
            const methodContainsEdge: CodeGraphEdge = {
              from: classNode.id,
              to: methodNode.id,
              relation: 'contains',
            }
            this.graph.addEdge(methodContainsEdge)
            fileNodes.push(methodNode)
            fileEdges.push(methodContainsEdge)
            symbolsInFile!.set(fullMethodName, methodNode)
            if (!symbolsInFile!.has(memberShortName)) {
              symbolsInFile!.set(memberShortName, methodNode)
            }
            definedFunctionsInFile.push(methodNode)
          }
        }
      }

      // 5. Interface Declarations & Heritage
      if (ts.isInterfaceDeclaration(node)) {
        const ifaceNode = this.createSymbolNode(sourceFile, node, node.name.text, 'interface', relPath)
        this.graph.addNode(ifaceNode)
        const containsEdge: CodeGraphEdge = { from: fileNodeId, to: ifaceNode.id, relation: 'contains' }
        this.graph.addEdge(containsEdge)
        fileNodes.push(ifaceNode)
        fileEdges.push(containsEdge)
        symbolsInFile!.set(ifaceNode.name, ifaceNode)

        if (node.heritageClauses) {
          for (const clause of node.heritageClauses) {
            if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
              for (const type of clause.types) {
                if (ts.isIdentifier(type.expression)) {
                  this.pendingHeritages.push({
                    sourceNode: ifaceNode,
                    targetName: type.expression.text,
                    relation: 'extends',
                    sourceRelPath: relPath,
                  })
                }
              }
            }
          }
        }
      }

      // 6. Variable Functions / Reactive States
      if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            const isFunc =
              decl.initializer &&
              (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
            const kind: CodeNodeKind = isFunc ? 'function' : 'variable'
            const varNode = this.createSymbolNode(sourceFile, decl, decl.name.text, kind, relPath)
            this.graph.addNode(varNode)
            const containsEdge: CodeGraphEdge = { from: fileNodeId, to: varNode.id, relation: 'contains' }
            this.graph.addEdge(containsEdge)
            fileNodes.push(varNode)
            fileEdges.push(containsEdge)
            symbolsInFile!.set(varNode.name, varNode)
            if (isFunc) {
              definedFunctionsInFile.push(varNode)
            }
          }
        }
      }

      // 7. Type Alias Declarations
      if (ts.isTypeAliasDeclaration(node)) {
        const typeNode = this.createSymbolNode(sourceFile, node, node.name.text, 'type', relPath)
        this.graph.addNode(typeNode)
        const containsEdge: CodeGraphEdge = { from: fileNodeId, to: typeNode.id, relation: 'contains' }
        this.graph.addEdge(containsEdge)
        fileNodes.push(typeNode)
        fileEdges.push(containsEdge)
        symbolsInFile!.set(typeNode.name, typeNode)
      }

      ts.forEachChild(node, visitDefinitions)
    }

    visitDefinitions(sourceFile)

    // Pass 2: Collect function calls inside each defined function in this file
    const filePendingCalls: { callerId: string; calleeName: string; calleeObject?: string }[] = []
    for (const funcNode of definedFunctionsInFile) {
      this.extractCallsInSymbol(sourceFile, funcNode, (calleeName, calleeObject) => {
        this.pendingCalls.push({
          callerNode: funcNode,
          calleeName,
          calleeObject,
          sourceRelPath: relPath,
        })
        filePendingCalls.push({
          callerId: funcNode.id,
          calleeName,
          calleeObject,
        })
      })
    }

    // Pass 3: Process SFC template referenced components
    for (const compName of templateComponents) {
      const binding = bindingsInFile.get(compName)
      if (binding) {
        const targetComponentNode = this.graph.getNode(binding.sourcePath)
        if (targetComponentNode) {
          const usageEdge: CodeGraphEdge = {
            from: fileNodeId,
            to: targetComponentNode.id,
            relation: 'calls',
          }
          this.graph.addEdge(usageEdge)
          fileEdges.push(usageEdge)
        }
      }
    }

    // Pass 4: Save to Incremental Cache
    const bindingsObj: Record<string, ImportBinding> = {}
    for (const [k, v] of bindingsInFile.entries()) {
      bindingsObj[k] = v
    }

    const pendingHeritagesForFile = this.pendingHeritages
      .filter((h) => h.sourceRelPath === relPath)
      .map((h) => ({
        sourceId: h.sourceNode.id,
        targetName: h.targetName,
        relation: h.relation,
      }))

    const fileCache: FileIndexCache = {
      filePath: relPath,
      mtimeMs: Date.now(),
      hash: this.cacheStore.computeHash(content),
      nodes: fileNodes,
      edges: fileEdges,
      imports: Array.from(importsInFile),
      bindings: bindingsObj,
      pendingCalls: filePendingCalls,
      pendingHeritages: pendingHeritagesForFile,
    }
    this.cacheStore.set(relPath, fileCache)

    if (autoLink) {
      this.linkAllCalls()
      this.linkAllHeritages()
    }
  }

  /** Restores memory state and GraphStore from a cached file entry. */
  private restoreFromCache(cached: FileIndexCache): void {
    const relPath = cached.filePath

    // 1. Bulk add nodes and edges
    this.graph.bulkAdd(cached.nodes, cached.edges)

    // 2. Restore file symbols
    let symbols = this.fileSymbols.get(relPath)
    if (!symbols) {
      symbols = new Map<string, CodeGraphNode>()
      this.fileSymbols.set(relPath, symbols)
    }
    for (const node of cached.nodes) {
      if (node.kind !== 'file' && node.kind !== 'component') {
        symbols.set(node.name, node)
      }
    }

    // 3. Restore file imports
    let imports = this.fileImports.get(relPath)
    if (!imports) {
      imports = new Set<string>()
      this.fileImports.set(relPath, imports)
    }
    for (const imp of cached.imports) {
      imports.add(imp)
    }

    // 4. Restore file bindings
    let bindings = this.fileBindings.get(relPath)
    if (!bindings) {
      bindings = new Map<string, ImportBinding>()
      this.fileBindings.set(relPath, bindings)
    }
    for (const [k, v] of Object.entries(cached.bindings)) {
      bindings.set(k, v)
    }

    // 5. Restore pending calls
    for (const pc of cached.pendingCalls) {
      const callerNode = this.graph.getNode(pc.callerId)
      if (callerNode) {
        this.pendingCalls.push({
          callerNode,
          calleeName: pc.calleeName,
          calleeObject: pc.calleeObject,
          sourceRelPath: relPath,
        })
      }
    }

    // 6. Restore pending heritages
    for (const ph of cached.pendingHeritages) {
      const sourceNode = this.graph.getNode(ph.sourceId)
      if (sourceNode) {
        this.pendingHeritages.push({
          sourceNode,
          targetName: ph.targetName,
          relation: ph.relation,
          sourceRelPath: relPath,
        })
      }
    }
  }

  private removeFileFromMemoryIndex(relPath: string): void {
    this.fileSymbols.delete(relPath)
    this.fileImports.delete(relPath)
    this.fileBindings.delete(relPath)
  }

  /** Resolves all pending function and method calls across files using 4-tier scope awareness. */
  private linkAllCalls(): void {
    for (const call of this.pendingCalls) {
      let targetNode: CodeGraphNode | undefined

      const sameFileSymbols = this.fileSymbols.get(call.sourceRelPath)
      const fileBindings = this.fileBindings.get(call.sourceRelPath)

      // Tier 1: Local scope / same file / member method match
      if (!call.calleeObject) {
        targetNode = sameFileSymbols?.get(call.calleeName)
      } else {
        const qualifiedName = `${call.calleeObject}.${call.calleeName}`
        targetNode = sameFileSymbols?.get(qualifiedName) || sameFileSymbols?.get(call.calleeName)
      }

      // Tier 2: Explicit Import Binding (import { helper } from './util' or import defaultHelper from './util')
      if (!targetNode && fileBindings) {
        if (!call.calleeObject) {
          const binding = fileBindings.get(call.calleeName)
          if (binding && !binding.isNamespace) {
            const targetFileSymbols = this.fileSymbols.get(binding.sourcePath)
            targetNode =
              targetFileSymbols?.get(binding.importedName) ||
              targetFileSymbols?.get(call.calleeName)
          }
        } else {
          // Tier 3: Namespace import call (e.g. Util.helper() where Util is import * as Util from './util')
          const nsBinding = fileBindings.get(call.calleeObject)
          if (nsBinding && nsBinding.isNamespace) {
            const targetFileSymbols = this.fileSymbols.get(nsBinding.sourcePath)
            targetNode = targetFileSymbols?.get(call.calleeName)
          }
        }
      }

      // Tier 4: Global fallback only if uniquely matched or confident
      if (!targetNode) {
        const matches: CodeGraphNode[] = []
        for (const [, symbols] of this.fileSymbols) {
          if (symbols.has(call.calleeName)) {
            matches.push(symbols.get(call.calleeName)!)
          }
        }
        if (matches.length === 1) {
          targetNode = matches[0]
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

  /** Resolves all pending extends and implements OOP relationships. */
  private linkAllHeritages(): void {
    for (const item of this.pendingHeritages) {
      let targetNode: CodeGraphNode | undefined

      const sameFileSymbols = this.fileSymbols.get(item.sourceRelPath)
      targetNode = sameFileSymbols?.get(item.targetName)

      if (!targetNode) {
        const fileBindings = this.fileBindings.get(item.sourceRelPath)
        const binding = fileBindings?.get(item.targetName)
        if (binding) {
          const targetFileSymbols = this.fileSymbols.get(binding.sourcePath)
          targetNode =
            targetFileSymbols?.get(binding.importedName) ||
            targetFileSymbols?.get(item.targetName)
        }
      }

      if (!targetNode) {
        for (const [, symbols] of this.fileSymbols) {
          if (symbols.has(item.targetName)) {
            targetNode = symbols.get(item.targetName)
            break
          }
        }
      }

      if (targetNode) {
        this.graph.addEdge({
          from: item.sourceNode.id,
          to: targetNode.id,
          relation: item.relation,
        })
      }
    }

    this.pendingHeritages.length = 0
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
    onCall: (calleeName: string, calleeObject?: string) => void,
  ): void {
    const visitCalls = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const expr = node.expression
        if (ts.isIdentifier(expr)) {
          onCall(expr.text)
        } else if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) {
          const methodName = expr.name.text
          if (ts.isIdentifier(expr.expression)) {
            const objectName = expr.expression.text
            onCall(methodName, objectName)
          } else {
            onCall(methodName)
          }
        }
      }
      ts.forEachChild(node, visitCalls)
    }

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

  private collectSourceFiles(dir: string, signal?: AbortSignal): string[] {
    const results: string[] = []
    if (!existsSync(dir)) return results

    const entries = readdirSync(dir, { withFileTypes: true })
    const supportedSet = new Set(SUPPORTED_EXTENSIONS)

    for (const entry of entries) {
      if (signal?.aborted) break
      if (IGNORED_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) continue

      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        results.push(...this.collectSourceFiles(fullPath, signal))
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase()
        if (supportedSet.has(ext)) {
          results.push(fullPath)
        }
      }
    }

    return results
  }
}
