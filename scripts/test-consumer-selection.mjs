import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { selectNuxtVersion } from './test-packed-consumer.mjs'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
assert.equal(selectNuxtVersion([], {}), manifest.devDependencies.nuxt)
assert.equal(selectNuxtVersion([], { GINKO_CONSUMER_NUXT_VERSION: '4.5.1' }), '4.5.1')
assert.equal(selectNuxtVersion([], { GINKO_CONSUMER_NUXT_VERSION: 'next' }), 'next')
assert.equal(selectNuxtVersion(['--nuxt-version', '4.5.2'], { GINKO_CONSUMER_NUXT_VERSION: 'next' }), '4.5.2')
assert.throws(() => selectNuxtVersion(['--nuxt-version'], {}), /Missing/)
for (const name of ['test:package-consumer', 'test:package-consumer:npm']) {
  assert.doesNotMatch(manifest.scripts[name], /--nuxt-version/, `${name} must not override canary selection`)
}

const directory = mkdtempSync(join(tmpdir(), 'ginko-canary-selection-'))
try {
  mkdirSync(join(directory, 'scripts'))
  mkdirSync(join(directory, 'packages/content'), { recursive: true })
  copyFileSync(new URL('./prepare-deps-canary.mjs', import.meta.url), join(directory, 'scripts/prepare-deps-canary.mjs'))
  const published = JSON.parse(readFileSync(new URL('../packages/content/package.json', import.meta.url), 'utf8'))
  const floor = /^>=([0-9]+\.[0-9]+\.[0-9]+) <5$/.exec(published.peerDependencies.nuxt)[1]
  for (const [mode, expected] of [['minimum-nuxt', floor], ['latest-supported', published.peerDependencies.nuxt], ['future', '6.0.0']]) {
    writeFileSync(join(directory, 'package.json'), JSON.stringify(manifest))
    writeFileSync(join(directory, 'packages/content/package.json'), JSON.stringify(published))
    const run = spawnSync(process.execPath, [join(directory, 'scripts/prepare-deps-canary.mjs'), mode, '--allow-local'], {
      encoding: 'utf8', env: { ...process.env, GINKO_CANARY_NUXT_VERSION: '6.0.0' },
    })
    assert.equal(run.status, 0, run.stderr)
    assert.equal(JSON.parse(run.stdout).nuxtVersion, expected)
    assert.equal(JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).devDependencies.nuxt, expected)
    assert.equal(JSON.parse(readFileSync(join(directory, 'packages/content/package.json'), 'utf8')).devDependencies.nuxt, expected)
  }
} finally {
  rmSync(directory, { recursive: true, force: true })
}

console.log('Packed consumer and canary Nuxt selection checks passed.')
