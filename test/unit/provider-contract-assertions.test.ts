import { describe, expect, test } from 'vitest'
import {
  isContentProviderResult,
  withContentCache,
  type ContentProvider,
  type ContentProviderCapabilities
} from '../../packages/content/src/public/provider'
import {
  expectProviderCapabilities,
  unwrapProviderContractResult
} from '../../packages/content/src/testing/provider-contract'
import {
  normalizeProviderRouteFact,
  normalizeProviderRoutes,
  projectProviderNavigation,
  projectProviderSearchResults,
  projectProviderSurroundings
} from '../../packages/content/src/runtime/server/provider-route-facts'

const capabilities: ContentProviderCapabilities = {
  query: {
    operators: ['$eq', '$in'],
    pagination: ['offset']
  }
}

describe('provider contract assertion helpers', () => {
  test('wraps cache metadata behind an opaque public predicate', () => {
    const data = { ok: true }
    const wrapped = withContentCache(data, { tags: ['collection:docs'] })

    expect(isContentProviderResult(wrapped)).toBe(true)
    expect(unwrapProviderContractResult(wrapped)).toBe(data)
    expect(unwrapProviderContractResult(data)).toBe(data)
  })

  test('asserts the exact semantic capability object', () => {
    const provider = {
      name: 'fixture',
      capabilities,
      query: async () => ({ result: [], skip: 0, limit: 0, total: 0 })
    } as ContentProvider

    expectProviderCapabilities(provider, capabilities)
    expect(() => expectProviderCapabilities({
      ...provider,
      capabilities: { ...capabilities, navigation: true }
    } as unknown as ContentProvider, capabilities)).toThrow()
  })

  test('accepts raw route facts and rejects provider-projected URLs', () => {
    expect(normalizeProviderRouteFact({
      collection: 'docs',
      canonicalKey: 'docs:intro',
      locale: 'en',
      contentPath: '/docs/intro/'
    }, 'fixture', 'navigation')).toEqual({
      collection: 'docs',
      canonicalKey: 'docs:intro',
      locale: 'en',
      contentPath: '/docs/intro'
    })

    expect(() => normalizeProviderRouteFact({
      collection: 'docs',
      canonicalKey: 'docs:intro',
      locale: 'en',
      contentPath: '/docs/intro',
      path: '/docs/intro'
    }, 'fixture', 'navigation')).toThrow(/preprojected route field/)
  })

  test.each([
    '//evil.test/path',
    '/docs/intro?preview=true',
    '/docs/intro#section',
    '/docs\\intro',
    '/docs/../admin',
    '/"><script>alert(1)</script>',
    '/%ZZ',
    '/%E0%A4%A',
    '/%00',
    '/a/%5C..%5Cb',
    '/docs/a%2Fb',
    '/docs/%2e%2e/admin',
    '/docs/%3Fpreview',
    '/docs/%23section',
    '/docs/%22quoted%22'
  ])('rejects non-canonical provider content path %s', (contentPath) => {
    expect(() => normalizeProviderRouteFact({
      collection: 'docs',
      canonicalKey: 'docs:intro',
      locale: 'en',
      contentPath
    }, 'fixture', 'routes')).toThrow(/site-relative content route contract/)
  })

  test.each([
    ['/café/', '/café'],
    ['/docs/a%20b', '/docs/a%20b'],
    ['/caf%C3%A9', '/caf%C3%A9'],
    ['/discount%25', '/discount%25']
  ])('preserves valid Unicode and percent-encoded provider path %s', (contentPath, expected) => {
    expect(normalizeProviderRouteFact({
      collection: 'docs',
      canonicalKey: 'docs:intro',
      locale: 'en',
      contentPath
    }, 'fixture', 'routes').contentPath).toBe(expected)
  })

  test('validates route metadata and normalized UTC dates', () => {
    expect(normalizeProviderRoutes([{
      collection: 'docs',
      canonicalKey: 'docs:intro',
      locale: 'en',
      contentPath: '/docs/intro',
      sitemap: {
        lastmod: '2026-01-01T00:00:00.000Z',
        images: [{ loc: '/images/intro.png' }]
      }
    }], 'fixture')).toHaveLength(1)

    expect(() => normalizeProviderRoutes([{
      collection: 'docs',
      canonicalKey: 'docs:intro',
      locale: 'en',
      contentPath: '/docs/intro',
      sitemap: { lastmod: '2026-01-01' }
    }], 'fixture')).toThrow(/normalized UTC ISO/)

    for (const sitemap of [
      { lastmod: 'not-a-date' },
      { lastmod: 123 },
      { images: { loc: '/images/intro.png' } },
      { images: [{}] },
      { images: [{ loc: '' }] }
    ]) {
      expect(() => normalizeProviderRoutes([{
        collection: 'docs',
        canonicalKey: 'docs:intro',
        locale: 'en',
        contentPath: '/docs/intro',
        sitemap
      }], 'fixture')).toThrow(expect.objectContaining({
        statusMessage: 'provider_result_invalid'
      }))
    }

    expect(() => normalizeProviderRoutes([{
      collection: 'docs',
      canonicalKey: 'docs:intro',
      locale: 'en',
      contentPath: '/docs/intro',
      draft: 'true'
    }], 'fixture')).toThrow(/non-boolean draft/)
  })

  test('rejects route facts outside configured collection and locale policy', () => {
    const runtime = {
      defaultLocale: 'en',
      locales: ['en', 'de'],
      localePolicy: {
        defaultLocale: 'en',
        locales: ['en', 'de'],
        fallback: {},
        collections: {
          docs: {
            localized: true,
            locales: ['en', 'de'],
            defaultLocale: 'en',
            fallback: {},
            translatedSlugs: false,
            routeMounts: { en: '/docs', de: '/docs' }
          }
        }
      },
      collections: {
        docs: {
          i18n: { defaultLocale: 'en', locales: ['en', 'de'] },
          localePolicy: {
            localized: true,
            locales: ['en', 'de'],
            defaultLocale: 'en',
            fallback: {},
            translatedSlugs: false,
            routeMounts: { en: '/docs', de: '/docs' }
          }
        }
      }
    }

    expect(() => normalizeProviderRoutes([{
      collection: 'secret',
      canonicalKey: 'secret:intro',
      locale: 'en',
      contentPath: '/secret/intro'
    }], 'fixture', runtime)).toThrow(expect.objectContaining({
      data: expect.objectContaining({ field: 'result[0].collection' })
    }))

    expect(() => normalizeProviderRoutes([{
      collection: 'docs',
      canonicalKey: 'docs:intro',
      locale: 'fr',
      contentPath: '/fr/docs/intro'
    }], 'fixture', runtime)).toThrow(expect.objectContaining({
      data: expect.objectContaining({ field: 'result[0].locale' })
    }))
  })

  test('rejects duplicate route identities and path ownership', () => {
    const first = {
      collection: 'docs',
      canonicalKey: 'docs:intro',
      locale: 'en',
      contentPath: '/docs/intro'
    }
    expect(() => normalizeProviderRoutes([
      first,
      { ...first, contentPath: '/docs/introduction' }
    ], 'fixture')).toThrow(/duplicate canonical route identity/)

    expect(() => normalizeProviderRoutes([
      first,
      { ...first, canonicalKey: 'docs:other' }
    ], 'fixture')).toThrow(/route path owned by more than one canonical identity/)
  })

  test('rejects non-JSON selected fields on every auxiliary provider surface', () => {
    const runtime = {
      defaultLocale: 'en',
      locales: ['en'],
      collections: { docs: {} }
    }
    const route = {
      collection: 'docs',
      canonicalKey: 'docs:intro',
      locale: 'en',
      contentPath: '/docs/intro'
    }
    const calls: Array<[() => unknown, string]> = [
      [() => projectProviderNavigation([{ title: 'Intro', publishedAt: new Date(), route }], 'fixture', runtime), 'result[0].publishedAt'],
      [() => projectProviderSurroundings([{ title: 'Intro', views: 1n, route }], 'fixture', runtime), 'result[0].views'],
      [() => projectProviderSearchResults([{ title: 'Intro', score: 1, facets: new Map(), route }], 'fixture', runtime), 'result[0].facets'],
      [() => normalizeProviderRoutes([{ ...route, privateMetadata: new Set() }], 'fixture', runtime), 'result[0].privateMetadata']
    ]

    for (const [call, field] of calls) {
      expect(call).toThrow(expect.objectContaining({
        statusMessage: 'provider_result_invalid',
        data: expect.objectContaining({ field })
      }))
    }
  })

  test('validates auxiliary result arrays once, including holes and nested navigation', () => {
    const runtime = {
      defaultLocale: 'en',
      locales: ['en'],
      collections: { docs: {} }
    }
    const sparse = new Array(1)
    expect(() => projectProviderNavigation(sparse, 'fixture', runtime)).toThrow(expect.objectContaining({
      data: expect.objectContaining({ field: 'result[0]' })
    }))

    let nested: Record<string, unknown> = { title: 'Leaf' }
    for (let depth = 0; depth < 50; depth += 1) {
      nested = { title: `Level ${depth}`, children: [nested] }
    }
    expect(projectProviderNavigation([nested], 'fixture', runtime)).toHaveLength(1)
  })

  test('projects an en-sourced navigation fact into the requested de locale so the URL still resolves', async () => {
    const { buildRouteRecords, resolveContentRoute } = await import(
      '../../packages/content/src/features/localization/route-projector'
    )
    // Mirrors playground/ginko-i18n: translated mounts AND translated slugs,
    // with de falling back to en.
    const localePolicy = {
      localized: true,
      locales: ['en', 'de'],
      defaultLocale: 'en',
      fallback: { de: ['en'] },
      translatedSlugs: true,
      routeMounts: { en: '/guide', de: '/leitfaden' }
    }
    const runtime = {
      defaultLocale: 'en',
      locales: ['en', 'de'],
      collections: { docs: { localePolicy } }
    }

    // A page with no `de` translation: navigation merges the `en` item into a
    // `de` request, so the fact's locale and the requested locale differ.
    const [enOnly] = projectProviderNavigation([{
      title: 'Advanced',
      route: {
        collection: 'docs',
        canonicalKey: 'docs:advanced',
        locale: 'en',
        contentPath: '/guide/advanced'
      }
    }], 'fixture', runtime, 'de', 'docs') as Array<{ path: string }>

    // The mount belongs to the TARGET locale; the remainder belongs to the
    // source variant, because `de` has no variant of its own to prefer.
    expect(enOnly!.path).toBe('/de/leitfaden/advanced')

    // The projected fallback URL must lower back to the same document through
    // the ordinary resolver, otherwise navigation would emit a dead link.
    const { index } = buildRouteRecords([
      { collection: 'docs', canonicalKey: 'docs:advanced', locale: 'en', contentPath: '/advanced' },
      { collection: 'docs', canonicalKey: 'docs:intro', locale: 'en', contentPath: '/getting-started' },
      { collection: 'docs', canonicalKey: 'docs:intro', locale: 'de', contentPath: '/erste-schritte' }
    ], localePolicy)
    expect(resolveContentRoute(enOnly!.path, 'de', localePolicy, index)).toMatchObject({
      canonicalKey: 'docs:advanced',
      locale: 'en'
    })

    // A page that DOES have a de variant keeps its own translated slug: the
    // navigation merge supplies the de fact, so projection is identity.
    const [translated] = projectProviderNavigation([{
      title: 'Erste Schritte',
      route: {
        collection: 'docs',
        canonicalKey: 'docs:intro',
        locale: 'de',
        contentPath: '/leitfaden/erste-schritte'
      }
    }], 'fixture', runtime, 'de', 'docs') as Array<{ path: string }>
    expect(translated!.path).toBe('/de/leitfaden/erste-schritte')
  })
})
