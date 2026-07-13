import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const INTENDED_VERSION = '0.4.0-rc.1'
const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packageRoot = resolve(repoRoot, 'packages/content')
const outputRoot = resolve(repoRoot, '.pack/dev')

const run = (command, args, cwd = repoRoot, stdio = 'inherit') => execFileSync(command, args, {
  cwd,
  encoding: stdio === 'pipe' ? 'utf8' : undefined,
  env: { ...process.env, npm_config_verify_deps_before_run: 'false' },
  stdio,
})

const sha256File = path => createHash('sha256').update(readFileSync(path)).digest('hex')

function fileManifest(root) {
  const files = []
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) {
        files.push({
          path: relative(root, path).replaceAll('\\', '/'),
          bytes: statSync(path).size,
          sha256: sha256File(path),
        })
      }
    }
  }
  visit(root)
  return files.sort((left, right) => left.path.localeCompare(right.path))
}

mkdirSync(outputRoot, { recursive: true })
run('pnpm', ['run', 'build:packages'])

const temporaryRoot = mkdtempSync(join(tmpdir(), 'ginko-content-dev-pack-'))
try {
  const stagingRoot = resolve(temporaryRoot, 'package')
  mkdirSync(stagingRoot)
  for (const file of ['compatibility.json', 'README.md', 'LICENSE']) {
    copyFileSync(resolve(packageRoot, file), resolve(stagingRoot, file))
  }
  cpSync(resolve(packageRoot, 'dist'), resolve(stagingRoot, 'dist'), { recursive: true })

  const sourceManifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'))
  const stagingManifest = {
    ...sourceManifest,
    version: INTENDED_VERSION,
    scripts: Object.fromEntries(
      Object.entries(sourceManifest.scripts ?? {}).filter(([name]) => !['prepack', 'prepublishOnly'].includes(name)),
    ),
  }
  writeFileSync(resolve(stagingRoot, 'package.json'), `${JSON.stringify(stagingManifest, null, 2)}\n`)

  const packOutput = resolve(temporaryRoot, 'packed')
  mkdirSync(packOutput)
  run('pnpm', ['pack', '--pack-destination', packOutput], stagingRoot)
  const packed = readdirSync(packOutput).filter(file => file.endsWith('.tgz'))
  if (packed.length !== 1) throw new Error(`Development pack expected one tarball, found ${packed.length}.`)

  const temporaryTarball = resolve(packOutput, packed[0])
  const sha256 = sha256File(temporaryTarball)
  const commit = run('git', ['rev-parse', '--short=12', 'HEAD'], repoRoot, 'pipe').trim()
  const filename = `ginko-content-${INTENDED_VERSION}-dev.${commit}.${sha256}.tgz`
  const finalTarball = resolve(outputRoot, filename)
  if (existsSync(finalTarball)) throw new Error(`Development artifact already exists: ${finalTarball}`)

  const inspectionRoot = resolve(temporaryRoot, 'inspection')
  mkdirSync(inspectionRoot)
  run('tar', ['-xzf', temporaryTarball, '-C', inspectionRoot])
  const packagedManifest = JSON.parse(readFileSync(resolve(inspectionRoot, 'package/package.json'), 'utf8'))
  if (packagedManifest.version !== INTENDED_VERSION) {
    throw new Error(`Development artifact has version ${packagedManifest.version}, expected ${INTENDED_VERSION}.`)
  }

  const worktreeDirty = run('git', ['status', '--porcelain', '--untracked-files=normal'], repoRoot, 'pipe').trim().length > 0
  const metadata = {
    format: 'ginko-content-development-artifact',
    version: 1,
    package: '@lupinum/ginko-content',
    packageVersion: INTENDED_VERSION,
    commit,
    worktreeDirty,
    node: process.version,
    pnpm: run('pnpm', ['--version'], repoRoot, 'pipe').trim(),
    tarball: filename,
    sha256,
    files: fileManifest(resolve(inspectionRoot, 'package')),
  }

  const temporaryOutput = resolve(outputRoot, `.${filename}.tmp`)
  const metadataName = `${filename}.json`
  const temporaryMetadata = resolve(outputRoot, `.${metadataName}.tmp`)
  const finalMetadata = resolve(outputRoot, metadataName)
  if (existsSync(finalMetadata)) throw new Error(`Development artifact metadata already exists: ${finalMetadata}`)
  copyFileSync(temporaryTarball, temporaryOutput)
  writeFileSync(temporaryMetadata, `${JSON.stringify(metadata, null, 2)}\n`)
  renameSync(temporaryOutput, finalTarball)
  renameSync(temporaryMetadata, finalMetadata)

  console.log(`Development artifact: ${finalTarball}`)
  console.log(`SHA-256: ${sha256}`)
  console.log(`Evidence: ${finalMetadata}`)
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}
