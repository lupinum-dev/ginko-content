// @vitest-environment node

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright-core'
import { startFixtureServer } from '../helpers/fixture-server'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const fixtureDir = resolve(rootDir, 'playground/ginko-i18n')

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
    throw new Error(
      'No Chromium executable found for browser e2e. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE or run `pnpm exec playwright install chromium`.'
    )
  }

  return executablePath
}

function contentPath (url: string) {
  return new URL(url).pathname
}

async function assertHeading (page: Page, name: string) {
  await expect(page.getByRole('heading', { name }).textContent()).resolves.toBe(name)
}

function captureBrowserFailures (page: Page) {
  const consoleErrors: string[] = []
  const failedRequests: string[] = []

  page.on('console', (message) => {
    if (message.type() === 'error' || /hydration|ginko/i.test(message.text())) {
      consoleErrors.push(message.text())
    }
  })
  page.on('requestfailed', (request) => {
    const url = request.url()
    if (url.includes('/api/_content')) {
      failedRequests.push(`${request.failure()?.errorText || 'failed'} ${url}`)
    }
  })
  page.on('response', (response) => {
    const url = response.url()
    if (response.status() >= 400) {
      consoleErrors.push(`${response.status()} ${url}`)
    }
    if (url.includes('/api/_content') && response.status() >= 400) {
      failedRequests.push(`${response.status()} ${url}`)
    }
  })

  return {
    assertClean () {
      expect(consoleErrors).toEqual([])
      expect(failedRequests).toEqual([])
    }
  }
}

describe('browser locale switching and search', () => {
  test('clicks translated locale links and localized search results in a production fixture', async () => {
    const server = await startFixtureServer(fixtureDir)
    let browser: Browser | undefined

    try {
      browser = await chromium.launch({
        executablePath: resolveChromiumExecutable(),
        headless: true
      })
      const page = await browser.newPage()
      const browserFailures = captureBrowserFailures(page)

      await page.goto(`${server.baseURL}/de/leitfaden/erste-schritte`, { waitUntil: 'networkidle' })
      await assertHeading(page, 'Einstieg')

      await page.getByRole('link', { name: 'English' }).click()
      await page.waitForURL('**/guide/getting-started')
      expect(contentPath(page.url())).toBe('/guide/getting-started')
      await assertHeading(page, 'Getting Started')

      await page.getByRole('link', { name: 'Deutsch' }).click()
      await page.waitForURL('**/de/leitfaden/erste-schritte')
      expect(contentPath(page.url())).toBe('/de/leitfaden/erste-schritte')
      await assertHeading(page, 'Einstieg')

      await page.goto(`${server.baseURL}/de/search`, { waitUntil: 'networkidle' })
      await page.getByLabel('Search term').fill('Einstieg')
      const result = page.getByRole('link', { name: 'Einstieg' }).first()
      await result.waitFor()
      await expect(result.getAttribute('href')).resolves.toBe('/de/leitfaden/erste-schritte')
      await result.click()
      await page.waitForURL('**/de/leitfaden/erste-schritte')
      await assertHeading(page, 'Einstieg')

      await page.goBack({ waitUntil: 'networkidle' })
      expect(contentPath(page.url())).toBe('/de/search')

      await page.goForward({ waitUntil: 'networkidle' })
      expect(contentPath(page.url())).toBe('/de/leitfaden/erste-schritte')
      await assertHeading(page, 'Einstieg')

      browserFailures.assertClean()
    } finally {
      await browser?.close()
      await server.stop()
    }
  }, 240000)
})
