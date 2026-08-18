/**
 * Lightweight deterministic Rust syntax & AST analyzer.
 * Extracts mods, uses, structs, enums, traits, impls, and call hierarchies.
 * @module @trench-xinxin/dsh-tool-lens/parsers/rust-parser
 */

import type { ParsedCallDef, ParsedHeritageDef, ParsedImportDef, ParsedSourceResult, ParsedSymbolDef } from './python-parser.ts'

/**
 * Parses Rust source code into symbols, imports, heritages, and calls.
 */
export function parseRustSource(content: string, _relPath: string): ParsedSourceResult {
  const lines = content.split(/\r?\n/)
  const symbols: ParsedSymbolDef[] = []
  const imports: ParsedImportDef[] = []
  const heritages: ParsedHeritageDef[] = []
  const calls: ParsedCallDef[] = []

  let currentImplTarget: string | null = null
  let currentFunc: { name: string; startLine: number } | null = null

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!
    const lineNum = i + 1
    const trimmed = rawLine.trim()

    if (!trimmed || trimmed.startsWith('//')) {
      continue
    }

    // 1. Mod and Use statements: use crate::services::auth::AuthService;
    const useMatch = trimmed.match(/^use\s+([a-zA-Z0-9_:]+)(?:\s+as\s+([a-zA-Z0-9_]+))?;/)
    if (useMatch) {
      const fullPath = useMatch[1]!
      const alias = useMatch[2]
      const local = alias || fullPath.split('::').pop()!
      imports.push({
        specifier: fullPath,
        importedName: fullPath.split('::').pop()!,
        localName: local,
      })
      continue
    }

    const modMatch = trimmed.match(/^mod\s+([a-zA-Z0-9_]+);/)
    if (modMatch) {
      const modName = modMatch[1]!
      imports.push({
        specifier: modName,
        importedName: '*',
        localName: modName,
        isNamespace: true,
      })
      continue
    }

    // 2. Struct Definition: pub struct Point { ... }
    const structMatch = trimmed.match(/^(?:pub(?:\([^)]*\))?\s+)?struct\s+([a-zA-Z0-9_]+)/)
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

    // 3. Enum Definition: pub enum Status { ... }
    const enumMatch = trimmed.match(/^(?:pub(?:\([^)]*\))?\s+)?enum\s+([a-zA-Z0-9_]+)/)
    if (enumMatch) {
      const enumName = enumMatch[1]!
      symbols.push({
        name: enumName,
        kind: 'class',
        line: lineNum,
        endLine: lineNum,
      })
      continue
    }

    // 4. Trait Definition: pub trait Summary { ... }
    const traitMatch = trimmed.match(/^(?:pub(?:\([^)]*\))?\s+)?trait\s+([a-zA-Z0-9_]+)/)
    if (traitMatch) {
      const traitName = traitMatch[1]!
      symbols.push({
        name: traitName,
        kind: 'interface',
        line: lineNum,
        endLine: lineNum,
      })
      continue
    }

    // 5. Impl Block: impl Summary for Point { ... } or impl Point { ... }
    const implTraitMatch = trimmed.match(/^impl(?:<[^>]*>)?\s+([a-zA-Z0-9_]+)\s+for\s+([a-zA-Z0-9_]+)/)
    if (implTraitMatch) {
      const traitName = implTraitMatch[1]!
      const targetType = implTraitMatch[2]!
      currentImplTarget = targetType

      heritages.push({
        sourceName: targetType,
        targetName: traitName,
        relation: 'implements',
      })
      continue
    }

    const implDirectMatch = trimmed.match(/^impl(?:<[^>]*>)?\s+([a-zA-Z0-9_]+)/)
    if (implDirectMatch) {
      currentImplTarget = implDirectMatch[1]!
      continue
    }

    // Close impl block
    if (currentImplTarget && rawLine.startsWith('}') && !currentFunc) {
      currentImplTarget = null
    }

    // 6. Function / Method Definition: fn new(...) -> Self or pub fn run(&self)
    const fnMatch = trimmed.match(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([a-zA-Z0-9_]+)\s*\(/)
    if (fnMatch) {
      const fnName = fnMatch[1]!
      let fullName = fnName
      if (currentImplTarget) {
        fullName = `${currentImplTarget}.${fnName}`
      }

      currentFunc = { name: fullName, startLine: lineNum }

      symbols.push({
        name: fullName,
        kind: 'function',
        line: lineNum,
        endLine: lineNum,
        parentName: currentImplTarget || undefined,
      })
      continue
    }

    // Close function block
    if (currentFunc && rawLine.startsWith('}')) {
      currentFunc = null
    }

    // 7. Calls within active function
    if (currentFunc) {
      extractRustCalls(trimmed, (calleeName, calleeObject) => {
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

function extractRustCalls(
  line: string,
  onCall: (calleeName: string, calleeObject?: string) => void,
): void {
  // Matches expressions like Type::new(), self.method(), helper()
  const callRegex = /\b([a-zA-Z0-9_]+(?:::[a-zA-Z0-9_]+|\.[a-zA-Z0-9_]+)*)\s*\(/g
  let match: RegExpExecArray | null

  while ((match = callRegex.exec(line)) !== null) {
    const rawExpr = match[1]!
    if (['fn', 'if', 'match', 'while', 'for', 'loop', 'return', 'println', 'format', 'vec', 'panic'].includes(rawExpr)) {
      continue
    }

    if (rawExpr.includes('::')) {
      const parts = rawExpr.split('::')
      const calleeName = parts.pop()!
      const obj = parts.join('::')
      onCall(calleeName, obj)
    } else if (rawExpr.includes('.')) {
      const parts = rawExpr.split('.')
      const calleeName = parts.pop()!
      const obj = parts.join('.')
      onCall(calleeName, obj)
    } else {
      onCall(rawExpr)
    }
  }
}
