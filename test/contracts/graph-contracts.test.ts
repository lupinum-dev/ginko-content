import { describe, expect, test } from 'vitest'
import { doc } from './_utils'

describe('graph contracts', () => {
  test('canonical identity is collection-scoped and unscoped ambiguity fails closed', async () => {
    const { buildContentGraph, resolveGraphCanonicalKey, resolveGraphVariant } = await import('../../packages/content/src/core/content/graph')
    const { validateContentGraph } = await import('../../packages/content/src/storage/validation')
    const documents = [
      doc({
        id: 'docs:en:shared.md',
        collection: 'docs',
        canonicalKey: 'shared',
        path: '/docs/shared',
        file: { source: 'content', path: '/docs/shared.md', stem: 'docs/shared', extension: 'md' }
      }),
      doc({
        id: 'authors:en:shared.md',
        collection: 'authors',
        canonicalKey: 'shared',
        path: '/authors/shared',
        file: { source: 'content', path: '/authors/shared.md', stem: 'authors/shared', extension: 'md' }
      })
    ]

    expect(validateContentGraph(documents, { locales: ['en'] })).toMatchObject({ ok: true })

    const graph = buildContentGraph(documents, { locales: ['en'], defaultLocale: 'en' })
    expect(resolveGraphCanonicalKey(graph, 'shared', 'docs')).toBe('shared')
    expect(resolveGraphCanonicalKey(graph, 'shared', 'authors')).toBe('shared')
    expect(resolveGraphVariant(graph, 'shared', 'en', { collection: 'docs', exact: true })?.contentId).toBe('docs:en:shared.md')
    expect(resolveGraphVariant(graph, 'shared', 'en', { collection: 'authors', exact: true })?.contentId).toBe('authors:en:shared.md')

    expect(resolveGraphCanonicalKey(graph, 'shared')).toBeNull()
    expect(resolveGraphVariant(graph, 'shared', 'en', { exact: true })).toBeNull()
  })

  test('reference aliases and path-like targets are collection-scoped', async () => {
    const { buildContentGraph, resolveGraphCanonicalKey } = await import('../../packages/content/src/core/content/graph')
    const { validateContentGraph } = await import('../../packages/content/src/storage/validation')
    const documents = [
      doc({
        id: 'docs:en:shared.md', collection: 'docs', canonicalKey: 'docs/shared', ref: 'shared',
        path: '/docs/shared', file: { source: 'content', path: '/shared.md', stem: 'shared', extension: 'md' }
      }),
      doc({
        id: 'authors:en:shared.md', collection: 'authors', canonicalKey: 'authors/shared', ref: 'shared',
        path: '/authors/shared', file: { source: 'authors', path: '/shared.md', stem: 'shared', extension: 'md' }
      })
    ]

    expect(validateContentGraph(documents, { locales: ['en'] })).toMatchObject({ ok: true })
    const graph = buildContentGraph(documents, { locales: ['en'], defaultLocale: 'en' })

    expect(resolveGraphCanonicalKey(graph, 'shared', 'docs')).toBe('docs/shared')
    expect(resolveGraphCanonicalKey(graph, 'shared', 'authors')).toBe('authors/shared')
    expect(resolveGraphCanonicalKey(graph, 'shared')).toBeNull()
  })

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
