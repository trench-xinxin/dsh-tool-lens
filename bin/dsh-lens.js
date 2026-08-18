#!/usr/bin/env node

/**
 * Zero-config CLI launcher for DeepSeek Harness with Lens pre-loaded and auto-port selection.
 * @module @trench-xinxin/dsh-tool-lens/bin
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgRoot = join(__dirname, '..')
const entryFile = join(pkgRoot, 'lib', 'index.mjs').replace(/\\/g, '/')

async function findFreePort(startPort = 3080) {
  return new Promise((resolve) => {
    const server = createServer()
    server.unref()
    server.on('error', () => {
      resolve(findFreePort(startPort + 1))
    })
    server.listen(startPort, '127.0.0.1', () => {
      server.close(() => resolve(startPort))
    })
  })
}

async function main() {
  const args = process.argv.slice(2)
  const isWeb = args.length === 0 || args[0] === 'web'

  let targetPort = 3080
  if (isWeb) {
    targetPort = await findFreePort(3080)
    if (targetPort !== 3080) {
      console.log(`[dsh-lens] ℹ️ Port 3080 is in use, auto-routing to free port: http://127.0.0.1:${targetPort}`)
    }
  }

  // Temporary patch YAML to overlay Lens onto any DSH invocation
  const tempPatch = join(tmpdir(), `dsh-lens-patch-${process.pid}-${Date.now()}.yml`)
  const patchLines = [
    `- insert:`,
    `    - id: tool-lens`,
    `      name: '${entryFile}'`,
    `      config:`,
    `        maxDepth: 3`,
  ]

  if (targetPort !== 3080) {
    patchLines.push(
      `- update:`,
      `    id: webserver`,
      `    config:`,
      `      port: ${targetPort}`,
    )
  }

  const patchContent = patchLines.join('\n') + '\n'

  try {
    writeFileSync(tempPatch, patchContent, 'utf8')
  } catch (err) {
    console.error('[dsh-lens] Failed to write temporary config:', err)
    process.exit(1)
  }

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
}

main().catch((err) => {
  console.error('[dsh-lens] Error:', err)
  process.exit(1)
})
