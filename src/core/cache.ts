/**
 * High-performance incremental cache manager based on mtime and content hashing.
 * Supports in-memory caching and JSON disk snapshots (.dsh/lens-cache.json).
 * @module @trench-xinxin/dsh-tool-lens/core/cache
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { CacheSnapshot, FileDeltaStatus, FileIndexCache } from './types.ts'

const CACHE_VERSION = '1.0.0'

export class IncrementalCacheStore {
  private readonly cache = new Map<string, FileIndexCache>()

  /** Get cached index for a relative file path. */
  get(relPath: string): FileIndexCache | undefined {
    return this.cache.get(relPath)
  }

  /** Set or update cached index for a file. */
  set(relPath: string, fileCache: FileIndexCache): void {
    this.cache.set(relPath, fileCache)
  }

  /** Check if a file is in cache. */
  has(relPath: string): boolean {
    return this.cache.has(relPath)
  }

  /** Delete a file from cache. */
  delete(relPath: string): boolean {
    return this.cache.delete(relPath)
  }

  /** Clear all cached file data. */
  clear(): void {
    this.cache.clear()
  }

  /** Total number of cached files. */
  get size(): number {
    return this.cache.size
  }

  /** List of all relative file paths currently cached. */
  getAllFiles(): string[] {
    return Array.from(this.cache.keys())
  }

  /**
   * Fast SHA-256 content hashing.
   */
  computeHash(content: string): string {
    return createHash('sha256').update(content).digest('hex')
  }

  /**
   * Determines if a file has changed by inspecting mtime and fallback content hash.
   * @param relPath - Relative path from rootDir
   * @param rootDir - Workspace root directory
   */
  checkFileStatus(
    relPath: string,
    rootDir: string,
  ): { status: FileDeltaStatus; mtimeMs: number; hash?: string; content?: string } {
    const absPath = join(rootDir, relPath)

    if (!existsSync(absPath)) {
      return {
        status: this.cache.has(relPath) ? 'deleted' : 'unchanged',
        mtimeMs: 0,
      }
    }

    try {
      const stats = statSync(absPath)
      if (!stats.isFile()) {
        return { status: 'deleted', mtimeMs: 0 }
      }

      const currentMtime = stats.mtimeMs
      const cached = this.cache.get(relPath)

      if (!cached) {
        const content = readFileSync(absPath, 'utf8')
        const hash = this.computeHash(content)
        return { status: 'added', mtimeMs: currentMtime, hash, content }
      }

      // Fast-path: mtime identical -> unchanged
      if (cached.mtimeMs === currentMtime) {
        return { status: 'unchanged', mtimeMs: currentMtime, hash: cached.hash }
      }

      // Fallback: mtime changed, inspect content hash
      const content = readFileSync(absPath, 'utf8')
      const hash = this.computeHash(content)

      if (cached.hash === hash) {
        // Content is identical despite timestamp change (e.g. git checkout/touch)
        cached.mtimeMs = currentMtime
        return { status: 'unchanged', mtimeMs: currentMtime, hash }
      }

      return { status: 'modified', mtimeMs: currentMtime, hash, content }
    } catch {
      return { status: 'deleted', mtimeMs: 0 }
    }
  }

  /**
   * Serializes current cache to disk JSON snapshot.
   * @param snapshotPath - File path (e.g. `<workspace>/.dsh/lens-cache.json`)
   * @param rootDir - Workspace root directory
   */
  saveToFile(snapshotPath: string, rootDir: string): boolean {
    try {
      const parentDir = dirname(snapshotPath)
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true })
      }

      const filesObj: Record<string, FileIndexCache> = {}
      for (const [key, value] of this.cache.entries()) {
        filesObj[key] = value
      }

      const snapshot: CacheSnapshot = {
        version: CACHE_VERSION,
        timestamp: Date.now(),
        rootDir,
        files: filesObj,
      }

      writeFileSync(snapshotPath, JSON.stringify(snapshot), 'utf8')
      return true
    } catch {
      return false
    }
  }

  /**
   * Loads cache snapshot from disk JSON file.
   * @param snapshotPath - File path to load
   */
  loadFromFile(snapshotPath: string): boolean {
    if (!existsSync(snapshotPath)) return false

    try {
      const content = readFileSync(snapshotPath, 'utf8')
      const snapshot = JSON.parse(content) as CacheSnapshot

      if (snapshot.version !== CACHE_VERSION || !snapshot.files) {
        return false
      }

      this.cache.clear()
      for (const [key, val] of Object.entries(snapshot.files)) {
        this.cache.set(key, val)
      }

      return true
    } catch {
      return false
    }
  }
}
