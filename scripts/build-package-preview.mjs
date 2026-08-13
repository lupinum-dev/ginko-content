#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { basename, relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const outputDirectory = resolve(root, '.package-preview')

const status = execFileSync('git', ['status', '--porcelain'], {
  cwd: root,
  encoding: 'utf8',
}).trim()
if (status) throw new Error(`Package preview requires a clean worktree:\n${status}`)

rmSync(outputDirectory, { recursive: true, force: true })
mkdirSync(outputDirectory)
execFileSync('pnpm', ['release:pack'], { cwd: root, stdio: 'inherit' })

const artifact = JSON.parse(readFileSync(resolve(root, '.pack/release-artifact.json'), 'utf8'))
if (artifact.commit !== execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()) {
  throw new Error('Preview artifact commit does not match HEAD.')
}
const source = resolve(root, '.pack', artifact.tarball)
const target = resolve(outputDirectory, basename(source))
copyFileSync(source, target)
const sha256 = createHash('sha256').update(readFileSync(target)).digest('hex')
if (sha256 !== artifact.sha256) throw new Error('Preview tarball failed release-artifact verification.')

const output = [
  `directory=${relative(root, outputDirectory)}`,
  `package_name=${artifact.packageName}`,
  `sha256=${sha256}`,
  `tarball=${relative(root, target)}`,
].join('\n')
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${output}\n`)
console.log(output)

rmSync(resolve(root, '.pack'), { recursive: true, force: true })
const finalStatus = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()
if (finalStatus) throw new Error(`Preview build changed tracked files:\n${finalStatus}`)
