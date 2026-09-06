// @vitest-environment node

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright-core'
import { describe, expect, test } from 'vitest'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const fixtureSource = resolve(rootDir, 'test/fixtures/dev-hot-reload')

function resolveChromiumExecutable () {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    chromium.executablePath(),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
  ].filter((value): value is string => Boolean(value))
  const executablePath = candidates.find(candidate => existsSync(candidate))
  if (!executablePath) {
    throw new Error('No Chromium executable found for dev hot-reload coverage.')
  }
  return executablePath
}

async function allocatePort () {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
  })
  if (!port) {
    throw new Error('Failed to allocate a dev hot-reload fixture port.')
  }
  return port
}

async function stopChild (child: ChildProcess) {
  const waitForExit = async (timeout: number) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      return true
    }

    return await new Promise<boolean>((resolve) => {
      const onExit = () => {
        clearTimeout(timer)
        resolve(true)
      }
      const timer = setTimeout(() => {
        child.off('exit', onExit)
        resolve(false)
      }, timeout)
      child.once('exit', onExit)
    })
  }

  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }

  child.kill('SIGTERM')
  if (await waitForExit(5_000)) {
    return
  }

  child.kill('SIGKILL')
  if (!await waitForExit(5_000)) {
    throw new Error('Nuxt dev fixture did not exit after SIGKILL.')
  }
}

async function waitForDevServer (baseURL: string, child: ChildProcess, output: () => string) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Dev fixture exited before becoming ready.\n${output()}`)
    }
    try {
      const response = await fetch(baseURL, { signal: AbortSignal.timeout(2_000) })
      if (response.ok) {
        return
      }
    } catch {
      // The listener is not ready yet.
    }
    await delay(100)
  }
  throw new Error(`Timed out waiting for dev fixture.\n${output()}`)
}

async function startDevServer (cwd: string, appendOutput: (text: string) => void) {
  const port = await allocatePort()
  const baseURL = `http://127.0.0.1:${port}`
  let output = ''
  const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => ![
    'TEST', 'VITEST', 'VITEST_WORKER_ID', 'VITEST_POOL_ID'
  ].includes(key)))
  const child = spawn(process.execPath, [
    resolve(rootDir, 'node_modules/nuxt/bin/nuxt.mjs'), 'dev', '--no-fork',
    '--host=127.0.0.1', `--port=${port}`
  ], { cwd, env: { ...childEnv, NODE_ENV: 'development' }, stdio: ['ignore', 'pipe', 'pipe'] })
  const record = (chunk: Buffer) => {
    output += chunk.toString()
    appendOutput(chunk.toString())
  }
  child.stdout?.on('data', record)
  child.stderr?.on('data', record)
  try {
    await waitForDevServer(baseURL, child, () => output)
    return { child, baseURL }
  } catch (error) {
    await stopChild(child)
    throw error
  }
}

