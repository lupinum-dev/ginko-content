import { describe, expect, test } from 'vitest'
import { doc } from './_utils'

describe('graph contracts', () => {
  test('buildContentGraph indexes collection, path, canonical, refs, and navigation inputs', async () => {
    const { buildContentGraph, resolveGraphCollectionLocales, resolveGraphVariant } = await import('../../packages/content/src/core/content/graph')

    const graph = buildContentGraph([
      doc({
        _id: 'content:en:guide:intro.md',
        _collection: 'docs',
        _canonicalKey: 'guide/intro',
        ref: 'intro'
      }),
      doc({
        _id: 'content:de:guide:intro.md',
        _file: '/de/guide/intro.md',
        _path: '/leitfaden/einstieg',
        _locale: 'de',
        _collection: 'docs',
        _canonicalKey: 'guide/intro',
        ref: 'intro'
      }),
      doc({
        _id: 'content:en:guide:index.yml',
        _path: '/guide',
        _file: '/en/guide/.navigation.yml',
        _partial: true,
        _navigation: true,
        _collection: 'docs',
        body: { badge: 'New' }
      }),
      doc({
        _id: 'content:authors:evan.yml',
        _file: '/authors/evan.yml',
        _path: '/authors/evan',
        _type: 'yaml',
        _collection: 'authors',
        _canonicalKey: 'authors/evan',
        id: 'evan'
      })
    ] as any, {
      locales: ['en', 'de'],
      defaultLocale: 'en'
    })

    expect(graph.byCollection.docs).toEqual([
      'content:en:guide:intro.md',
      'content:de:guide:intro.md',
      'content:en:guide:index.yml'
    ])
    expect(graph.byPath['/guide/getting-started']).toEqual(['content:en:guide:intro.md'])
    expect(graph.byRef.intro).toBe('guide/intro')
    expect(graph.byNavigationPath['/guide']!.en).toMatchObject({
      _navigation: true
    })
    const { resolveGraphCanonicalKey } = await import('../../packages/content/src/core/content/graph')
    expect(resolveGraphCanonicalKey(graph, 'evan', 'authors')).toBe('authors/evan')
    expect(resolveGraphCollectionLocales(graph, 'intro', 'docs')).toEqual([
      { canonicalKey: 'guide/intro', locale: 'de', path: '/leitfaden/einstieg' },
      { canonicalKey: 'guide/intro', locale: 'en', path: '/guide/getting-started' }
    ])
    expect(resolveGraphVariant(graph, 'guide/intro', 'fr', {
      defaultLocale: 'en',
      localeFallback: { fr: ['de', 'en'] }
    })).toMatchObject({
      resolvedLocale: 'de',
      fallback: true
    })
  })
})
