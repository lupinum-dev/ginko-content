// @vitest-environment node

import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { ofetch } from 'ofetch'
import { startFixtureServer } from '../helpers/fixture-server'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const withFixtureServer = async (fixture: string, run: (baseURL: string) => Promise<void>) => {
  const server = await startFixtureServer(resolve(rootDir, fixture))
  try {
    await run(server.baseURL)
  } finally {
    await server.stop()
  }
}

describe('production fixture smoke', () => {
  test('basic fixture builds and serves representative content/API routes', async () => {
    await withFixtureServer('playground/ginko-basic', async (baseURL) => {
      const $fetch = ofetch.create({ baseURL })

      await expect($fetch('/guide/getting-started')).resolves.toContain('Getting Started')
      await expect($fetch('/api/_content/navigation')).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: 'Guide' })
        ])
      )
      await expect($fetch('/api/_content/search/index.json')).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: 'Getting Started', path: '/guide/getting-started' })
        ])
      )
      await expect($fetch('/api/_content/search?q=Getting')).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: 'Getting Started', path: '/guide/getting-started' })
        ])
      )
    })
  }, 240000)

  test('i18n fixture builds and serves localized fallback routes', async () => {
    await withFixtureServer('playground/ginko-i18n', async (baseURL) => {
      const $fetch = ofetch.create({ baseURL })

      await expect($fetch('/de/leitfaden/erste-schritte')).resolves.toContain('Einstieg')
      await expect($fetch('/de/guide/advanced')).resolves.toContain('&quot;fallback&quot;: true')
      await expect($fetch('/de/leitfaden/advanced')).resolves.toContain('href="/de/preise"')
      await expect($fetch('/api/_content/search/index.json?locale=de')).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: 'Einstieg', path: '/de/leitfaden/erste-schritte', locale: 'de' })
        ])
      )
      await expect($fetch('/api/_content/search?q=Einstieg&locale=de')).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: 'Einstieg', path: '/de/leitfaden/erste-schritte', locale: 'de' })
        ])
      )
    })
  }, 240000)
})
