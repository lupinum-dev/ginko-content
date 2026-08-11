import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertProductionAuditClean } from './lib/production-audit.mjs'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packageRoot = resolve(repoRoot, 'packages/content')
const auditRoot = mkdtempSync(join(tmpdir(), 'ginko-content-audit-'))
const packageManifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'))

const runNpm = args => execFileSync('npm', args, {
  cwd: auditRoot,
  env: process.env,
  stdio: 'inherit',
})

const auditWithNpm = () => spawnSync('npm', [
  'audit',
  '--package-lock-only',
  '--omit=dev',
  '--audit-level=low',
  '--json',
], {
  cwd: auditRoot,
  encoding: 'utf8',
  env: process.env,
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
  const audit = auditWithNpm()
  if (audit.stderr) {
    process.stderr.write(audit.stderr)
  }
  if (audit.error) {
    throw audit.error
  }

  let report
  try {
    report = JSON.parse(audit.stdout)
  }
  catch {
    process.stdout.write(audit.stdout)
    throw new Error('npm audit did not return valid JSON.')
  }

  try {
    assertProductionAuditClean(report)
  }
  catch (error) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    throw error
  }

  if (audit.status !== 0) {
    throw new Error(`npm audit failed with exit code ${audit.status}.`)
  }

  console.log('Production dependency audit found no vulnerabilities.')
}
finally {
  rmSync(auditRoot, { recursive: true, force: true })
}
