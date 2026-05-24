import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packageRoot = resolve(repoRoot, 'packages/content')
const packDir = resolve(repoRoot, '.pack')

function run(command, args, cwd = repoRoot) {
  execFileSync(command, args, {
    cwd,
    env: { ...process.env, npm_config_verify_deps_before_run: 'false' },
    stdio: 'inherit',
  })
}

function assertNoWorkspaceRanges() {
  const offenders = []
  for (const tarball of readdirSync(packDir).filter((file) => file.endsWith('.tgz'))) {
    const tempDir = mkdtempSync(join(tmpdir(), 'ginko-content-release-pack-'))
    try {
      execFileSync('tar', ['-xzf', resolve(packDir, tarball)], { cwd: tempDir, stdio: 'pipe' })
      const manifestPath = resolve(tempDir, 'package/package.json')
      if (!existsSync(manifestPath)) {
        offenders.push(`${tarball}: missing package/package.json after extract`)
        continue
      }
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      for (const field of [
        'dependencies',
        'devDependencies',
        'peerDependencies',
        'optionalDependencies',
      ]) {
        for (const [name, range] of Object.entries(manifest[field] ?? {})) {
          if (typeof range === 'string' && range.startsWith('workspace:')) {
            offenders.push(`${tarball}: ${field}.${name} ships ${range}`)
          }
        }
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  }

  if (offenders.length > 0) {
    console.error('Release pack workspace:* check failed:')
    for (const offender of offenders) console.error(`  - ${offender}`)
    process.exit(1)
  }
}

rmSync(packDir, { recursive: true, force: true })
mkdirSync(packDir, { recursive: true })

run('pnpm', ['run', 'build:packages'])
run('pnpm', ['pack', '--pack-destination', packDir], packageRoot)
assertNoWorkspaceRanges()
console.log(`Release pack wrote ${readdirSync(packDir).filter((file) => file.endsWith('.tgz')).length} tarball(s) to ${packDir}.`)
