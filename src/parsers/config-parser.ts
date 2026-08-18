/**
 * tsconfig.json and jsconfig.json path alias resolver for TypeScript projects.
 * @module @trench-xinxin/dsh-tool-lens/parsers/config-parser
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, normalize, relative, resolve } from 'node:path'

export const SUPPORTED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

export interface PathMappingRule {
  pattern: RegExp
  targets: string[]
}

/**
 * Parses tsconfig.json / jsconfig.json to extract baseUrl and path alias mappings.
 */
export class ConfigParser {
  private baseUrl: string = '.'
  private readonly mappings: PathMappingRule[] = []

  constructor(rootDir: string) {
    this.loadConfig(rootDir)
  }

  /** Load and parse tsconfig.json or jsconfig.json in the specified root directory. */
  private loadConfig(rootDir: string): void {
    const candidates = ['tsconfig.json', 'jsconfig.json']
    let configPath: string | null = null

    for (const candidate of candidates) {
      const fullPath = join(rootDir, candidate)
      if (existsSync(fullPath)) {
        configPath = fullPath
        break
      }
    }

    if (!configPath) return

    try {
      const content = readFileSync(configPath, 'utf8')
      // Strip comments (simple regex for JSON with comments)
      const cleanJson = content.replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, '$1')
      const parsed = JSON.parse(cleanJson)
      const compilerOptions = parsed.compilerOptions || {}

      this.baseUrl = compilerOptions.baseUrl ? join(rootDir, compilerOptions.baseUrl) : rootDir

      if (compilerOptions.paths && typeof compilerOptions.paths === 'object') {
        for (const [key, rawTargets] of Object.entries(compilerOptions.paths)) {
          const targets = Array.isArray(rawTargets) ? (rawTargets as string[]) : []
          if (key.includes('*')) {
            // Wildcard pattern: e.g. "@/*" -> "^@/(.*)$"
            const escaped = key.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace('*', '(.*)')
            this.mappings.push({
              pattern: new RegExp(`^${escaped}$`),
              targets,
            })
          } else {
            // Exact alias: e.g. "@utils" -> "^@utils$"
            const escaped = key.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
            this.mappings.push({
              pattern: new RegExp(`^${escaped}$`),
              targets,
            })
          }
        }
      }
    } catch {
      // Gracefully ignore parse errors
    }
  }

  /**
   * Resolves a module specifier against path mappings.
   * @param specifier - e.g. "@/components/Button" or "@utils"
   * @param rootDir - Workspace root directory
   */
  resolveAlias(specifier: string, rootDir: string): string[] {
    const candidates: string[] = []

    for (const rule of this.mappings) {
      const match = specifier.match(rule.pattern)
      if (match) {
        const starCapture = match[1] ?? ''
        for (const target of rule.targets) {
          const replaced = target.replace('*', starCapture)
          const targetAbs = resolve(this.baseUrl, replaced)
          candidates.push(targetAbs)
        }
      }
    }

    return candidates
  }
}

/**
 * Resolves a module specifier (relative or path alias) to a workspace relative file path.
 */
export function resolveModulePath(
  currentRelPath: string,
  importPath: string,
  rootDir: string,
  configParser?: ConfigParser,
  knownFiles?: Iterable<string>,
): string | null {
  const currentDir = dirname(join(rootDir, currentRelPath))

  // 1. Try Relative Path
  if (importPath.startsWith('.')) {
    const targetBase = resolve(currentDir, importPath)

    // 1.1 Match known files in memory
    if (knownFiles) {
      for (const known of knownFiles) {
        const knownAbs = resolve(rootDir, known)
        if (knownAbs === targetBase) {
          return normalize(known)
        }
        for (const ext of SUPPORTED_EXTENSIONS) {
          if (knownAbs === targetBase + ext || knownAbs === join(targetBase, 'index' + ext)) {
            return normalize(known)
          }
        }
      }
    }

    // 1.2 Probe file on physical disk
    const match = probeFile(targetBase)
    if (match) {
      return normalize(relative(rootDir, match))
    }

    // 1.3 Pure relative normalization fallback
    const computedRel = normalize(relative(rootDir, targetBase))
    return computedRel
  }

  // 2. Try Path Mapping / Aliases
  if (configParser) {
    const aliasCandidates = configParser.resolveAlias(importPath, rootDir)
    for (const candidate of aliasCandidates) {
      if (knownFiles) {
        for (const known of knownFiles) {
          const knownAbs = resolve(rootDir, known)
          if (knownAbs === candidate) {
            return normalize(known)
          }
          for (const ext of SUPPORTED_EXTENSIONS) {
            if (knownAbs === candidate + ext || knownAbs === join(candidate, 'index' + ext)) {
              return normalize(known)
            }
          }
        }
      }

      const match = probeFile(candidate)
      if (match) {
        return normalize(relative(rootDir, match))
      }

      const computedRel = normalize(relative(rootDir, candidate))
      return computedRel
    }
  }

  return null
}

/** Probe for file existence with supported extensions and index file fallbacks. */
function probeFile(basePath: string): string | null {
  // Direct file check (if extension was explicitly provided)
  if (existsSync(basePath)) {
    try {
      if (statSync(basePath).isFile()) {
        return basePath
      }
    } catch {}
  }

  // Probe with extension
  for (const ext of SUPPORTED_EXTENSIONS) {
    const candidate = basePath + ext
    if (existsSync(candidate)) {
      try {
        if (statSync(candidate).isFile()) {
          return candidate
        }
      } catch {}
    }
  }

  // Probe with directory index
  for (const ext of SUPPORTED_EXTENSIONS) {
    const indexCandidate = join(basePath, 'index' + ext)
    if (existsSync(indexCandidate)) {
      try {
        if (statSync(indexCandidate).isFile()) {
          return indexCandidate
        }
      } catch {}
    }
  }

  return null
}
