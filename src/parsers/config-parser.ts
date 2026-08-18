/**
 * tsconfig.json, pyproject.toml, go.mod, and Cargo.toml path mapping & module resolver.
 * @module @trench-xinxin/dsh-tool-lens/parsers/config-parser
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, normalize, relative, resolve } from 'node:path'

export const SUPPORTED_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.vue', '.svelte',
  '.py',
  '.go',
  '.rs',
]

export interface PathMappingRule {
  pattern: RegExp
  prefix: string
  targets: string[]
}

export class ConfigParser {
  private readonly baseUrl: string
  private readonly pathRules: PathMappingRule[] = []
  private goModuleName?: string
  private rustCrateName?: string

  constructor(private readonly rootDir: string) {
    this.baseUrl = rootDir
    this.loadTsConfig()
    this.loadGoMod()
    this.loadCargoToml()
  }

  private loadTsConfig(): void {
    const tsconfigPath = join(this.rootDir, 'tsconfig.json')
    const jsconfigPath = join(this.rootDir, 'jsconfig.json')
    const configPath = existsSync(tsconfigPath)
      ? tsconfigPath
      : existsSync(jsconfigPath)
        ? jsconfigPath
        : null

    if (!configPath) return

    try {
      const rawContent = readFileSync(configPath, 'utf8')
      const sanitized = rawContent.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '')
      const parsed = JSON.parse(sanitized)
      const opts = parsed.compilerOptions

      if (!opts) return

      const base = opts.baseUrl ? resolve(this.rootDir, opts.baseUrl) : this.rootDir

      if (opts.paths && typeof opts.paths === 'object') {
        for (const [key, rawTargets] of Object.entries(opts.paths)) {
          const targets = Array.isArray(rawTargets)
            ? rawTargets.map((t) => resolve(base, t))
            : [resolve(base, String(rawTargets))]

          if (key.includes('*')) {
            const prefix = key.slice(0, key.indexOf('*'))
            const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            const pattern = new RegExp(`^${escaped}(.*)$`)
            this.pathRules.push({ pattern, prefix, targets })
          } else {
            const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            const pattern = new RegExp(`^${escaped}$`)
            this.pathRules.push({ pattern, prefix: key, targets })
          }
        }
      }
    } catch {
      // Gracefully ignore malformed tsconfig
    }
  }

  private loadGoMod(): void {
    const goModPath = join(this.rootDir, 'go.mod')
    if (existsSync(goModPath)) {
      try {
        const content = readFileSync(goModPath, 'utf8')
        const match = content.match(/^module\s+([^\s\r\n]+)/m)
        if (match) {
          this.goModuleName = match[1]
        }
      } catch {}
    }
  }

  private loadCargoToml(): void {
    const cargoPath = join(this.rootDir, 'Cargo.toml')
    if (existsSync(cargoPath)) {
      try {
        const content = readFileSync(cargoPath, 'utf8')
        const match = content.match(/\[package\][\s\S]*?name\s*=\s*"([^"]+)"/)
        if (match) {
          this.rustCrateName = match[1]
        }
      } catch {}
    }
  }

  getGoModuleName(): string | undefined {
    return this.goModuleName
  }

  getRustCrateName(): string | undefined {
    return this.rustCrateName
  }

  resolveAlias(specifier: string): string[] {
    for (const rule of this.pathRules) {
      const match = specifier.match(rule.pattern)
      if (match) {
        const wildcard = match[1] ?? ''
        return rule.targets.map((target) => target.replace('*', wildcard))
      }
    }
    return []
  }
}

/**
 * Resolves a module specifier to a relative file path in the workspace.
 * Supports TypeScript, Vue, Svelte, Python, Go, and Rust.
 */
export function resolveModulePath(
  currentRelPath: string,
  moduleSpecifier: string,
  rootDir: string,
  configParser?: ConfigParser,
  knownFiles?: Iterable<string>,
): string | null {
  if (!moduleSpecifier) return null

  const currentDir = dirname(join(rootDir, currentRelPath))

  // 1. Python dot import (e.g. from .utils import x, from ..core import y)
  if (currentRelPath.endsWith('.py')) {
    const pyResolved = resolvePythonModulePath(currentRelPath, moduleSpecifier, rootDir, knownFiles)
    if (pyResolved) return pyResolved
  }

  // 2. Go module import (e.g. import "my-module/pkg/db")
  if (currentRelPath.endsWith('.go')) {
    if (configParser?.getGoModuleName()) {
      const goMod = configParser.getGoModuleName()!
      if (moduleSpecifier.startsWith(goMod)) {
        const subPath = moduleSpecifier.slice(goMod.length).replace(/^\/+/, '')
        const candidateDir = join(rootDir, subPath)
        if (existsSync(candidateDir)) {
          return normalize(relative(rootDir, candidateDir))
        }
        return normalize(subPath)
      }
    }
    // Non-module or mock pkg/db
    if (knownFiles) {
      for (const known of knownFiles) {
        if (known.includes(moduleSpecifier)) {
          return known
        }
      }
    }
  }

  // 3. Rust crate:: or super:: / self:: import
  if (currentRelPath.endsWith('.rs')) {
    const rustResolved = resolveRustModulePath(currentRelPath, moduleSpecifier, rootDir, knownFiles)
    if (rustResolved) return rustResolved
  }

  // 4. Relative paths (./ or ../)
  if (moduleSpecifier.startsWith('./') || moduleSpecifier.startsWith('../')) {
    const rawTarget = resolve(currentDir, moduleSpecifier)
    const exact = probeFileVariants(rawTarget)
    if (exact) {
      return normalize(relative(rootDir, exact))
    }

    const candidateRel = normalize(relative(rootDir, rawTarget))
    if (knownFiles) {
      for (const known of knownFiles) {
        if (known === candidateRel) return known
      }
      for (const ext of SUPPORTED_EXTENSIONS) {
        const withExt = `${candidateRel}${ext}`
        for (const known of knownFiles) {
          if (known === withExt) return known
        }
      }
    }

    for (const ext of SUPPORTED_EXTENSIONS) {
      if (candidateRel.endsWith(ext)) {
        return candidateRel
      }
    }
  }

  // 5. tsconfig / jsconfig paths alias matching
  if (configParser) {
    const candidatePaths = configParser.resolveAlias(moduleSpecifier)
    for (const cand of candidatePaths) {
      const exact = probeFileVariants(cand)
      if (exact) {
        return normalize(relative(rootDir, exact))
      }
      const candidateRel = normalize(relative(rootDir, cand))
      if (knownFiles) {
        for (const known of knownFiles) {
          if (known === candidateRel) return known
        }
        for (const ext of SUPPORTED_EXTENSIONS) {
          const withExt = `${candidateRel}${ext}`
          for (const known of knownFiles) {
            if (known === withExt) return known
          }
        }
      }
    }
  }

  // 6. Root-relative or known files matching
  if (knownFiles) {
    for (const ext of SUPPORTED_EXTENSIONS) {
      const candidate = `${moduleSpecifier}${ext}`
      for (const known of knownFiles) {
        if (known === candidate || known.endsWith(`/${candidate}`) || known.endsWith(`/${moduleSpecifier}`)) {
          return known
        }
      }
    }
  }

  return null
}

