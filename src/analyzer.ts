/**
 * AST extraction and symbol analysis facade for TypeScript and JavaScript codebases.
 * Integrated with IncrementalCacheStore and LensWatcher.
 * @module @trench-xinxin/dsh-tool-lens/analyzer
 */

import { IncrementalCacheStore } from './core/cache.ts'
import { GraphStore } from './core/graph.ts'
import type { IncrementalIndexStats } from './core/types.ts'
import { TSParser } from './parsers/ts-parser.ts'
import { LensWatcher } from './parsers/watcher.ts'

/**
 * Facade providing high-level directory indexing, single-file AST parsing,
 * incremental caching, and workspace watching.
 */
export class CodeAnalyzer {
  private readonly parser: TSParser
  private watcher: LensWatcher | null = null

  constructor(graph?: GraphStore, cacheStore?: IncrementalCacheStore) {
    this.parser = new TSParser(graph, cacheStore)
  }

  /** Get the underlying GraphStore. */
  getGraph(): GraphStore {
    return this.parser.getGraph()
  }

  /** Get the underlying IncrementalCacheStore. */
  getCacheStore(): IncrementalCacheStore {
    return this.parser.getCacheStore()
  }

  /**
   * Recursively scans and analyzes all source files under the root directory.
   * Leverages incremental cache by default for sub-20ms warm queries.
   * @param rootDir - Root directory to index.
   * @param signal - Optional abort signal to cancel long scans.
   * @param options - Optional flags (e.g., forceReindex to bypass cache).
   */
  async indexDirectory(
    rootDir: string,
    signal?: AbortSignal,
    options?: { forceReindex?: boolean },
  ): Promise<GraphStore> {
    if (options?.forceReindex) {
      this.parser.getCacheStore().clear()
      this.parser.getGraph().clear()
    }
    return this.parser.indexDirectory(rootDir, signal)
  }

  /**
   * Runs incremental directory indexing and returns execution statistics.
   */
  async indexDirectoryIncremental(
    rootDir: string,
    signal?: AbortSignal,
  ): Promise<IncrementalIndexStats> {
    return this.parser.indexDirectoryIncremental(rootDir, signal)
  }

  /**
   * Analyzes single file content and registers symbols and relations into the graph.
   * @param relPath - Relative path of the file from workspace root.
   * @param content - File text content.
   * @param rootDir - Workspace root directory.
   * @param autoLink - Whether to resolve calls and heritages immediately.
   */
  analyzeSourceCode(relPath: string, content: string, rootDir: string, autoLink = true): void {
    this.parser.analyzeSourceCode(relPath, content, rootDir, autoLink)
  }

  /**
   * Hot-reloads a single file incrementally upon modification.
   */
  invalidateAndReloadFile(relPath: string, rootDir: string): void {
    this.parser.invalidateAndReloadFile(relPath, rootDir)
  }

  /**
   * Creates and starts a filesystem watcher to keep the AST graph synchronized in real-time.
   */
  createWatcher(rootDir: string, debounceMs = 100): LensWatcher {
    if (this.watcher) {
      this.watcher.close()
    }

    this.watcher = new LensWatcher(rootDir, {
      debounceMs,
      onFilesChanged: (changedRelPaths) => {
        for (const relPath of changedRelPaths) {
          this.parser.invalidateAndReloadFile(relPath, rootDir)
        }
      },
    })

    this.watcher.start()
    return this.watcher
  }

  /** Closes any active workspace watcher. */
  closeWatcher(): void {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
  }
}