describe('content development hot reload', () => {
  test('serves maintained pages with automatic imports disabled', async () => {
    const { child, baseURL } = await startDevServer(resolve(rootDir, 'playground/ginko-basic'), () => {})
    let browser: Browser | undefined
    try {
      browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true })
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      const content = await page.goto(`${baseURL}/guide/getting-started`, { waitUntil: 'networkidle' })
      expect(content?.status()).toBe(200)
      expect(await page.getByRole('heading', { name: 'Getting Started' }).isVisible()).toBe(true)
      const missing = await page.goto(`${baseURL}/missing-dev-contract`, { waitUntil: 'networkidle' })
      expect(missing?.status()).toBe(404)
      await page.getByRole('link', { name: 'Go back home' }).click()
      await page.waitForURL(baseURL + '/')
      await page.getByRole('heading', { name: 'Ginko', exact: true }).waitFor({ state: 'visible' })
      expect((await page.reload({ waitUntil: 'networkidle' }))?.status()).toBe(200)
      expect(errors).toEqual([])
    } finally {
      try {
        await browser?.close()
      } finally {
        await stopChild(child)
      }
    }
  }, 120_000)

  test('refreshes source edits and automatically reloads collection config', async () => {
    const tempRoot = resolve(rootDir, '.tmp')
    let fixtureDir: string | undefined
    let child: ChildProcess | undefined
    let browser: Browser | undefined
    let output = ''
    const webSocketFrames: string[] = []
    try {
      await mkdir(tempRoot, { recursive: true })
      const workingFixtureDir = await mkdtemp(resolve(tempRoot, 'dev-hot-reload-'))
      fixtureDir = workingFixtureDir
      await cp(fixtureSource, workingFixtureDir, { recursive: true })

      const started = await startDevServer(workingFixtureDir, text => { output += text })
      child = started.child
      const { baseURL } = started
      browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true })
      const page = await browser.newPage()
      page.on('console', message => { output += `\n[browser ${message.type()}] ${message.text()}` })
      page.on('pageerror', error => { output += `\n[browser pageerror] ${error.message}` })
      page.on('websocket', (socket) => {
        socket.on('framereceived', frame => webSocketFrames.push(String(frame.payload)))
      })
      const initialResponse = await page.goto(baseURL, { waitUntil: 'domcontentloaded' })
      if (!initialResponse || initialResponse.status() >= 400) {
        throw new Error(`Initial fixture response failed with ${initialResponse?.status() || 'no status'}.`)
      }

      const clientReady = page.getByTestId('client-ready')
      const bootId = page.getByTestId('boot-id')
      const watchedTitle = page.getByTestId('watched-title')
      const cacheMarker = page.getByTestId('cache-marker')
      const secondaryTitle = page.getByTestId('secondary-title')
      try {
        await bootId.waitFor({ state: 'attached', timeout: 20_000 })
      } catch (error) {
        const body = (await page.locator('body').textContent() || '').slice(0, 4_000)
        throw new Error([
          error instanceof Error ? error.message : String(error),
          `Initial response: ${initialResponse?.status() || 'none'}`,
          `Rendered body: ${body}`
        ].join('\n\n'))
      }
      await expect.poll(() => clientReady.textContent()).toBe('true')
      await expect.poll(() => bootId.textContent()).not.toBe('')
      await expect.poll(() => watchedTitle.textContent()).toBe('Initial watched title')
      await expect.poll(() => cacheMarker.textContent()).toBe('initial-schema')
      const initialBootId = await bootId.textContent()
      const sentinel = await page.evaluate(() => {
        const value = crypto.randomUUID()
        ;(window as typeof window & { __ginkoHmrSentinel?: string }).__ginkoHmrSentinel = value
        return value
      })

      await writeFile(resolve(workingFixtureDir, 'content/watched.md'), [
        '---',
        'title: Updated watched title',
        '---',
        '',
        'Updated body.'
      ].join('\n'))

      await expect.poll(async () => {
        const response = await fetch(`${baseURL}/api/hmr-state`, {
          signal: AbortSignal.timeout(2_000)
        })
        return (await response.json() as { watchedTitle?: string }).watchedTitle
      }, { timeout: 30_000 }).toBe('Updated watched title')
      await expect.poll(() => watchedTitle.textContent(), { timeout: 30_000 }).toBe('Updated watched title')
      await expect.poll(() => bootId.textContent()).toBe(initialBootId)
      await expect(page.evaluate(() => (
        window as typeof window & { __ginkoHmrSentinel?: string }
      ).__ginkoHmrSentinel)).resolves.toBe(sentinel)

      await writeFile(resolve(workingFixtureDir, 'content.config.ts'), [
        "import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'",
        "import { z } from 'zod'",
        '',
        'export const pages = defineCollection({',
        "  type: 'page',",
        "  source: 'watched.md',",
        "  schema: z.object({ cacheMarker: z.string().default('updated-schema') })",
        '})',
        "export const secondary = defineCollection({ type: 'page', source: 'config-only.md' })",
        '',
        'export default defineContentConfig({',
        '  collections: { pages, secondary }',
        '})'
      ].join('\n'))

      await expect.poll(() => secondaryTitle.textContent(), { timeout: 90_000 }).toBe('Config collection title')
      await expect.poll(() => cacheMarker.textContent(), { timeout: 90_000 }).toBe('updated-schema')
      await expect.poll(() => bootId.textContent(), { timeout: 90_000 }).not.toBe(initialBootId)
    } catch (error) {
      throw new Error([
        error instanceof Error ? error.message : String(error),
        `Vite WebSocket frames:\n${webSocketFrames.join('\n') || '(none)'}`,
        `Dev server output:\n${output}`
      ].join('\n\n'))
    } finally {
      try {
        await browser?.close()
      } finally {
        try {
          if (child) {
            await stopChild(child)
          }
        } finally {
          if (fixtureDir) {
            await rm(fixtureDir, { recursive: true, force: true })
          }
        }
      }
    }
  }, 240_000)
})
