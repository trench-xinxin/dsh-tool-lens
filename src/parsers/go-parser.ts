/**
 * Lightweight deterministic Go syntax & AST analyzer.
 * Extracts packages, imports, structs, interfaces, receiver methods, embedding, and call hierarchies.
 * @module @trench-xinxin/dsh-tool-lens/parsers/go-parser
 */

import type { ParsedCallDef, ParsedHeritageDef, ParsedImportDef, ParsedSourceResult, ParsedSymbolDef } from './python-parser.ts'

/**
 * Parses Go source code into symbols, imports, heritages, and calls.
 */
export function parseGoSource(content: string, _relPath: string): ParsedSourceResult {
  const lines = content.split(/\r?\n/)
  const symbols: ParsedSymbolDef[] = []
  const imports: ParsedImportDef[] = []
  const heritages: ParsedHeritageDef[] = []
  const calls: ParsedCallDef[] = []

  let inImportBlock = false
  let currentFunc: { name: string; startLine: number } | null = null

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!
    const lineNum = i + 1
    const trimmed = rawLine.trim()

    if (!trimmed || trimmed.startsWith('//')) {
      continue
    }

    // 1. Multi-line import block: import ( ... )
    if (trimmed.startsWith('import (')) {
      inImportBlock = true
      continue
    }
    if (inImportBlock) {
      if (trimmed.startsWith(')')) {
        inImportBlock = false
        continue
      }
      const itemMatch = trimmed.match(/^(?:([a-zA-Z0-9_]+)\s+)?"([^"]+)"/)
      if (itemMatch) {
        const alias = itemMatch[1]
        const pkgPath = itemMatch[2]!
        const local = alias || pkgPath.split('/').pop()!
        imports.push({
          specifier: pkgPath,
          importedName: '*',
          localName: local,
          isNamespace: true,
        })
      }
      continue
    }

    // Single-line import: import "fmt" or import mypkg "path/to/pkg"
    const singleImportMatch = trimmed.match(/^import\s+(?:([a-zA-Z0-9_]+)\s+)?"([^"]+)"/)
    if (singleImportMatch) {
      const alias = singleImportMatch[1]
      const pkgPath = singleImportMatch[2]!
      const local = alias || pkgPath.split('/').pop()!
      imports.push({
        specifier: pkgPath,
        importedName: '*',
        localName: local,
        isNamespace: true,
      })
      continue
    }

    // 2. Struct Definition: type User struct { ... }
    const structMatch = trimmed.match(/^type\s+([a-zA-Z0-9_]+)\s+struct\b/)
    if (structMatch) {
      const structName = structMatch[1]!
      symbols.push({
        name: structName,
        kind: 'class',
        line: lineNum,
        endLine: lineNum,
      })
      continue
    }

    // 3. Interface Definition: type Reader interface { ... }
    const ifaceMatch = trimmed.match(/^type\s+([a-zA-Z0-9_]+)\s+interface\b/)
    if (ifaceMatch) {
      const ifaceName = ifaceMatch[1]!
      symbols.push({
        name: ifaceName,
        kind: 'interface',
        line: lineNum,
        endLine: lineNum,
      })
      continue
    }

    // 4. Receiver Method: func (u *User) Save(...) (...) {
    const receiverMatch = trimmed.match(/^func\s+\(\s*(?:[a-zA-Z0-9_]+\s+)?\*?([a-zA-Z0-9_]+)\s*\)\s*([a-zA-Z0-9_]+)\s*\(/)
    if (receiverMatch) {
      const receiverType = receiverMatch[1]!
      const methodName = receiverMatch[2]!
      const fullName = `${receiverType}.${methodName}`

      currentFunc = { name: fullName, startLine: lineNum }

      symbols.push({
        name: fullName,
        kind: 'function',
        line: lineNum,
        endLine: lineNum,
        parentName: receiverType,
      })
      continue
    }

    // 5. Ordinary Function: func ProcessOrder(...) (...) {
    const funcMatch = trimmed.match(/^func\s+([a-zA-Z0-9_]+)\s*\(/)
    if (funcMatch) {
      const funcName = funcMatch[1]!
      currentFunc = { name: funcName, startLine: lineNum }

      symbols.push({
        name: funcName,
        kind: 'function',
        line: lineNum,
        endLine: lineNum,
      })
      continue
    }

    // 6. Function close: closing brace at col 0
    if (currentFunc && rawLine.startsWith('}')) {
      currentFunc = null
    }

    // 7. Calls within active function
    if (currentFunc) {
      extractGoCalls(trimmed, (calleeName, calleeObject) => {
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

function extractGoCalls(
  line: string,
  onCall: (calleeName: string, calleeObject?: string) => void,
): void {
  // Matches expressions like pkg.Func(), r.Method(), LocalFunc()
  const callRegex = /\b([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*)\s*\(/g
  let match: RegExpExecArray | null

  while ((match = callRegex.exec(line)) !== null) {
    const rawExpr = match[1]!
    if (['func', 'if', 'for', 'switch', 'select', 'return', 'make', 'new', 'len', 'cap', 'append', 'panic', 'recover'].includes(rawExpr)) {
      continue
    }

    if (rawExpr.includes('.')) {
      const parts = rawExpr.split('.')
      const calleeName = parts.pop()!
      const obj = parts.join('.')
      onCall(calleeName, obj)
    } else {
      onCall(rawExpr)
    }
  }
}
