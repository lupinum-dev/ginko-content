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
  let expectedPayloadCancellations: string[] = []
  const isSameOrigin = (url: string) => new URL(url).origin === new URL(baseURL).origin

  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error' || /hydration/i.test(message.text())) {
      failures.push(`console ${message.type()}: ${message.text()}`)
    }
  })
  page.on('requestfailed', (request) => {
    const errorText = request.failure()?.errorText
    if (isExpectedNuxtPayloadCancellation(request.url(), errorText, baseURL)) {
      expectedPayloadCancellations.push(request.url())
    } else if (isSameOrigin(request.url())) {
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
      const cancellations = expectedPayloadCancellations
      failures = []
      expectedPayloadCancellations = []
      expect(
        captured,
        `browser failures while visiting ${context}; canceled payload requests: ${cancellations.join(', ') || 'none'}`
      ).toEqual([])
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

      // Inspect the original HTML, before hydration can repair a guessed link.
      const html = await fetch(`${server.baseURL}/de/leitfaden/erste-schritte`).then(response => response.text())
      const header = html.match(/<header\b[^>]*>([\s\S]*?)<\/header>/)?.[1]
      expect(header).toContain('href="/guide/getting-started"')
      expect(header).not.toContain('href="/leitfaden/erste-schritte"')

      await page.goto(`${server.baseURL}/de/leitfaden/erste-schritte`, { waitUntil: 'domcontentloaded' })
      await waitForRenderedNuxtApp(page)
      await assertHeading(page, 'Einstieg')
      browserFailures.assertClean('the initial German route')

      await page.getByRole('link', { name: 'English' }).click()
      await page.waitForURL('**/guide/getting-started')
      await waitForRenderedNuxtApp(page)
      expect(contentPath(page.url())).toBe('/guide/getting-started')
      await assertHeading(page, 'Getting Started')
      browserFailures.assertClean('the English locale link')

      await page.getByRole('link', { name: 'Deutsch' }).click()
      await page.waitForURL('**/de/leitfaden/erste-schritte')
      await waitForRenderedNuxtApp(page)
      await assertHeading(page, 'Einstieg')
      browserFailures.assertClean('the German locale link')

      await page.goto(`${server.baseURL}/de/leitfaden/erste-schritte?q=a%20%26%20b#installation`, { waitUntil: 'domcontentloaded' })
      await waitForRenderedNuxtApp(page)
      const english = page.locator('header a[data-locale="en"]')
      const destination = new URL((await english.getAttribute('href'))!, server.baseURL)
      expect(destination.pathname).toBe('/guide/getting-started')
      expect(destination.searchParams.get('q')).toBe('a & b')
      expect(destination.hash).toBe('#installation')
      await english.click()
      await page.waitForURL('**/guide/getting-started?**#installation')
      await assertHeading(page, 'Getting Started')

      // A normal application page uses the same header without content facts.
      await page.getByRole('link', { name: 'Authors', exact: true }).click()
      await page.waitForURL('**/authors')
      await waitForRenderedNuxtApp(page)
      await expect(page.locator('header a[data-locale="de"]').getAttribute('href')).resolves.toBe('/de/authors')
      await page.goBack()
      await page.waitForURL('**/guide/getting-started?**#installation')
      await page.getByRole('heading', { name: 'Getting Started', exact: true }).waitFor()
      await waitForRenderedNuxtApp(page)
      await expect(page.locator('header a[data-locale="de"]').getAttribute('href')).resolves.toContain('/de/leitfaden/erste-schritte')
      browserFailures.assertClean('shared header across content and application pages')

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
      browserFailures.assertClean('the localized search result')

      await page.goBack({ waitUntil: 'domcontentloaded' })
      await waitForRenderedNuxtApp(page)
      expect(contentPath(page.url())).toBe('/de/search')
      browserFailures.assertClean('browser history back')
      await page.goForward({ waitUntil: 'domcontentloaded' })
      await waitForRenderedNuxtApp(page)
      expect(contentPath(page.url())).toBe('/de/leitfaden/erste-schritte')
      await assertHeading(page, 'Einstieg')
      browserFailures.assertClean('browser history forward')
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
