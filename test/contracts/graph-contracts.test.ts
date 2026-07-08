import { describe, expect, test } from 'vitest'
import { doc } from './_utils'

describe('graph contracts', () => {
  test('buildContentGraph indexes collection, path, canonical, refs, and navigation inputs', async () => {
    const { buildContentGraph, resolveGraphCollectionLocales, resolveGraphVariant } = await import('../../packages/content/src/core/content/graph')

    const graph = buildContentGraph([
      doc({
        id: 'content:en:guide:intro.md',
        collection: 'docs',
        canonicalKey: 'guide/intro',
        ref: 'intro'
      }),
      doc({
        id: 'content:de:guide:intro.md',
        file: { path: '/de/guide/intro.md' },
        path: '/leitfaden/einstieg',
        locale: 'de',
        collection: 'docs',
        canonicalKey: 'guide/intro',
        ref: 'intro'
      }),
      doc({
        id: 'content:en:guide:index.yml',
        path: '/guide',
        file: { path: '/en/guide/.navigation.yml' },
        partial: true,
        navigationFile: true,
        collection: 'docs',
        body: { badge: 'New' }
      }),
      doc({
        id: 'content:authors:evan.yml',
        file: { path: '/authors/evan.yml' },
        path: '/authors/evan',
        type: 'yaml',
        collection: 'authors',
        canonicalKey: 'authors/evan',
        ref: 'evan'
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
      navigationFile: true
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
