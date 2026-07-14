import { describe, expect, test, vi } from 'vitest'
import { createPagefindSearchClient } from '../../packages/content/src/runtime/app/pagefind-client'

const result = (score: number, url: string, locale: string, plain: string) => {
  const data = vi.fn(async () => ({
    url,
    excerpt: `<mark>${plain}</mark>`,
    plain_excerpt: plain,
    meta: { title: plain, collection: 'docs', locale }
  }))
  return { id: url, score, data }
}

describe('Pagefind locale client', () => {
  test('loads the selected locale and normalizes plain excerpts', async () => {
    const de = result(2, 'https://docs.example.test/de/suche#treffer', 'de', 'Deutsche Suche')
    const importModule = vi.fn(async () => ({ search: vi.fn(async () => ({ results: [de] })) }))
    const client = createPagefindSearchClient({
      manifestUrl: '/pagefind/ginko-locales.json',
      loadManifest: async () => ({ version: 1, defaultLocale: 'en', indexes: { en: 'pagefind.js', de: 'de/pagefind.js' } }),
      importModule
    })

    await expect(client.search('suche', { locale: 'de' })).resolves.toEqual([
      expect.objectContaining({ path: '/de/suche', anchor: 'treffer', locale: 'de', excerpt: 'Deutsche Suche' })
    ])
    expect(importModule).toHaveBeenCalledWith('/pagefind/de/pagefind.js')
  })

  test('rejects a manifest that omits its declared default locale index', async () => {
    const client = createPagefindSearchClient({
      manifestUrl: '/pagefind/ginko-locales.json',
      loadManifest: async () => ({ version: 1, defaultLocale: 'en', indexes: { de: 'de/pagefind.js' } }),
      importModule: async () => ({ search: async () => ({ results: [] }) })
    })

    await expect(client.search('query')).rejects.toThrow('Invalid Pagefind locale manifest')
  })

  test('rejects locale and index paths that can escape the Pagefind directory', async () => {
    const importModule = vi.fn(async () => ({ search: async () => ({ results: [] }) }))

    for (const manifest of [
      { version: 1, defaultLocale: 'en', indexes: { en: 'pagefind.js', '../outside': '../outside/pagefind.js' } },
      { version: 1, defaultLocale: 'en', indexes: { en: 'pagefind.js', de: '../../outside.js' } },
      { version: 1, defaultLocale: 'en', indexes: { en: 'https://attacker.example/pagefind.js' } }
    ]) {
      const client = createPagefindSearchClient({
        manifestUrl: '/pagefind/ginko-locales.json',
        loadManifest: async () => manifest,
        importModule
      })
      await expect(client.search('query')).rejects.toThrow('Invalid Pagefind locale manifest')
    }

    expect(importModule).not.toHaveBeenCalled()
  })

  test('searches all locale indexes, merges deterministically, and reuses modules', async () => {
    const en = result(1, '/search', 'en', 'English')
    const de = result(2, '/de/suche', 'de', 'Deutsch')
    const modules = {
      '/pagefind/pagefind.js': { search: vi.fn(async () => ({ results: [en] })) },
      '/pagefind/de/pagefind.js': { search: vi.fn(async () => ({ results: [de] })) }
    }
    const importModule = vi.fn(async (url: string) => modules[url as keyof typeof modules])
    const client = createPagefindSearchClient({
      manifestUrl: '/pagefind/ginko-locales.json',
      loadManifest: async () => ({ version: 1, defaultLocale: 'en', indexes: { en: 'pagefind.js', de: 'de/pagefind.js' } }),
      importModule
    })

    expect((await client.search('search')).map(item => item.locale)).toEqual(['de', 'en'])
    await client.search('again')
    expect(importModule).toHaveBeenCalledTimes(2)
  })

  test('applies the limit before loading discarded result data', async () => {
    const first = result(2, '/first', 'en', 'First')
    const discarded = result(1, '/discarded', 'en', 'Discarded')
    const client = createPagefindSearchClient({
      manifestUrl: '/pagefind/ginko-locales.json',
      loadManifest: async () => ({ version: 1, defaultLocale: 'en', indexes: { en: 'pagefind.js' } }),
      importModule: async () => ({ search: async () => ({ results: [first, discarded] }) })
    })

    await expect(client.search('query', { limit: 1 })).resolves.toHaveLength(1)
    expect(first.data).toHaveBeenCalledOnce()
    expect(discarded.data).not.toHaveBeenCalled()
  })

  test('limits detail loading before deduplication and orders loaded equal scores by path', async () => {
    const duplicateA = result(3, '/duplicate', 'en', 'Duplicate A')
    const duplicateB = result(3, '/duplicate', 'de', 'Duplicate B')
    const second = result(2, '/second', 'en', 'Second')
    const discarded = result(1, '/discarded', 'en', 'Discarded')
    const tiedB = result(4, '/b', 'en', 'B')
    const tiedA = result(4, '/a', 'en', 'A')
    let resultsByUrl: Record<string, ReturnType<typeof result>[]> = {
      '/pagefind/pagefind.js': [duplicateA, second, discarded],
      '/pagefind/de/pagefind.js': [duplicateB]
    }
    const client = createPagefindSearchClient({
      manifestUrl: '/pagefind/ginko-locales.json',
      loadManifest: async () => ({ version: 1, defaultLocale: 'en', indexes: { en: 'pagefind.js', de: 'de/pagefind.js' } }),
      importModule: async url => ({ search: async () => ({ results: resultsByUrl[url] }) })
    })

    await expect(client.search('query', { limit: 2 })).resolves.toEqual([
      expect.objectContaining({ path: '/duplicate' })
    ])
    expect(second.data).not.toHaveBeenCalled()
    expect(discarded.data).not.toHaveBeenCalled()

    resultsByUrl = {
      '/pagefind/pagefind.js': [tiedB, tiedA],
      '/pagefind/de/pagefind.js': []
    }
    await expect(client.search('query', { limit: 1 })).resolves.toEqual([
      expect.objectContaining({ path: '/a' })
    ])
    expect(tiedA.data).toHaveBeenCalledOnce()
    expect(tiedB.data).not.toHaveBeenCalled()
  })

  test('bounds detail loading when a large equal-score group exceeds the result limit', async () => {
    const tied = Array.from({ length: 100 }, (_, index) => result(1, `/result-${String(index).padStart(3, '0')}`, 'en', `Result ${index}`))
    const client = createPagefindSearchClient({
      manifestUrl: '/pagefind/ginko-locales.json',
      loadManifest: async () => ({ version: 1, defaultLocale: 'en', indexes: { en: 'pagefind.js' } }),
      importModule: async () => ({ search: async () => ({ results: [...tied].reverse() }) })
    })

    await expect(client.search('query', { limit: 3 })).resolves.toEqual([
      expect.objectContaining({ path: '/result-000' }),
      expect.objectContaining({ path: '/result-001' }),
      expect.objectContaining({ path: '/result-002' })
    ])
    expect(tied.filter(item => item.data.mock.calls.length > 0)).toHaveLength(3)
  })
})