function resolvePythonModulePath(
  currentRelPath: string,
  specifier: string,
  rootDir: string,
  knownFiles?: Iterable<string>,
): string | null {
  const currentDir = dirname(join(rootDir, currentRelPath))

  // Relative import (leading dots)
  if (specifier.startsWith('.')) {
    let dotCount = 0
    while (specifier.charAt(dotCount) === '.') {
      dotCount++
    }
    const remainder = specifier.slice(dotCount).replace(/\./g, '/')
    let targetBaseDir = currentDir
    for (let i = 1; i < dotCount; i++) {
      targetBaseDir = dirname(targetBaseDir)
    }

    const candidatePath = remainder ? join(targetBaseDir, remainder) : targetBaseDir
    const exact = probeFileVariants(candidatePath, ['.py'])
    if (exact) return normalize(relative(rootDir, exact))

    const candidateRel = normalize(relative(rootDir, candidatePath))
    if (knownFiles) {
      for (const known of knownFiles) {
        if (known === candidateRel || known === `${candidateRel}.py`) return known
      }
    }
    return candidateRel.endsWith('.py') ? candidateRel : `${candidateRel}.py`
  }

  // Absolute dot-delimited import (e.g. services.user_service)
  const relFromRoot = specifier.replace(/\./g, '/')
  const candidateFromRoot = join(rootDir, relFromRoot)
  const exactRoot = probeFileVariants(candidateFromRoot, ['.py'])
  if (exactRoot) return normalize(relative(rootDir, exactRoot))

  if (knownFiles) {
    for (const known of knownFiles) {
      if (known === relFromRoot || known === `${relFromRoot}.py`) return known
    }
  }

  return `${relFromRoot}.py`
}

function resolveRustModulePath(
  currentRelPath: string,
  specifier: string,
  rootDir: string,
  knownFiles?: Iterable<string>,
): string | null {
  const cleanSpec = specifier.replace(/^crate::/, '').replace(/^self::/, '')
  const relPathSegments = cleanSpec.split('::')

  // Check prefix segments against known files
  for (let i = relPathSegments.length; i >= 1; i--) {
    const subSegments = relPathSegments.slice(0, i)
    const filePath = subSegments.join('/')

    // Look in src/
    const candidateInSrc = join(rootDir, 'src', filePath)
    const exactSrc = probeFileVariants(candidateInSrc, ['.rs'])
    if (exactSrc) return normalize(relative(rootDir, exactSrc))

    const candidateRelSrc = normalize(`src/${filePath}.rs`)
    if (knownFiles) {
      for (const known of knownFiles) {
        if (known === candidateRelSrc) return known
      }
    }

    // Look directly under rootDir
    const candidateRoot = join(rootDir, filePath)
    const exactRoot = probeFileVariants(candidateRoot, ['.rs'])
    if (exactRoot) return normalize(relative(rootDir, exactRoot))

    const candidateRelRoot = normalize(`${filePath}.rs`)
    if (knownFiles) {
      for (const known of knownFiles) {
        if (known === candidateRelRoot) return known
      }
    }
  }

  return null
}

/**
 * Checks for direct file existence, file with extensions, or index files in a folder.
 */
function probeFileVariants(basePath: string, customExtensions?: string[]): string | null {
  const extensions = customExtensions ?? SUPPORTED_EXTENSIONS

  // Exact match
  if (existsSync(basePath)) {
    const stat = statSync(basePath)
    if (stat.isFile()) return basePath
    if (stat.isDirectory()) {
      for (const ext of extensions) {
        const indexFile = join(basePath, `index${ext}`)
        if (existsSync(indexFile) && statSync(indexFile).isFile()) {
          return indexFile
        }
        // Python __init__.py
        const pyInit = join(basePath, `__init__.py`)
        if (existsSync(pyInit) && statSync(pyInit).isFile()) {
          return pyInit
        }
        // Rust mod.rs
        const rustMod = join(basePath, `mod.rs`)
        if (existsSync(rustMod) && statSync(rustMod).isFile()) {
          return rustMod
        }
      }
    }
  }

  // Appending extensions
  for (const ext of extensions) {
    const candidate = `${basePath}${ext}`
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate
    }
  }

  return null
}
