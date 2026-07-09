import { spawnSync } from 'node:child_process'

console.warn('Regenerating route goldens from real nuxi generate output. Review the resulting diff before committing.')
const result = spawnSync('pnpm', ['test:generate:static'], {
  env: { ...process.env, UPDATE_ROUTE_GOLDENS: '1' },
  stdio: 'inherit',
  shell: process.platform === 'win32'
})
process.exit(result.status ?? 1)
