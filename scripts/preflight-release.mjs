#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packageJsonPath = resolve(repoRoot, 'packages/content/package.json')
const changelogPath = resolve(repoRoot, 'CHANGELOG.md')

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
const version = manifest.version

if (typeof version !== 'string' || version.length === 0) {
  console.error('[release preflight] packages/content/package.json is missing a version.')
  process.exit(1)
}

const errors = []
const changelog = readFileSync(changelogPath, 'utf8')
const changelogSection = new RegExp(`^##\\s+v?${escapeRegExp(version)}(?:\\s|$)`, 'm')
if (!changelogSection.test(changelog)) {
  errors.push(`CHANGELOG.md lacks a section for ${version} (expected "## v${version}").`)
}

const tagName = `v${version}`
try {
  execFileSync('git', ['rev-parse', '--verify', `refs/tags/${tagName}`], {
    cwd: repoRoot,
    stdio: 'ignore',
  })
} catch {
  errors.push(`git tag ${tagName} is missing.`)
}

if (errors.length > 0) {
  console.error('[release preflight] refusing to publish:')
  for (const error of errors) {
    console.error(`  - ${error}`)
  }
  process.exit(1)
}

console.log(`[release preflight] ${manifest.name}@${version}: changelog section and ${tagName} tag present.`)
