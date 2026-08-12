// @vitest-environment node

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright-core'
import { startProductionFixtureServer } from '../helpers/production-fixture'
import { buildRouteManifest, navigableRoutesFromManifest } from '../helpers/route-manifest'
import { isExpectedNuxtPayloadCancellation } from '../helpers/browser-failures'

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
      'No Chromium executable found for browser e2e. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE or install Chromium.'
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

async function waitForRenderedNuxtApp (page: Page) {
  await page.locator('#__nuxt').waitFor({ state: 'attached' })
  await page.waitForFunction(() => {
    const root = document.querySelector('#__nuxt')
    return Boolean(root?.textContent?.trim()) && !document.documentElement.innerHTML.includes('__NUXT_LOADING__')
  })
  await page.waitForLoadState('networkidle')
}

function captureBrowserFailures (page: Page, baseURL: string) {
  let failures: string[] = []
  const isSameOrigin = (url: string) => new URL(url).origin === new URL(baseURL).origin

  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error' || /hydration/i.test(message.text())) {
      failures.push(`console ${message.type()}: ${message.text()}`)
    }
  })
  page.on('requestfailed', (request) => {
    const errorText = request.failure()?.errorText
    if (isSameOrigin(request.url()) && !isExpectedNuxtPayloadCancellation(request.url(), errorText, baseURL)) {
      failures.push(`request failed: ${errorText || 'unknown'} ${request.url()}`)
    }
  })
  page.on('response', (response) => {
    if (isSameOrigin(response.url()) && response.status() >= 400) {
      failures.push(`response ${response.status()}: ${response.url()}`)
    }
  })

  return {
    assertClean (context: string) {
      const captured = failures
      failures = []
      expect(captured, `browser failures while visiting ${context}`).toEqual([])
    }
  }
}

describe('browser production confidence', () => {
  test('clicks translated locale links and localized search results', async () => {
    const server = await startProductionFixtureServer(fixtureDir)
    let browser: Browser | undefined

    try {
      browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true })
      const page = await browser.newPage()
      const browserFailures = captureBrowserFailures(page, server.baseURL)

      await page.goto(`${server.baseURL}/de/leitfaden/erste-schritte`, { waitUntil: 'domcontentloaded' })
      await waitForRenderedNuxtApp(page)
      await assertHeading(page, 'Einstieg')

      await page.getByRole('link', { name: 'English' }).click()
      await page.waitForURL('**/guide/getting-started')
      await waitForRenderedNuxtApp(page)
      expect(contentPath(page.url())).toBe('/guide/getting-started')
      await assertHeading(page, 'Getting Started')

      await page.getByRole('link', { name: 'Deutsch' }).click()
      await page.waitForURL('**/de/leitfaden/erste-schritte')
      await waitForRenderedNuxtApp(page)
      await assertHeading(page, 'Einstieg')

      await page.goto(`${server.baseURL}/de/search`, { waitUntil: 'domcontentloaded' })
      await waitForRenderedNuxtApp(page)
      await page.getByLabel('Search term').fill('Einstieg')
      const result = page.getByRole('link', { name: 'Einstieg' }).first()
      await result.waitFor()
      await expect(result.getAttribute('href')).resolves.toBe('/de/leitfaden/erste-schritte')
      await result.click()
      await page.waitForURL('**/de/leitfaden/erste-schritte')
      await waitForRenderedNuxtApp(page)
      await assertHeading(page, 'Einstieg')

      await page.goBack({ waitUntil: 'domcontentloaded' })
      await waitForRenderedNuxtApp(page)
      expect(contentPath(page.url())).toBe('/de/search')
      await page.goForward({ waitUntil: 'domcontentloaded' })
      await waitForRenderedNuxtApp(page)
      expect(contentPath(page.url())).toBe('/de/leitfaden/erste-schritte')
      await assertHeading(page, 'Einstieg')

      browserFailures.assertClean('locale/search interaction')
    } finally {
      await browser?.close()
      await server.stop()
    }
  }, 240000)

  test('hydrates every emitted i18n HTML route without browser or same-origin failures', async () => {
    const server = await startProductionFixtureServer(fixtureDir)
    let browser: Browser | undefined

    try {
      const routes = navigableRoutesFromManifest(await buildRouteManifest(server.publicDir))
      // The fixture's route count grew from 40 to 42 once `/internal/secret`'s
      // Nuxt-I18n-generated `/de/internal/secret` counterpart and the
      // round-trip-identity cross-mount alias routes (`/de/guide/*`,
      // `/leitfaden/*`) became real, crawled, navigable routes instead of silently 404-ing — see
      // `test/golden/routes/ginko-i18n.txt`. Raise this cap again, and add
      // explicit sampling instead of testing every route, before it grows
      // much further.
      expect(routes.length, 'explicitly define deterministic sampling before the browser fixture exceeds 45 routes').toBeLessThanOrEqual(45)
      expect(routes).toEqual(expect.arrayContaining([
        '/guide/getting-started',
        '/de/leitfaden/erste-schritte'
      ]))

      browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true })
      const page = await browser.newPage()
      const browserFailures = captureBrowserFailures(page, server.baseURL)

      for (const route of routes) {
        const response = await page.goto(`${server.baseURL}${route}`, { waitUntil: 'domcontentloaded' })
        expect(response?.status(), `${route} should return a successful document`).toBeLessThan(400)
        await waitForRenderedNuxtApp(page)
        browserFailures.assertClean(route)
      }
    } finally {
      await browser?.close()
      await server.stop()
    }
  }, 300000)
})
