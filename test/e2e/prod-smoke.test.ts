// @vitest-environment node

import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { ofetch } from 'ofetch'
import { startFixtureServer } from '../helpers/fixture-server'
import type { FixtureServer } from '../helpers/fixture-server'
import { assertRouteManifestMatchesGolden } from '../helpers/route-manifest'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const withFixtureServer = async (fixture: string, run: (server: FixtureServer) => Promise<void>) => {
  const server = await startFixtureServer(resolve(rootDir, fixture))
  try {
    await run(server)
  } finally {
    await server.stop()
  }
}

describe('production fixture smoke', () => {
  test('basic fixture builds and serves representative content/API routes', async () => {
    await withFixtureServer('playground/ginko-basic', async ({ baseURL, publicDir }) => {
      await assertRouteManifestMatchesGolden(publicDir, resolve(rootDir, 'test/golden/routes/ginko-basic.txt'), 'build')
      const $fetch = ofetch.create({ baseURL })

      await expect($fetch('/guide/getting-started')).resolves.toContain('Getting Started')
      await expect($fetch('/api/_content/navigation?collection=pages')).resolves.toEqual(
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
    await withFixtureServer('playground/ginko-i18n', async ({ baseURL }) => {
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

      // `by: { path }` is canonical and mount-agnostic, so the collection index
      // is `/` in both locales even though it is mounted at `/guide` and
      // `/leitfaden`. A mounted value here would silently return null.
      for (const [locale, expectedRoute] of [['en', '/guide'], ['de', '/de/leitfaden']] as const) {
        await expect($fetch(`/api/ref-links-debug?locale=${locale}`)).resolves.toMatchObject({
          home: { route: { resolvedPath: expectedRoute } },
          gettingStarted: { canonicalKey: '1' }
        })
      }
    })
  }, 240000)
})
