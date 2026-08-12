// @vitest-environment node

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, test } from 'vitest'
import { createPagefindSearchClient } from '../../packages/content/src/runtime/app/pagefind-client'
import { startProductionFixtureServer } from '../helpers/production-fixture'
import { readSearchIndex } from '../helpers/generated-artifacts'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const searchFixtureDir = resolve(rootDir, 'playground/ginko-search')
const searchI18nFixtureDir = resolve(rootDir, 'playground/ginko-search-i18n')
const providerSearchFixtureDir = resolve(rootDir, 'playground/ginko-provider-search')

async function getJson<T> (url: string): Promise<T> {
  const response = await fetch(url)
  expect(response.status, url).toBe(200)
  return await response.json() as T
}

interface PagefindModule {
  options: (options: { basePath: string }) => Promise<void>
  search: (term: string) => Promise<{
    results: Array<{ score: number, data: () => Promise<{ url: string, content: string, meta: { locale: string, path: string } }> }>
  }>
}

async function loadGeneratedPagefind (entry: string, basePath: string) {
  const pagefind = await import(`${pathToFileURL(entry).href}?test=${encodeURIComponent(basePath)}`) as PagefindModule
  await pagefind.options({ basePath })
  return pagefind
}

describe('search matrix', () => {
  test('MiniSearch indexes route-safe public paths and supports runtime search', async () => {
    const server = await startProductionFixtureServer(searchFixtureDir, undefined, {
      CONTENT_SEARCH_ENGINE: 'minisearch'
    })
    try {
      const index = await getJson<Array<Record<string, unknown>>>(`${server.baseURL}/api/_content/search/index.json`)
      expect(index).toEqual(expect.arrayContaining([
        expect.objectContaining({
          collection: 'pages',
          path: '/guide/getting-started',
          title: 'Searchable Guide'
        }),
        expect.objectContaining({
          collection: 'posts',
          path: '/posts/roadmap',
          title: 'Searchable Roadmap'
        })
      ]))
      expect(JSON.stringify(index)).not.toContain('.path')

      const results = await getJson<Array<Record<string, unknown>>>(`${server.baseURL}/api/_content/search?q=milestone`)
      expect(results).toEqual([
        expect.objectContaining({
          collection: 'posts',
          path: '/posts/roadmap',
          title: 'Internal Milestone'
        })
      ])
    } finally {
      await server.stop()
    }
  }, 240000)

  test('Pagefind static output emits and searches default, selected German, and all-language indexes', async () => {
    const server = await startProductionFixtureServer(searchI18nFixtureDir, undefined, {
      CONTENT_SEARCH_ENGINE: 'pagefind'
    })
    try {
      const publicDir = resolve(searchI18nFixtureDir, '.output/public')
      const pagefindEntry = resolve(publicDir, 'pagefind/pagefind.js')
      const germanPagefindEntry = resolve(publicDir, 'pagefind/de/pagefind.js')
      const index = await readSearchIndex(publicDir)

      expect(existsSync(pagefindEntry)).toBe(true)
      expect(existsSync(germanPagefindEntry)).toBe(true)
      expect(index).toEqual(expect.arrayContaining([
        expect.objectContaining({
          path: '/guide/getting-started',
          title: 'Getting Started',
          locale: 'en'
        }),
        expect.objectContaining({
          path: '/de/leitfaden/erste-schritte',
          title: 'Einstieg',
          locale: 'de'
        })
      ]))
      expect(JSON.stringify(index)).not.toContain('/de/de/')

      const manifest = await getJson<{
        version: number
        defaultLocale: string
        indexes: Record<string, string>
      }>(`${server.baseURL}/pagefind/ginko-locales.json`)
      expect(manifest).toEqual({
        version: 1,
        defaultLocale: 'en',
        indexes: {
          de: 'de/pagefind.js',
          en: 'pagefind.js'
        }
      })

      for (const entry of Object.values(manifest.indexes)) {
        const response = await fetch(`${server.baseURL}/pagefind/${entry}`)
        expect(response.status, entry).toBe(200)
        expect(response.headers.get('content-type')).toContain('javascript')
      }

      const client = createPagefindSearchClient({
        manifestUrl: `${server.baseURL}/pagefind/ginko-locales.json`,
        importModule: async (url) => {
          const parsed = new URL(url)
          const entry = resolve(publicDir, parsed.pathname.replace(/^\//, ''))
          return await loadGeneratedPagefind(entry, new URL('.', url).href)
        }
      })
      const germanResults = await client.search('Deutscher', { locale: 'de' })
      expect(germanResults).toEqual(expect.arrayContaining([
        expect.objectContaining({
          locale: 'de',
          path: '/de/leitfaden/erste-schritte'
        })
      ]))

      const allLanguageResults = await client.search('onboarding')
      expect(allLanguageResults).toEqual(expect.arrayContaining([
        expect.objectContaining({
          locale: 'en',
          path: '/guide/getting-started'
        }),
        expect.objectContaining({
          locale: 'de',
          path: '/de/leitfaden/erste-schritte'
        })
      ]))
    } finally {
      await server.stop()
    }
  }, 240000)

  test('provider-owned search delegates to provider search and skips local index routes', async () => {
    const server = await startProductionFixtureServer(providerSearchFixtureDir)
    try {
      const results = await getJson<Array<Record<string, unknown>>>(`${server.baseURL}/api/_content/search?q=provider&locale=de`)
      expect(results).toEqual([
        expect.objectContaining({
          collection: 'docs',
          path: '/de/dokumentation/provider-leitfaden',
          title: 'Provider Deutscher Leitfaden',
          locale: 'de'
        })
      ])

      const indexResponse = await fetch(`${server.baseURL}/api/_content/search/index.json`)
      expect(indexResponse.status).toBe(404)
    } finally {
      await server.stop()
    }
  }, 240000)

  test('disabled search omits production search endpoints', async () => {
    const server = await startProductionFixtureServer(searchFixtureDir, undefined, {
      CONTENT_SEARCH_DISABLED: '1'
    })
    try {
      const searchResponse = await fetch(`${server.baseURL}/api/_content/search?q=guide`)
      expect(searchResponse.status).toBe(404)

      const indexResponse = await fetch(`${server.baseURL}/api/_content/search/index.json`)
      expect(indexResponse.status).toBe(404)
    } finally {
      await server.stop()
    }
  }, 240000)
})
