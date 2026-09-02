// @vitest-environment node

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright-core'
import { startProductionFixtureServer } from '../helpers/production-fixture'
import { isExpectedNuxtPayloadCancellation } from '../helpers/browser-failures'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const docsDir = resolve(rootDir, 'docs')
const githubURL = 'https://github.com/lupinum-dev/ginko-content'
const discordURL = 'https://discord.gg/RPH6SeA36N'

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
    throw new Error('No Chromium executable found for docs hydration coverage.')
  }
  return executablePath
}

async function waitForHydration (page: Page) {
  await page.locator('#__nuxt').waitFor({ state: 'attached' })
  await page.waitForFunction(() => {
    const root = document.querySelector('#__nuxt')
    return Boolean(root?.textContent?.trim()) && !document.documentElement.innerHTML.includes('__NUXT_LOADING__')
  })
  await page.waitForLoadState('networkidle')
}

describe('Ginko Docs navigation hydration', () => {
  test('keeps the production sidebar across hydration and client navigation', async () => {
    const initialPath = '/docs/concepts/why-ginko'
    const server = await startProductionFixtureServer(docsDir)
    let browser: Browser | undefined
    try {
      browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true })
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      const failures: string[] = []
      const sameOrigin = (url: string) => new URL(url).origin === new URL(server.baseURL).origin

      page.on('pageerror', error => failures.push(`pageerror: ${error.message}`))
      page.on('console', message => {
        if (message.type() === 'error' || /hydration/i.test(message.text())) {
          failures.push(`console ${message.type()}: ${message.text()}`)
        }
      })
      page.on('requestfailed', request => {
        const error = request.failure()?.errorText
        if (sameOrigin(request.url()) && !isExpectedNuxtPayloadCancellation(request.url(), error, server.baseURL)) {
          failures.push(`request failed: ${error || 'unknown'} ${request.url()}`)
        }
      })
      page.on('response', response => {
        if (sameOrigin(response.url()) && response.status() >= 400) {
          failures.push(`response ${response.status()}: ${response.url()}`)
        }
      })

      const response = await page.goto(`${server.baseURL}${initialPath}`, { waitUntil: 'domcontentloaded' })
      expect(response?.status()).toBeLessThan(400)
      await waitForHydration(page)

      const githubLink = page.locator(`header a[href="${githubURL}"]`)
      const discordLink = page.locator(`header a[href="${discordURL}"]`)
      await expect(githubLink.isVisible()).resolves.toBe(true)
      await expect(discordLink.isVisible()).resolves.toBe(true)
      await expect(githubLink.getAttribute('href')).resolves.toBe(githubURL)
      await expect(discordLink.getAttribute('href')).resolves.toBe(discordURL)

      const sidebar = page.locator('aside[aria-label="Documentation"][data-variant="desktop"]')
      try {
        await sidebar.waitFor({ state: 'visible' })
      } catch (error) {
        const body = (await page.locator('body').textContent() || '').slice(0, 2000)
        throw new Error([
          error instanceof Error ? error.message : String(error),
          `URL: ${page.url()}`,
          `Browser failures:\n${failures.join('\n') || '(none)'}`,
          `Rendered body:\n${body}`
        ].join('\n\n'))
      }
      const links = sidebar.locator('a[href^="/docs/"]')
      const initialLinkCount = await links.count()
      expect(initialLinkCount).toBeGreaterThan(0)

      const destination = await links.evaluateAll((elements, currentPath) => {
        const link = elements.find(element => element.getAttribute('href') !== currentPath)
        return link?.getAttribute('href') || null
      }, initialPath)
      expect(destination).toBeTruthy()
      await sidebar.locator(`a[href="${destination}"]`).first().click()
      await page.waitForURL(url => url.pathname === destination)
      await waitForHydration(page)

      await page.locator('h1').waitFor({ state: 'visible' })
      await sidebar.locator(`a[href="${destination}"][data-active="true"]`).waitFor({ state: 'visible' })
      expect(await sidebar.locator('a[href^="/docs/"]').count()).toBeGreaterThan(0)
      expect(failures).toEqual([])
    } finally {
      await browser?.close()
      await server.stop()
    }
  }, 600000)
})
