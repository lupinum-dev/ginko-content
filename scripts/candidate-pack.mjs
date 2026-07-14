import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const EXPECTED_VERSION = '0.4.0-rc.1'
const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packageRoot = resolve(repoRoot, 'packages/content')
const outputRoot = resolve(repoRoot, '.pack/candidate')

function run(command, args, cwd = repoRoot, stdio = 'inherit') {
  return execFileSync(command, args, {
    cwd,
    encoding: stdio === 'pipe' ? 'utf8' : undefined,
    env: { ...process.env, npm_config_verify_deps_before_run: 'false' },
    stdio,
  })
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function gitStatus() {
  return run('git', ['status', '--porcelain', '--untracked-files=normal'], repoRoot, 'pipe').trim()
}

function assertClean(stage) {
  const status = gitStatus()
  if (status) throw new Error(`Candidate packing requires a clean repository (${stage}):\n${status}`)
}

function fileManifest(root) {
  const files = []
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) {
        const stat = lstatSync(path)
        files.push({
          path: relative(root, path).replaceAll('\\', '/'),
          mode: stat.mode & 0o777,
          bytes: stat.size,
          sha256: sha256(path),
        })
      }
    }
  }
  visit(root)
  return files.sort((left, right) => left.path.localeCompare(right.path))
}

function packOnce(parent, index) {
  const packRoot = resolve(parent, `pack-${index}`)
  const extractRoot = resolve(parent, `extract-${index}`)
  mkdirSync(packRoot)
  mkdirSync(extractRoot)
  run('pnpm', ['pack', '--pack-destination', packRoot], packageRoot)
  const tarballs = readdirSync(packRoot).filter(file => file.endsWith('.tgz'))
  if (tarballs.length !== 1) {
    throw new Error(`Candidate pack ${index} expected one tarball, found ${tarballs.length}.`)
  }
  const path = resolve(packRoot, tarballs[0])
  run('tar', ['-xzf', path, '-C', extractRoot])
  const extractedPackage = resolve(extractRoot, 'package')
  const manifest = JSON.parse(readFileSync(resolve(extractedPackage, 'package.json'), 'utf8'))
  if (manifest.name !== '@lupinum/ginko-content' || manifest.version !== EXPECTED_VERSION) {
    throw new Error(
      `Candidate pack ${index} contains ${manifest.name}@${manifest.version}; expected @lupinum/ginko-content@${EXPECTED_VERSION}.`,
    )
  }
  return {
    path,
    filename: tarballs[0],
    sha256: sha256(path),
    files: fileManifest(extractedPackage),
    packageManifest: manifest,
  }
}

assertClean('before pack')
const sourceManifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'))
if (sourceManifest.version !== EXPECTED_VERSION) {
  throw new Error(`Candidate source version is ${sourceManifest.version}; expected ${EXPECTED_VERSION}.`)
}

const temporaryRoot = mkdtempSync(join(tmpdir(), 'ginko-content-candidate-pack-'))
try {
  const first = packOnce(temporaryRoot, 1)
  assertClean('after first pack')
  const second = packOnce(temporaryRoot, 2)
  assertClean('after second pack')

  if (first.sha256 !== second.sha256) {
    throw new Error(`Candidate archives differ: ${first.sha256} != ${second.sha256}`)
  }
  if (JSON.stringify(first.files) !== JSON.stringify(second.files)) {
    throw new Error('Candidate content manifests differ between serial packs.')
  }
  if (JSON.stringify(first.packageManifest) !== JSON.stringify(second.packageManifest)) {
    throw new Error('Candidate package manifests differ between serial packs.')
  }

  rmSync(outputRoot, { recursive: true, force: true })
  mkdirSync(outputRoot, { recursive: true })
  const tarballPath = resolve(outputRoot, first.filename)
  if (existsSync(tarballPath)) throw new Error(`Candidate artifact already exists: ${tarballPath}`)
  copyFileSync(first.path, tarballPath)

  const evidence = {
    format: 'ginko-content-candidate-artifact',
    version: 1,
    package: '@lupinum/ginko-content',
    packageVersion: EXPECTED_VERSION,
    commit: run('git', ['rev-parse', 'HEAD'], repoRoot, 'pipe').trim(),
    worktreeDirty: false,
    node: process.version,
    pnpm: run('pnpm', ['--version'], repoRoot, 'pipe').trim(),
    tarball: first.filename,
    sha256: first.sha256,
    reproduciblePacks: 2,
    files: first.files,
  }
  writeFileSync(resolve(outputRoot, 'candidate-artifact.json'), `${JSON.stringify(evidence, null, 2)}\n`)
  console.log(`Candidate artifact: ${tarballPath}`)
  console.log(`SHA-256: ${first.sha256}`)
  console.log(`Evidence: ${resolve(outputRoot, 'candidate-artifact.json')}`)
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}
