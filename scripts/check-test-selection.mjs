import { spawnSync } from 'node:child_process'

const expectations = [
  {
    project: 'e2e',
    includes: ['test/e2e/search-matrix.test.ts', 'test/e2e/sitemap-static.test.ts'],
    excludes: ['test/e2e/generate-output.test.ts']
  },
  {
    project: 'generate',
    includes: ['test/e2e/generate-output.test.ts'],
    excludes: ['test/e2e/search-matrix.test.ts']
  },
  {
    project: 'browser-e2e',
    includes: ['test/browser-e2e/locale-search.test.ts'],
    excludes: []
  }
]

for (const expectation of expectations) {
  const result = spawnSync('pnpm', [
    'exec', 'vitest', 'list', '--config', 'vitest.config.ts', '--project', expectation.project
  ], { encoding: 'utf8', shell: process.platform === 'win32' })
  const output = `${result.stdout || ''}${result.stderr || ''}`
  if (result.status !== 0) {
    console.error(output)
    process.exit(result.status ?? 1)
  }
  for (const path of expectation.includes) {
    if (!output.includes(path)) {
      throw new Error(`Vitest project ${expectation.project} did not select required test ${path}.\n${output}`)
    }
  }
  for (const path of expectation.excludes) {
    if (output.includes(path)) {
      throw new Error(`Vitest project ${expectation.project} unexpectedly selected ${path}.\n${output}`)
    }
  }
}

console.log('Vitest release-lane selection is non-empty and correctly isolated.')
