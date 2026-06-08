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

function normalizeExportTarget(target) {
  if (typeof target === 'string') return target
  if (!target || typeof target !== 'object') return null
  for (const key of ['types', 'import', 'default']) {
    if (typeof target[key] === 'string') return target[key]
  }
  return null
}

function collectExpectedExportFiles(exportsMap) {
  const files = new Set()

  for (const target of Object.values(exportsMap)) {
    if (typeof target === 'string') {
      if (!target.includes('*')) files.add(target.replace(/^\.\//, 'package/'))
      continue
    }

    if (!target || typeof target !== 'object') continue
    for (const value of Object.values(target)) {
      const file = normalizeExportTarget(value)
      if (file && !file.includes('*')) {
        files.add(file.replace(/^\.\//, 'package/'))
      }
    }
  }

  return files
}

function assertReleaseTarball(tarball) {
  const tempDir = mkdtempSync(join(tmpdir(), 'ginko-content-release-inspect-'))

  try {
    const entries = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
    const entrySet = new Set(entries)
    const forbiddenPatterns = [
      /^package\/\.env(?:\.|$)/,
      /^package\/\.nuxt(?:\/|$)/,
      /^package\/\.output(?:\/|$)/,
      /^package\/\.pack(?:\/|$)/,
      /^package\/node_modules(?:\/|$)/,
      /^package\/playground(?:\/|$)/,
      /^package\/examples(?:\/|$)/,
      /^package\/test(?:\/|$)/,
      /^package\/.*\.tgz$/
    ]
    const offenders = entries.filter(entry => forbiddenPatterns.some(pattern => pattern.test(entry)))

    if (offenders.length) {
      throw new Error(`Release tarball includes forbidden files:\n${offenders.map(entry => `  - ${entry}`).join('\n')}`)
    }

    execFileSync('tar', ['-xzf', tarball], { cwd: tempDir, stdio: 'pipe' })
    const manifestPath = resolve(tempDir, 'package/package.json')
    if (!existsSync(manifestPath)) {
      throw new Error(`Release tarball is missing package/package.json: ${tarball}`)
    }

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const expectedManifestFields = {
      name: '@lupinum/ginko-content',
      license: 'MIT'
    }
    for (const [field, expected] of Object.entries(expectedManifestFields)) {
      if (manifest[field] !== expected) {
        throw new Error(`Release manifest field ${field} expected ${expected}, got ${manifest[field]}`)
      }
    }

    if (!manifest.version || typeof manifest.version !== 'string') {
      throw new Error('Release manifest is missing version.')
    }
    if (manifest.repository?.url !== 'git+https://github.com/lupinum-dev/ginko-content.git') {
      throw new Error('Release manifest repository URL is missing or unexpected.')
    }
    if (manifest.repository?.directory !== 'packages/content') {
      throw new Error('Release manifest repository.directory must be packages/content.')
    }
    if (!Array.isArray(manifest.files) || !manifest.files.includes('dist') || !manifest.files.includes('README.md')) {
      throw new Error('Release manifest files list must include dist and README.md.')
    }
    for (const peer of ['nuxt', 'vue']) {
      if (!manifest.peerDependencies?.[peer]) {
        throw new Error(`Release manifest is missing required peer dependency: ${peer}`)
      }
    }

    for (const file of collectExpectedExportFiles(manifest.exports ?? {})) {
      if (!entrySet.has(file)) {
        throw new Error(`Release tarball is missing exported file: ${file}`)
      }
      if (file.includes('/dist/') && !file.endsWith('.map') && /\.(?:d\.mts|d\.ts)$/.test(file) === false) {
        const declaration = file
          .replace(/\.mjs$/, '.d.mts')
          .replace(/\.js$/, '.d.ts')
        if (!entrySet.has(declaration)) {
          throw new Error(`Release tarball is missing declaration for ${file}: ${declaration}`)
        }
      }
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

rmSync(packDir, { recursive: true, force: true })
mkdirSync(packDir, { recursive: true })

run('pnpm', ['run', 'build:packages'])
run('pnpm', ['pack', '--pack-destination', packDir], packageRoot)
assertNoWorkspaceRanges()
for (const tarball of readdirSync(packDir).filter((file) => file.endsWith('.tgz'))) {
  assertReleaseTarball(resolve(packDir, tarball))
}
console.log(`Release pack wrote ${readdirSync(packDir).filter((file) => file.endsWith('.tgz')).length} tarball(s) to ${packDir}.`)
