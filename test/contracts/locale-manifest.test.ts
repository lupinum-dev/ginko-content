import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createEvent, createStorage, doc } from './_utils'

const route = { path: '/' }
const nuxtApp = { $i18n: { locale: undefined as any } }
const localeState = { value: undefined as any }

vi.mock('../../packages/content/src/runtime/app/composables/locale-context', () => ({
  getLocaleContext: () => ({
    route,
    i18nLocale: nuxtApp.$i18n.locale,
    resolvedLocaleState: localeState
  })
}))

vi.mock('../../packages/content/src/integrations/nitro/runtime-config', () => ({
  getContentRuntimeConfig: () => ({
    content: {
      defaultLocale: 'en',
      localeFallback: { de: ['fr', 'en'], fr: ['de', 'en'] }
    }
  })
}))

const cache = createStorage()
const getContentsList = vi.fn()
const getContent = vi.fn()

vi.mock('../../packages/content/src/storage/contents', () => ({
  getContentsList,
  getContent,
  chunksFromArray: function * chunksFromArray<T> (arr: T[], n: number) {
    for (let i = 0; i < arr.length; i += n) {
      yield arr.slice(i, i + n)
    }
  }
}))

vi.mock('../../packages/content/src/integrations/nitro/storage', () => ({
  cacheStorage: () => cache
}))

vi.mock('../../packages/content/src/storage/driver', () => ({
  cacheStorage: () => cache,
  contentConfig: () => ({
    locales: ['en', 'de', 'fr'],
    defaultLocale: 'en',
    localeFallback: { de: ['fr', 'en'], fr: ['de', 'en'] }
  })
}))

describe('locale and manifest contracts', () => {
  beforeEach(() => {
    route.path = '/'
    nuxtApp.$i18n.locale = undefined
    localeState.value = undefined
    cache._state.clear()
    getContentsList.mockReset()
    getContent.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('resolveActiveLocale prefers explicit i18n locale and falls back deterministically', async () => {
    const { resolveActiveLocale } = await import('../../packages/content/src/runtime/app/composables/locale')

    route.path = '/de/guide'
    nuxtApp.$i18n.locale = 'fr'
    expect(resolveActiveLocale(['en', 'de', 'fr'], 'en')).toBe('fr')

    nuxtApp.$i18n.locale = 'es'
    expect(resolveActiveLocale(['en', 'de', 'fr'], 'en')).toBe('de')

    nuxtApp.$i18n.locale = undefined
    localeState.value = 'de'
    expect(resolveActiveLocale(['en', 'de'], 'en')).toBe('de')

    localeState.value = undefined
    route.path = '/guide'
    expect(resolveActiveLocale([], 'en')).toBe('en')
    expect(resolveActiveLocale([], undefined)).toBeUndefined()
  })

  test('resolveRouteContent strips locale prefixes and normalizes paths', async () => {
    const { resolveRouteContent } = await import('../../packages/content/src/runtime/app/composables/locale')

    route.path = '/de/guide/getting-started/'
    expect(resolveRouteContent('/de/guide/getting-started/', ['en', 'de'], 'en')).toEqual({
      locale: 'de',
      path: '/guide/getting-started',
      routePath: '/de/guide/getting-started'
    })

    route.path = '/guide/getting-started/'
    expect(resolveRouteContent('/guide/getting-started/', ['en', 'de'], 'en')).toEqual({
      locale: 'en',
      path: '/guide/getting-started',
      routePath: '/guide/getting-started'
    })

    route.path = '/es/guide'
    expect(resolveRouteContent('/es/guide', ['en', 'de'], 'en')).toEqual({
      locale: 'en',
      path: '/es/guide',
      routePath: '/es/guide'
    })
  })

  test('resolveLocaleChain deduplicates configured circular fallbacks', async () => {
    const { resolveLocaleChain } = await import('../../packages/content/src/core/content/locale')

    expect(resolveLocaleChain('de', 'en', { de: ['fr', 'en', 'fr'] })).toEqual(['de', 'fr', 'en'])
    expect(resolveLocaleChain('fr', 'en', { fr: ['de', 'en', 'de'] })).toEqual(['fr', 'de', 'en'])
    expect(resolveLocaleChain(undefined, 'en')).toEqual(['en'])
  })

  test('manifest indexes canonical variants, respects exact lookups, and ignores non-markdown routes', async () => {
    getContentsList.mockResolvedValue([
      doc(),
      doc({
        id: 'content:de:leitfaden:erste-schritte.md',
        file: { path: '/de/leitfaden/erste-schritte.md' },
        path: '/leitfaden/erste-schritte',
        locale: 'de',
        title: 'Einstieg'
      }),
      doc({
        id: 'content:en:guide:advanced.md',
        file: { path: '/en/guide/advanced.md' },
        path: '/guide/advanced',
        canonicalKey: 'guide/advanced',
        title: 'Advanced'
      }),
      doc({
        id: 'content:fr:guide:advanced.md',
        file: { path: '/fr/guide/advanced.md' },
        path: '/guide/advanced',
        locale: 'fr',
        canonicalKey: 'guide/advanced',
        title: 'Avance'
      }),
      doc({
        id: 'content:en:data:authors.yml#__locale=de',
        file: { path: '/authors.yml' },
        path: '/authors/evan',
        type: 'yaml',
        locale: 'de',
        canonicalKey: 'authors/evan',
        title: 'Evan DE'
      })
    ])

    const { getContentGraph, resolveVariant, resolveRouteVariant } = await import('../../packages/content/src/storage/graph')
    const event = createEvent()
    // The graph manifest is the canonical variant and route index.
    const manifest = (await getContentGraph(event)).manifest

    expect(Object.keys(manifest.byCanonical['guide/advanced'] || {})).toEqual(['en', 'fr'])
    expect(manifest.paths['/guide/advanced']).toEqual([
      'content:en:guide:advanced.md',
      'content:fr:guide:advanced.md'
    ])
    expect(manifest.byRoute['de:/leitfaden/erste-schritte']).toBe('guide/getting-started')
    expect(manifest.byRoute['de:/authors/evan']).toBe('authors/evan')

    await expect(resolveVariant(event, 'guide/advanced', 'de')).resolves.toMatchObject({
      requestedLocale: 'de',
      resolvedLocale: 'fr',
      fallback: true,
      availableLocales: ['en', 'fr']
    })

    await expect(resolveVariant(event, 'guide/advanced', 'de', { exact: true })).resolves.toBeNull()

    await expect(resolveRouteVariant(event, '/guide/advanced', 'de')).resolves.toMatchObject({
      canonicalKey: 'guide/advanced',
      resolvedLocale: 'fr'
    })

    await expect(resolveRouteVariant(event, '/authors/evan', 'de')).resolves.toMatchObject({
      canonicalKey: 'authors/evan',
      resolvedLocale: 'de',
      fallback: false
    })
    await expect(resolveRouteVariant(event, '/missing', 'de')).resolves.toBeNull()
  })

})
