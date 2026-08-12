// @vitest-environment node

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright-core'
import { startProductionFixtureServer } from '../helpers/production-fixture'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const fixtureDir = resolve(rootDir, 'playground/ginko-basic')

const resolveChromiumExecutable = () => {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    chromium.executablePath(),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
  ].filter((value): value is string => Boolean(value))

  const executablePath = candidates.find(candidate => existsSync(candidate))
  if (!executablePath) {
    throw new Error('No Chromium executable found for content-route navigation coverage.')
  }
  return executablePath
}

const pushRoute = async (page: Page, path: string) => {
  await page.evaluate(async (target) => {
    const root = document.querySelector('#__nuxt')
    const app = root ? Reflect.get(root, '__vue_app__') : undefined
    const router = app?.config.globalProperties.$router
    if (!router) throw new Error('Nuxt Vue Router was not available on the mounted app.')
    await router.push(target)
  }, path)
}

describe('content catch-all route lifecycle', () => {
  test('returns direct 404s and handles valid, missing, and recovery navigation', async () => {
    const server = await startProductionFixtureServer(fixtureDir)
    let browser: Browser | undefined

    try {
      const directMissing = await fetch(`${server.baseURL}/route-lifecycle-missing`)
      expect(directMissing.status).toBe(404)
      await expect(directMissing.text()).resolves.toContain('Document not found')

      browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true })
      const page = await browser.newPage()

      const initial = await page.goto(`${server.baseURL}/guide`, { waitUntil: 'domcontentloaded' })
      expect(initial?.status()).toBe(200)
      await page.getByRole('heading', { name: 'Guide', exact: true }).waitFor()

      await pushRoute(page, '/guide/getting-started')
      await page.waitForURL(url => url.pathname === '/guide/getting-started')
      await page.getByRole('heading', { name: 'Getting Started', exact: true }).waitFor()

      await pushRoute(page, '/route-lifecycle-missing')
      await page.waitForURL(url => url.pathname === '/route-lifecycle-missing')
      await page.getByRole('heading', { name: 'Document not found', exact: true }).waitFor()
      await expect(page.getByText('Getting Started', { exact: true }).count()).resolves.toBe(0)

      const recovered = await page.goto(`${server.baseURL}/guide`, { waitUntil: 'domcontentloaded' })
      expect(recovered?.status()).toBe(200)
      await page.getByRole('heading', { name: 'Guide', exact: true }).waitFor()
    } finally {
      await browser?.close()
      await server.stop()
    }
  }, 240000)
})
