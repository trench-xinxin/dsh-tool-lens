import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    invariant: 'src/invariant.ts',
  },
  format: ['esm'],
  outDir: 'lib',
  clean: true,
  dts: true,
  external: [
    'typescript',
    '@deepseek-ai/cordis',
    '@deepseek-ai/schemastery',
    '@deepseek-ai/dsh-tools',
    '@deepseek-ai/dsh-system-prompt',
    '@deepseek-ai/dsh-invariants',
    '@deepseek-ai/dsh-llm',
  ],
})
