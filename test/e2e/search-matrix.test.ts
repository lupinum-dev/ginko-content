// @vitest-environment node

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { startFixtureServer } from '../helpers/fixture-server'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const searchFixtureDir = resolve(rootDir, 'playground/ginko-search')
const searchI18nFixtureDir = resolve(rootDir, 'playground/ginko-search-i18n')
const providerSearchFixtureDir = resolve(rootDir, 'playground/ginko-provider-search')

async function getJson<T> (url: string): Promise<T> {
  const response = await fetch(url)
  expect(response.status, url).toBe(200)
  return await response.json() as T
}

describe('search matrix', () => {
  test('MiniSearch indexes route-safe public paths and supports runtime search', async () => {
    const server = await startFixtureServer(searchFixtureDir, undefined, {
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
      expect(JSON.stringify(index)).not.toContain('._path')

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

  test('Pagefind static output emits localized records and Pagefind assets', async () => {
    const server = await startFixtureServer(searchI18nFixtureDir, undefined, {
      CONTENT_SEARCH_ENGINE: 'pagefind'
    })
    try {
      const publicDir = resolve(searchI18nFixtureDir, '.output/public')
      const indexPath = resolve(publicDir, 'api/_content/search/index.json')
      const pagefindEntry = resolve(publicDir, 'pagefind/pagefind.js')
      const index = JSON.parse(await readFile(indexPath, 'utf8')) as Array<Record<string, unknown>>

      expect(existsSync(pagefindEntry)).toBe(true)
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

      const response = await fetch(`${server.baseURL}/pagefind/pagefind.js`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('javascript')
    } finally {
      await server.stop()
    }
  }, 240000)

  test('provider-owned search delegates to provider search and skips local index routes', async () => {
    const server = await startFixtureServer(providerSearchFixtureDir)
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
    const server = await startFixtureServer(searchFixtureDir, undefined, {
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
