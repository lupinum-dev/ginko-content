import { describe, expect, test, vi } from 'vitest'
import { createPagefindSearchClient } from '../../packages/content/src/runtime/app/pagefind-client'

const result = (score: number, url: string, locale: string, plain: string) => {
  const data = vi.fn(async () => ({
    url,
    excerpt: `<mark>${plain}</mark>`,
    plain_excerpt: plain,
    meta: { title: plain, collection: 'docs', locale }
  }))
  return { score, data }
}

describe('Pagefind locale client', () => {
  test('loads the selected locale and normalizes plain excerpts', async () => {
    const de = result(2, '/de/suche', 'de', 'Deutsche Suche')
    const importModule = vi.fn(async () => ({ search: vi.fn(async () => ({ results: [de] })) }))
    const client = createPagefindSearchClient({
      manifestUrl: '/pagefind/ginko-locales.json',
      loadManifest: async () => ({ version: 1, defaultLocale: 'en', indexes: { en: 'pagefind.js', de: 'de/pagefind.js' } }),
      importModule
    })

    await expect(client.search('suche', { locale: 'de' })).resolves.toEqual([
      expect.objectContaining({ path: '/de/suche', locale: 'de', excerpt: 'Deutsche Suche' })
    ])
    expect(importModule).toHaveBeenCalledWith('/pagefind/de/pagefind.js')
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
})
