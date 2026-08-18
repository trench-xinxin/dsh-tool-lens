/**
 * Workspace file change watcher with debounce and directory filter.
 * Automatically synchronizes AST graph state during active development.
 * @module @trench-xinxin/dsh-tool-lens/parsers/watcher
 */

import { existsSync, watch, type FSWatcher } from 'node:fs'
import { extname, normalize } from 'node:path'
import { SUPPORTED_EXTENSIONS } from './config-parser.ts'

const IGNORED_PATH_SEGMENTS = ['node_modules', '.git', 'dist', 'lib', 'build', '.dsh', 'coverage']

export interface WatcherOptions {
  debounceMs?: number
  onFilesChanged: (changedRelPaths: string[]) => void | Promise<void>
}

export class LensWatcher {
  private watcher: FSWatcher | null = null
  private readonly pendingChanges = new Set<string>()
  private debounceTimer: NodeJS.Timeout | null = null
  private readonly debounceMs: number
  private readonly onFilesChanged: (changedRelPaths: string[]) => void | Promise<void>
  private isClosed = false

  constructor(private readonly rootDir: string, options: WatcherOptions) {
    this.debounceMs = options.debounceMs ?? 100
    this.onFilesChanged = options.onFilesChanged
  }

  /** Starts watching the root directory recursively. */
  start(): boolean {
    if (this.watcher || this.isClosed || !existsSync(this.rootDir)) {
      return false
    }

    try {
      this.watcher = watch(this.rootDir, { recursive: true }, (_eventType, filename) => {
        if (!filename) return
        const normalized = normalize(filename)

        // Ignore non-source files and excluded directories
        for (const segment of IGNORED_PATH_SEGMENTS) {
          if (normalized.includes(segment)) return
        }

        const ext = extname(normalized).toLowerCase()
        if (!SUPPORTED_EXTENSIONS.includes(ext) && !normalized.endsWith('tsconfig.json')) {
          return
        }

        this.pendingChanges.add(normalized)
        this.scheduleFlush()
      })
      return true
    } catch {
      return false
    }
  }

  /** Closes the active watcher. */
  close(): void {
    this.isClosed = true
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
    this.pendingChanges.clear()
  }

  private scheduleFlush(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    this.debounceTimer = setTimeout(() => {
      if (this.pendingChanges.size === 0) return
      const paths = Array.from(this.pendingChanges)
      this.pendingChanges.clear()
      this.onFilesChanged(paths)
    }, this.debounceMs)
  }
}
