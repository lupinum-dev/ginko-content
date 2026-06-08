import { spawnSync } from 'node:child_process'

const result = spawnSync('pnpm', [
  'vitest',
  'run',
  '--config',
  'vitest.config.ts',
  '--project',
  'e2e',
  'test/e2e/sitemap-static.test.ts'
], {
  cwd: new URL('..', import.meta.url),
  stdio: 'inherit',
  shell: process.platform === 'win32'
})

process.exit(result.status ?? 1)
