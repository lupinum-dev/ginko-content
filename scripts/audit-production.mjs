import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packageRoot = resolve(repoRoot, 'packages/content')
const auditRoot = mkdtempSync(join(tmpdir(), 'ginko-content-audit-'))
const packageManifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'))

const runNpm = args => execFileSync('npm', args, {
  cwd: auditRoot,
  env: process.env,
  stdio: 'inherit',
})

try {
  writeFileSync(resolve(auditRoot, 'package.json'), `${JSON.stringify({
    name: 'ginko-content-production-audit',
    private: true,
    version: '0.0.0',
    dependencies: {
      ...packageManifest.dependencies,
      ...packageManifest.optionalDependencies,
    },
  }, null, 2)}\n`)

  // Resolve the package's publishable production dependency graph with npm so
  // npm's supported bulk advisory endpoint audits what npm consumers install.
  // Keep the generated lockfile isolated from the pnpm workspace.
  runNpm([
    'install',
    '--package-lock-only',
    '--ignore-scripts',
    '--omit=dev',
  ])
  runNpm([
    'audit',
    '--package-lock-only',
    '--omit=dev',
    '--audit-level=low',
  ])
}
finally {
  rmSync(auditRoot, { recursive: true, force: true })
}
