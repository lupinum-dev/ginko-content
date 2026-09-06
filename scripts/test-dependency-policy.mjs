import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { checkDependencyPolicy } from './check-dependency-policy.mjs'

const root = resolve(import.meta.dirname, '..')
const source = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')
assert.deepEqual(checkDependencyPolicy(source), [])
const now = Date.parse('2026-09-06T12:00:00Z')
const entry = expires => `\nminimumReleaseAgeExclude:\n  - 'example@1.2.3' # ${JSON.stringify({ reason: 'Reviewed incident', owner: 'mat4m0', expires })}\n`
const directory = mkdtempSync(join(tmpdir(), 'ginko-consumer-policy-'))
try {
  mkdirSync(join(directory, 'scripts'))
  mkdirSync(join(directory, 'consumer'))
  symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'), 'junction')
  for (const file of ['consumer-policy.mjs', 'check-dependency-policy.mjs']) copyFileSync(join(root, 'scripts', file), join(directory, 'scripts', file))
  const { prepareConsumerPolicy } = await import(pathToFileURL(join(directory, 'scripts/consumer-policy.mjs')).href)
  for (const policy of [source, source + entry('2026-09-06T13:00:00Z')]) {
    writeFileSync(join(directory, 'pnpm-workspace.yaml'), policy)
    assert.equal(prepareConsumerPolicy(join(directory, 'consumer'), now), '--before=2026-09-05T12:00:00.000Z')
    const generated = readFileSync(join(directory, 'consumer/pnpm-workspace.yaml'), 'utf8')
    assert.deepEqual(checkDependencyPolicy(generated, now), [])
    assert.doesNotMatch(generated, /^overrides:|^packageExtensions:/m)
    if (policy.includes('example@1.2.3')) assert.match(generated, /2026-09-06T13:00:00Z/)
  }
  for (const [policy, message] of [
    [source + entry('2026-09-06T12:00:00Z'), /expired/],
    [source + entry('2027-09-06T12:00:00Z'), /within 24 hours/],
    [source + entry('2026-02-30T12:00:00Z'), /valid UTC/],
    [source + '\nminimumReleaseAgeExclude: ["example@*"]\n', /exact/],
    [source.replace('minimumReleaseAge: 1440', '# minimumReleaseAge: 1440'), /must be 1440/],
  ]) {
    writeFileSync(join(directory, 'pnpm-workspace.yaml'), policy)
    assert.throws(() => prepareConsumerPolicy(join(directory, 'consumer'), now), message)
  }
} finally {
  rmSync(directory, { recursive: true, force: true })
}
console.log('Root and generated install policy positive/negative checks passed.')
