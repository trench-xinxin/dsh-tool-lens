#!/usr/bin/env node

/**
 * Zero-config CLI launcher for DeepSeek Harness with Lens pre-loaded.
 * @module @trench-xinxin/dsh-tool-lens/bin
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgRoot = join(__dirname, '..')
// Point directly to the compiled ESM entry point file to satisfy Node.js strict ESM loader
const entryFile = join(pkgRoot, 'lib', 'index.mjs').replace(/\\/g, '/')

// Temporary patch YAML to overlay Lens onto any DSH invocation
const tempPatch = join(tmpdir(), `dsh-lens-patch-${process.pid}-${Date.now()}.yml`)
const patchContent = `- insert:
    - id: tool-lens
      name: '${entryFile}'
      config:
        maxDepth: 3
`

try {
  writeFileSync(tempPatch, patchContent, 'utf8')
} catch (err) {
  console.error('[dsh-lens] Failed to write temporary config:', err)
  process.exit(1)
}

const args = process.argv.slice(2)
const dshArgs = args.length === 0 ? ['web', '--patch', tempPatch] : [...args, '--patch', tempPatch]

const isWindows = process.platform === 'win32'
const npxCmd = isWindows ? 'npx.cmd' : 'npx'

const child = spawn(npxCmd, ['-y', '@deepseek-ai/dsh', ...dshArgs], {
  stdio: 'inherit',
  shell: true,
})

const cleanup = () => {
  try {
    unlinkSync(tempPatch)
  } catch {}
}

child.on('error', (err) => {
  cleanup()
  console.error('[dsh-lens] Failed to start DeepSeek Harness:', err.message)
  process.exit(1)
})

child.on('exit', (code) => {
  cleanup()
  process.exit(code ?? 0)
})

process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)
process.on('exit', cleanup)
