/**
 * Extensible Language Driver registry for multi-ecosystem AST analysis.
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

export class DriverRegistry {
  private readonly drivers: LanguageDriver[] = []

  constructor() {
    // Register default drivers
    this.register(new TSLanguageDriver())
    this.register(new SFCLanguageDriver())
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
