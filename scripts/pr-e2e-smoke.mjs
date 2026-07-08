#!/usr/bin/env node
// Slim PR e2e smoke (T6.3).
//
// The full browser-e2e / search-matrix / sitemap-static suites are heavy and
// stay gated on the main-only `release-verify` job. This script is the fast
// (<3 min) PR canary: it builds the `playground/ginko-basic` fixture, boots the
// production Nitro server, and asserts that the three load-bearing surfaces
// respond 200 with expected content:
//   1. `/`                          — homepage renders content/index.md
//   2. `/guide/getting-started`     — one nested content route
//   3. `/api/_content/search/index.json` — the search index endpoint
//
// It intentionally lives outside the vitest suite (nothing in test/ changes) so
// the CI job is a single self-contained command. Exit 0 = smoke passed.

import { execSync, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixtureDir = resolve(workspaceRoot, 'playground/ginko-basic')

function run (command, cwd) {
  execSync(command, {
    cwd,
    env: { ...process.env, NODE_ENV: 'production' },
    stdio: 'inherit'
  })
}

async function allocatePort () {
  const server = createServer()
  await new Promise((res, rej) => {
    server.once('error', rej)
    server.listen(0, '127.0.0.1', () => res())
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((res, rej) => server.close(err => err ? rej(err) : res()))
  if (!port) throw new Error('Failed to allocate smoke server port')
  return port
}

async function waitForServer (child, baseURL, getOutput) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (child.exitCode !== null) {
      throw new Error(`Fixture server exited early\n${getOutput()}`)
    }
    try {
      const response = await fetch(`${baseURL}/`, { redirect: 'manual' })
      if (response.ok || response.status === 404) {
        const html = await response.text()
        if (!html.includes('__NUXT_LOADING__')) return
      }
    } catch {
      // still booting
    }
    await delay(100)
  }
  throw new Error(`Timed out waiting for fixture server\n${getOutput()}`)
}

async function assertContains (baseURL, path, needle) {
  const response = await fetch(`${baseURL}${path}`)
  if (response.status !== 200) {
    throw new Error(`${path} responded ${response.status}, expected 200`)
  }
  const body = await response.text()
  if (!body.includes(needle)) {
    throw new Error(`${path} (200) did not contain expected content: ${needle}`)
  }
  console.log(`  ok  ${path} -> 200, contains "${needle}"`)
}

async function main () {
  console.log('[pr-e2e-smoke] building workspace packages...')
  run('pnpm build:packages', workspaceRoot)

  console.log('[pr-e2e-smoke] building playground/ginko-basic...')
  run('pnpm exec nuxi build', fixtureDir)

  const port = await allocatePort()
  const host = '127.0.0.1'
  const baseURL = `http://${host}:${port}`
  let output = ''

  console.log(`[pr-e2e-smoke] starting server on ${baseURL} ...`)
  const child = spawn('node', ['.output/server/index.mjs'], {
    cwd: fixtureDir,
    env: { ...process.env, PORT: String(port), HOST: host, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout?.on('data', chunk => { output += chunk.toString() })
  child.stderr?.on('data', chunk => { output += chunk.toString() })

  const stop = async () => {
    if (child.exitCode !== null) return
    child.kill('SIGTERM')
    for (let i = 0; i < 50; i++) {
      if (child.exitCode !== null) return
      await delay(100)
    }
    child.kill('SIGKILL')
  }

  try {
    await waitForServer(child, baseURL, () => output)
    console.log('[pr-e2e-smoke] server ready, asserting routes...')
    await assertContains(baseURL, '/', 'Ginko')
    await assertContains(baseURL, '/guide/getting-started', 'Getting Started')
    await assertContains(baseURL, '/api/_content/search/index.json', '/guide/getting-started')
    console.log('[pr-e2e-smoke] all smoke assertions passed')
  } finally {
    await stop()
  }
}

main().catch((error) => {
  console.error(`[pr-e2e-smoke] FAILED: ${error.message}`)
  process.exitCode = 1
})
