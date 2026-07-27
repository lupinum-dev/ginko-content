import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertContentReleaseCertification,
  npmTagForVersion
} from './lib/release-publish.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const registry = 'https://registry.npmjs.org/'
const checkOnly = process.argv.includes('--check')
const manifest = readJson('packages/content/package.json')
const npmTag = npmTagForVersion(manifest.version)
const artifact = readJson('.pack/release-artifact.json')
const certification = readJson('.pack/release-certification.json')
const tarball = resolve(root, '.pack', artifact.tarball)
const commit = run('git', ['rev-parse', 'HEAD'])
const dirty = run('git', ['status', '--porcelain'])

if (dirty) fail('The source tree is dirty. Commit every release change before publishing.')
if (artifact.worktreeDirty || !artifact.releaseEligible || artifact.reproduciblePacks !== 2) {
  fail('The release artifact was not created from a clean, release-eligible source tree.')
}
if (artifact.commit !== commit) fail('The release artifact does not belong to the current commit.')
if (artifact.packageName !== manifest.name || artifact.packageVersion !== manifest.version) {
  fail('The release artifact identity does not match packages/content/package.json.')
}
if (
  certification.packageName !== artifact.packageName ||
  certification.packageVersion !== artifact.packageVersion ||
  certification.commit !== artifact.commit ||
  certification.tarball !== artifact.tarball ||
  certification.sha256 !== artifact.sha256
) {
  fail('The release certification does not match the release artifact.')
}
try {
  assertContentReleaseCertification(certification)
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
if (!existsSync(tarball)) fail(`The verified tarball is missing: ${artifact.tarball}`)
if (sha256(tarball) !== artifact.sha256) {
  fail('The tarball SHA-256 does not match its release evidence.')
}

const spec = `${manifest.name}@${manifest.version}`
const lookup = spawnSync('npm', ['view', spec, 'version', `--registry=${registry}`], {
  cwd: root,
  encoding: 'utf8',
})
if (lookup.status === 0) fail(`${spec} is already published.`)
if (!`${lookup.stdout}\n${lookup.stderr}`.includes('E404')) {
  fail(`Could not confirm that ${spec} is unpublished.\n${lookup.stderr.trim()}`)
}

if (checkOnly) {
  console.log(`${spec} is ready to publish from ${artifact.tarball} with npm tag ${npmTag}.`)
  process.exit(0)
}

console.log(`Publishing ${spec} from ${artifact.tarball} (${artifact.sha256}).`)
execFileSync(
  'npm',
  ['publish', tarball, '--access', 'public', '--tag', npmTag, `--registry=${registry}`],
  { cwd: root, stdio: 'inherit' },
)

await confirmPublishedVersion(spec, manifest.version)
console.log(`Published and confirmed ${spec}.`)

function readJson(path) {
  const absolutePath = resolve(root, path)
  if (!existsSync(absolutePath)) fail(`Missing release evidence: ${path}`)
  return JSON.parse(readFileSync(absolutePath, 'utf8'))
}

function run(command, args) {
  return execFileSync(command, args, { cwd: root, encoding: 'utf8' }).trim()
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

async function confirmPublishedVersion(spec, expectedVersion) {
  let lastError = ''
  for (let attempt = 0; attempt < 12; attempt++) {
    const result = spawnSync('npm', ['view', spec, 'version', `--registry=${registry}`], {
      cwd: root,
      encoding: 'utf8',
    })
    if (result.status === 0 && result.stdout.trim() === expectedVersion) return
    lastError = `${result.stdout}\n${result.stderr}`.trim()
    if (attempt < 11) {
      await new Promise(resolve => setTimeout(resolve, 5_000))
    }
  }
  fail(`npm did not confirm ${spec} after publishing.${lastError ? `\n${lastError}` : ''}`)
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
