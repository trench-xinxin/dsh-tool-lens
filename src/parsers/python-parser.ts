/**
 * Lightweight deterministic Python syntax & AST analyzer.
 * Extracts modules, imports, functions, classes, methods, inheritance, and call hierarchies.
 * @module @trench-xinxin/dsh-tool-lens/parsers/python-parser
 */

import type { CodeNodeKind } from '../core/types.ts'

export interface ParsedSymbolDef {
  name: string
  kind: CodeNodeKind
  line: number
  endLine: number
  parentName?: string
}

export interface ParsedHeritageDef {
  sourceName: string
  targetName: string
  relation: 'extends' | 'implements'
}

export interface ParsedImportDef {
  specifier: string
  importedName: string
  localName: string
  isNamespace?: boolean
}

export interface ParsedCallDef {
  callerName: string
  calleeName: string
  calleeObject?: string
}

export interface ParsedSourceResult {
  symbols: ParsedSymbolDef[]
  imports: ParsedImportDef[]
  heritages: ParsedHeritageDef[]
  calls: ParsedCallDef[]
}

/**
 * Parses Python source code into symbols, imports, heritages, and calls.
 */
export function parsePythonSource(content: string, _relPath: string): ParsedSourceResult {
  const lines = content.split(/\r?\n/)
  const symbols: ParsedSymbolDef[] = []
  const imports: ParsedImportDef[] = []
  const heritages: ParsedHeritageDef[] = []
  const calls: ParsedCallDef[] = []

  let currentClass: { name: string; indent: number; startLine: number } | null = null
  let currentFunc: { name: string; indent: number; startLine: number } | null = null

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!
    const lineNum = i + 1
    const trimmed = rawLine.trim()

    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const indent = rawLine.search(/\S/)

    // Check if we exited current class or function scope
    if (currentFunc && indent <= currentFunc.indent && !rawLine.startsWith(' ') && !rawLine.startsWith('\t')) {
      currentFunc = null
    }
    if (currentClass && indent <= currentClass.indent && !rawLine.startsWith(' ') && !rawLine.startsWith('\t')) {
      currentClass = null
    }

    // 1. Imports: import foo.bar as fb, import os
    const importMatch = trimmed.match(/^import\s+([a-zA-Z0-9_.,\s]+)/)
    if (importMatch) {
      const parts = importMatch[1]!.split(',')
      for (const part of parts) {
        const item = part.trim()
        const asMatch = item.match(/^([a-zA-Z0-9_.]+)(?:\s+as\s+([a-zA-Z0-9_]+))?$/)
        if (asMatch) {
          const mod = asMatch[1]!
          const local = asMatch[2] || mod.split('.').pop()!
          imports.push({
            specifier: mod,
            importedName: '*',
            localName: local,
            isNamespace: true,
          })
        }
      }
      continue
    }

    // 2. From imports: from foo.bar import baz as bz, qux
    const fromMatch = trimmed.match(/^from\s+([a-zA-Z0-9_.]+)\s+import\s+([a-zA-Z0-9_*,\s]+)/)
    if (fromMatch) {
      const mod = fromMatch[1]!
      const items = fromMatch[2]!.split(',')
      for (const item of items) {
        const asMatch = item.trim().match(/^([a-zA-Z0-9_*]+)(?:\s+as\s+([a-zA-Z0-9_]+))?$/)
        if (asMatch) {
          const imported = asMatch[1]!
          const local = asMatch[2] || imported
          imports.push({
            specifier: mod,
            importedName: imported,
            localName: local,
            isNamespace: imported === '*',
          })
        }
      }
      continue
    }

    // 3. Class Definitions: class MyService(BaseService, Interface):
    const classMatch = trimmed.match(/^class\s+([a-zA-Z0-9_]+)(?:\(([^)]*)\))?:/)
    if (classMatch) {
      const className = classMatch[1]!
      const basesRaw = classMatch[2]

      currentClass = { name: className, indent, startLine: lineNum }
      currentFunc = null

      symbols.push({
        name: className,
        kind: 'class',
        line: lineNum,
        endLine: lineNum,
      })

      if (basesRaw) {
        const bases = basesRaw.split(',').map((b) => b.trim()).filter(Boolean)
        for (const base of bases) {
          if (base !== 'object') {
            heritages.push({
              sourceName: className,
              targetName: base,
              relation: 'extends',
            })
          }
        }
      }
      continue
    }

    // 4. Function & Method Definitions: def func(...) or async def func(...)
    const funcMatch = trimmed.match(/^(?:async\s+)?def\s+([a-zA-Z0-9_]+)\s*\(/)
    if (funcMatch) {
      const funcShortName = funcMatch[1]!
      let fullName = funcShortName

      if (currentClass && indent > currentClass.indent) {
        fullName = `${currentClass.name}.${funcShortName}`
      }

      currentFunc = { name: fullName, indent, startLine: lineNum }

      symbols.push({
        name: fullName,
        kind: 'function',
        line: lineNum,
        endLine: lineNum,
        parentName: currentClass ? currentClass.name : undefined,
      })
      continue
    }

    // 5. Calls within functions/methods
    if (currentFunc) {
      extractPythonCalls(trimmed, currentFunc.name, currentClass?.name, (calleeName, calleeObject) => {
        calls.push({
          callerName: currentFunc!.name,
          calleeName,
          calleeObject,
        })
      })
    }
  }

  return { symbols, imports, heritages, calls }
}

function extractPythonCalls(
  line: string,
  _callerName: string,
  currentClassName: string | undefined,
  onCall: (calleeName: string, calleeObject?: string) => void,
): void {
  // Matches expressions like self.method(), helper(), os.path.join()
  const callRegex = /\b([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*)\s*\(/g
  let match: RegExpExecArray | null

  while ((match = callRegex.exec(line)) !== null) {
    const rawExpr = match[1]!
    if (['def', 'class', 'if', 'elif', 'while', 'for', 'with', 'return', 'except'].includes(rawExpr)) {
      continue
    }

    if (rawExpr.includes('.')) {
      const parts = rawExpr.split('.')
      const calleeName = parts.pop()!
      const obj = parts.join('.')

      if (obj === 'self' && currentClassName) {
        onCall(calleeName, currentClassName)
      } else {
        onCall(calleeName, obj)
      }
    } else {
      onCall(rawExpr)
    }
  }
}
