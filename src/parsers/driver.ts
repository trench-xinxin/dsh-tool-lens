/**
 * Extensible Language Driver registry for multi-ecosystem AST analysis.
 * Supports TypeScript, JavaScript, Vue, Svelte, Python, Go, and Rust.
 * @module @trench-xinxin/dsh-tool-lens/parsers/driver
 */

import { extname } from 'node:path'
import type { LanguageDriver } from '../core/types.ts'

export class TSLanguageDriver implements LanguageDriver {
  readonly name = 'typescript'
  readonly extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] as const

  canHandle(filePath: string): boolean {
    const ext = extname(filePath).toLowerCase()
    return this.extensions.includes(ext as any)
  }
}

export class SFCLanguageDriver implements LanguageDriver {
  readonly name = 'sfc'
  readonly extensions = ['.vue', '.svelte'] as const

  canHandle(filePath: string): boolean {
    const ext = extname(filePath).toLowerCase()
    return this.extensions.includes(ext as any)
  }
}

export class PythonLanguageDriver implements LanguageDriver {
  readonly name = 'python'
  readonly extensions = ['.py'] as const

  canHandle(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.py')
  }
}

export class GoLanguageDriver implements LanguageDriver {
  readonly name = 'go'
  readonly extensions = ['.go'] as const

  canHandle(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.go')
  }
}

export class RustLanguageDriver implements LanguageDriver {
  readonly name = 'rust'
  readonly extensions = ['.rs'] as const

  canHandle(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.rs')
  }
}

export class DriverRegistry {
  private readonly drivers: LanguageDriver[] = []

  constructor() {
    // Register all ecosystem drivers
    this.register(new TSLanguageDriver())
    this.register(new SFCLanguageDriver())
    this.register(new PythonLanguageDriver())
    this.register(new GoLanguageDriver())
    this.register(new RustLanguageDriver())
  }

  register(driver: LanguageDriver): void {
    this.drivers.push(driver)
  }

  getDriverForFile(filePath: string): LanguageDriver | undefined {
    return this.drivers.find((d) => d.canHandle(filePath))
  }

  isSupported(filePath: string): boolean {
    return this.getDriverForFile(filePath) !== undefined
  }
}
