// @vitest-environment node

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { chromium, type Browser } from 'playwright-core'
import { startProductionFixtureServer } from '../helpers/production-fixture'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const fixtureDir = resolve(rootDir, 'playground/ginko-search')

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
    throw new Error(
      'No Chromium executable found for browser e2e. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE or install Chromium.'
    )
  }
  return executablePath
}

describe('Pagefind browser lifecycle', () => {
  test('hydrates a non-empty initial query and searches only in the browser', async () => {
    const server = await startProductionFixtureServer(fixtureDir, undefined, {
      CONTENT_SEARCH_ENGINE: 'pagefind'
    })
    let browser: Browser | undefined

    try {
      browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true })
      const page = await browser.newPage()
      const failures: string[] = []
      const requests: string[] = []
      page.on('pageerror', error => failures.push(`pageerror: ${error.message}`))
      page.on('console', (message) => {
        if (message.type() === 'error' || /hydration/i.test(message.text())) {
          failures.push(`console ${message.type()}: ${message.text()}`)
        }
      })
      page.on('request', request => requests.push(request.url()))
      page.on('requestfailed', request => failures.push(`request failed: ${request.failure()?.errorText || 'unknown'} ${request.url()}`))

      const response = await page.goto(server.baseURL, { waitUntil: 'domcontentloaded' })
      expect(response?.status()).toBe(200)
      await page.locator('#results').waitFor()
      await page.waitForFunction(() => document.querySelector('#results')?.textContent?.includes('Searchable Guide'))
      await expect(page.locator('#pending').textContent()).resolves.toBe('false')
      expect(await page.locator('#results').textContent()).toContain('/guide/getting-started')
      await expect(page.locator('#inline-baseline').getAttribute('data-alert')).resolves.toBe(null)
      expect(await page.locator('#inline-baseline').innerHTML()).toContain('data-alert="note"')
      await page.locator('#update-inline').click()
      await page.waitForFunction(() => document.querySelector('#inline-baseline')?.textContent?.includes('Updated inline value'))
      expect(await page.locator('#inline-baseline').textContent()).not.toContain('Stale intermediate value')
      await expect(page.locator('#inline-baseline input[type="checkbox"]').getAttribute('checked')).resolves.not.toBeNull()
      expect(requests.filter(url => url.endsWith('/pagefind/ginko-locales.json'))).toHaveLength(1)
      expect(failures).toEqual([])
    } finally {
      await browser?.close()
      await server.stop()
    }
  }, 240000)
})
