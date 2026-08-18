/**
 * Lightweight deterministic Java syntax & AST analyzer.
 * Extracts packages, imports, classes, interfaces, enums, extends/implements, methods, and call hierarchies.
 * @module @trench-xinxin/dsh-tool-lens/parsers/java-parser
 */

import type {
  ParsedCallDef,
  ParsedHeritageDef,
  ParsedImportDef,
  ParsedSourceResult,
  ParsedSymbolDef,
} from './python-parser.ts'

/**
 * Parses Java source code into symbols, imports, heritages, and calls.
 */
export function parseJavaSource(content: string, _relPath: string): ParsedSourceResult {
  const lines = content.split(/\r?\n/)
  const symbols: ParsedSymbolDef[] = []
  const imports: ParsedImportDef[] = []
  const heritages: ParsedHeritageDef[] = []
  const calls: ParsedCallDef[] = []

  let currentPackage = ''
  let currentClass: { name: string; startLine: number } | null = null
  let currentMethod: { name: string; startLine: number } | null = null

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!
    const lineNum = i + 1
    const trimmed = rawLine.trim()

    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue
    }

    // 1. Package declaration: package com.example.service;
    const pkgMatch = trimmed.match(/^package\s+([a-zA-Z0-9_.]+)\s*;/)
    if (pkgMatch) {
      currentPackage = pkgMatch[1]!
      continue
    }

    // 2. Import statements: import com.example.model.User; or import static org.junit.Assert.*;
    const importMatch = trimmed.match(/^import\s+(?:static\s+)?([a-zA-Z0-9_.*]+)\s*;/)
    if (importMatch) {
      const fullPath = importMatch[1]!
      const parts = fullPath.split('.')
      const importedName = parts.pop()!
      const localName = importedName === '*' ? parts[parts.length - 1] || 'util' : importedName
      imports.push({
        specifier: fullPath,
        importedName,
        localName,
        isNamespace: importedName === '*',
      })
      continue
    }

    // 3. Class Definition: public class UserService extends BaseService implements IUserService, Serializable
    const classMatch = trimmed.match(
      /^(?:public|protected|private|abstract|final|static|\s)*\bclass\s+([a-zA-Z0-9_]+)(?:<[^>]*>)?(?:\s+extends\s+([a-zA-Z0-9_]+(?:<[^>]*>)?))?(?:\s+implements\s+([a-zA-Z0-9_,\s<>]+))?/,
    )
    if (classMatch) {
      const className = classMatch[1]!
      const extendsClass = classMatch[2]
      const implementsIfaces = classMatch[3]

      currentClass = { name: className, startLine: lineNum }
      currentMethod = null

      symbols.push({
        name: className,
        kind: 'class',
        line: lineNum,
        endLine: lineNum,
      })

      if (extendsClass) {
        const cleanExtends = extendsClass.replace(/<[^>]*>/g, '').trim()
        if (cleanExtends && cleanExtends !== 'Object') {
          heritages.push({
            sourceName: className,
            targetName: cleanExtends,
            relation: 'extends',
          })
        }
      }

      if (implementsIfaces) {
        const ifaceList = implementsIfaces
          .replace(/<[^>]*>/g, '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)

        for (const iface of ifaceList) {
          heritages.push({
            sourceName: className,
            targetName: iface,
            relation: 'implements',
          })
        }
      }
      continue
    }

    // 4. Interface Definition: public interface IUserService extends BaseInterface
    const ifaceMatch = trimmed.match(
      /^(?:public|protected|private|abstract|static|\s)*\binterface\s+([a-zA-Z0-9_]+)(?:<[^>]*>)?(?:\s+extends\s+([a-zA-Z0-9_,\s<>]+))?/,
    )
    if (ifaceMatch) {
      const ifaceName = ifaceMatch[1]!
      const extendsList = ifaceMatch[2]

      currentClass = { name: ifaceName, startLine: lineNum }
      currentMethod = null

      symbols.push({
        name: ifaceName,
        kind: 'interface',
        line: lineNum,
        endLine: lineNum,
      })

      if (extendsList) {
        const superIfaces = extendsList
          .replace(/<[^>]*>/g, '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)

        for (const sup of superIfaces) {
          heritages.push({
            sourceName: ifaceName,
            targetName: sup,
            relation: 'extends',
          })
        }
      }
      continue
    }

    // 5. Enum Definition: public enum Status
    const enumMatch = trimmed.match(/^(?:public|protected|private|static|\s)*\benum\s+([a-zA-Z0-9_]+)/)
    if (enumMatch) {
      const enumName = enumMatch[1]!
      currentClass = { name: enumName, startLine: lineNum }
      symbols.push({
        name: enumName,
        kind: 'class',
        line: lineNum,
        endLine: lineNum,
      })
      continue
    }

    // 6. Method Definition: public User findById(Long id) throws Exception {
    const methodMatch = trimmed.match(
      /^(?:@\w+(?:\([^)]*\))?\s+)*(?:public|protected|private|static|final|abstract|synchronized|native|\s)*\s*([a-zA-Z0-9_<>[\]]+)\s+([a-zA-Z0-9_]+)\s*\([^)]*\)(?:\s+throws\s+[a-zA-Z0-9_,\s]+)?(?:\s*\{|\s*;)/,
    )
    if (methodMatch && currentClass) {
      const returnTypeOrModifier = methodMatch[1]!
      const methodName = methodMatch[2]!

      if (!['if', 'for', 'while', 'switch', 'catch', 'synchronized', 'return', 'new', 'class', 'interface', 'enum'].includes(methodName) && !['class', 'interface', 'enum'].includes(returnTypeOrModifier)) {
        const fullName = `${currentClass.name}.${methodName}`
        currentMethod = { name: fullName, startLine: lineNum }

        symbols.push({
          name: fullName,
          kind: 'function',
          line: lineNum,
          endLine: lineNum,
          parentName: currentClass.name,
        })
        continue
      }
    }

    // 7. Method calls within active method
    if (currentMethod) {
      extractJavaCalls(trimmed, currentClass?.name, (calleeName, calleeObject) => {
        calls.push({
          callerName: currentMethod!.name,
          calleeName,
          calleeObject,
        })
      })
    }
  }

  return { symbols, imports, heritages, calls }
}

function extractJavaCalls(
  line: string,
  currentClassName: string | undefined,
  onCall: (calleeName: string, calleeObject?: string) => void,
): void {
  // Matches expressions like userService.findById(), this.init(), PasswordEncoder.encode()
  const callRegex = /\b([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*)\s*\(/g
  let match: RegExpExecArray | null

  while ((match = callRegex.exec(line)) !== null) {
    const rawExpr = match[1]!
    if (['if', 'for', 'while', 'switch', 'catch', 'synchronized', 'return', 'super', 'this'].includes(rawExpr)) {
      continue
    }

    if (rawExpr.includes('.')) {
      const parts = rawExpr.split('.')
      const calleeName = parts.pop()!
      const obj = parts.join('.')

      if (obj === 'this' && currentClassName) {
        onCall(calleeName, currentClassName)
      } else {
        onCall(calleeName, obj)
      }
    } else {
      onCall(rawExpr)
    }
  }
}
