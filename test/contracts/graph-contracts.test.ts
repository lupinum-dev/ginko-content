import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import { doc } from './_utils'
import pathMeta from '../../packages/content/src/parsers/path-meta'
import { validateContentGraph } from '../../packages/content/src/runtime/server/validation'
import { reference } from '../../packages/content/src/types/config'

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

  test('a unique mounted alias remains resolvable when its canonical key exists in another collection', async () => {
    const { buildContentGraph, resolveGraphCanonicalKey, resolveGraphVariant } = await import('../../packages/content/src/core/content/graph')
    const graph = buildContentGraph([
      doc({
        id: 'docs:en:getting-started:index.md',
        collection: 'docs',
        canonicalKey: '1',
        path: '/getting-started',
        file: {
          source: 'content',
          path: '/en/guide/getting-started/index.md',
          stem: 'en/guide/getting-started/index',
          extension: 'md'
        }
      }),
      doc({
        id: 'blog:en:first-post.md',
        collection: 'blog',
        canonicalKey: '1',
        path: '/first-post',
        file: {
          source: 'content',
          path: '/en/blog/first-post.md',
          stem: 'en/blog/first-post',
          extension: 'md'
        }
      })
    ], {
      locales: ['en'],
      defaultLocale: 'en',
      referencePathAliases: document =>
        document.collection === 'docs' ? ['/guide/getting-started'] : []
    })

    expect(resolveGraphCanonicalKey(graph, 'guide/getting-started')).toBeNull()
    expect(resolveGraphCanonicalKey(graph, 'guide/getting-started', 'docs')).toBe('1')
    expect(resolveGraphCanonicalKey(graph, 'guide/getting-started', 'blog')).toBeNull()
    expect(resolveGraphVariant(graph, '1', 'en', {
      collection: 'docs',
      exact: true
    })?.contentId).toBe('docs:en:getting-started:index.md')
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

describe('content graph validation contracts', () => {
  test('allows a ref declared on only one locale variant of a canonical group', () => {
    const english = pathMeta.transform!(
      { id: 'content:en:guide:getting-started.md', ref: 'guide-intro', body: {} as any, type: 'markdown' } as any,
      { locales: ['en', 'de'], defaultLocale: 'en' }
    )
    const german = pathMeta.transform!(
      { id: 'content:de:guide:getting-started.md', body: {} as any, type: 'markdown' } as any,
      { locales: ['en', 'de'], defaultLocale: 'en' }
    )

    const outcome = validateContentGraph([english, german], {
      locales: ['en', 'de'],
      translatedSlugs: false,
      collections: {}
    })
    expect(outcome).toMatchObject({ ok: true })
  })

  test('requires refs to stay aligned across locale variants', () => {
    const english = pathMeta.transform!(
      { id: 'content:en:guide:getting-started.md', ref: 'guide-getting-started', body: {} as any, type: 'markdown' } as any,
      { locales: ['en', 'de'], defaultLocale: 'en' }
    )
    const german = pathMeta.transform!(
      { id: 'content:de:guide:getting-started.md', ref: 'leitfaden-erste-schritte', body: {} as any, type: 'markdown' } as any,
      { locales: ['en', 'de'], defaultLocale: 'en' }
    )

    const outcome = validateContentGraph([english, german], {
      locales: ['en', 'de'],
      translatedSlugs: false,
      collections: {}
    })
    expect(outcome).toMatchObject({
      ok: false,
      error: {
        code: 'CONFLICTING_REFS',
        message: expect.stringMatching(/conflicting refs across locale variants/)
      }
    })
  })

  test('rejects duplicate refs in either order before reference targets can overwrite', () => {
    const first = pathMeta.transform!(
      { id: 'content:en:guide:getting-started.md', ref: 'shared-ref', body: {} as any, type: 'markdown' } as any,
      { locales: ['en', 'de'], defaultLocale: 'en' }
    )
    const second = pathMeta.transform!(
      { id: 'content:de:blog:about.md', ref: 'shared-ref', body: {} as any, type: 'markdown' } as any,
      { locales: ['en', 'de'], defaultLocale: 'en' }
    )

    for (const documents of [[first, second], [second, first]]) {
      const outcome = validateContentGraph(documents, {
        locales: ['en', 'de'],
        translatedSlugs: false,
        collections: {}
      })
      expect(outcome).toMatchObject({
        ok: false,
        error: {
          code: 'CONFLICTING_REFS',
          message: expect.stringMatching(/duplicate ref "shared-ref"/)
        }
      })
    }
  })

  test('scopes schema references to the declared target collection', () => {
    const author = pathMeta.transform!(
      { id: 'content:authors:evan.yml', type: 'yaml', body: null, ref: 'evan' } as any,
      { locales: ['en'], defaultLocale: 'en' }
    )
    author.collection = 'authors'

    const post = pathMeta.transform!(
      { id: 'content:posts:hello.md', type: 'markdown', body: {}, author: 'evan' } as any,
      { locales: ['en'], defaultLocale: 'en' }
    )
    post.collection = 'posts'

    const outcome = validateContentGraph([author, post], {
      locales: ['en'],
      translatedSlugs: false,
      collections: {
        posts: {
          source: 'posts/*.md',
          schema: z.object({
            author: reference('authors')
          })
        },
        authors: {
          source: 'authors/*.yml'
        }
      }
    })

    expect(outcome).toMatchObject({ ok: true })
  })

  test('rejects schema references that resolve in the wrong collection', () => {
    const relatedPost = pathMeta.transform!(
      { id: 'content:posts:related.md', type: 'markdown', body: {}, ref: 'evan' } as any,
      { locales: ['en'], defaultLocale: 'en' }
    )
    relatedPost.collection = 'posts'

    const article = pathMeta.transform!(
      { id: 'content:posts:hello.md', type: 'markdown', body: {}, author: 'evan' } as any,
      { locales: ['en'], defaultLocale: 'en' }
    )
    article.collection = 'posts'

    const outcome = validateContentGraph([relatedPost, article], {
      locales: ['en'],
      translatedSlugs: false,
      collections: {
        posts: {
          source: 'posts/*.md',
          schema: z.object({
            author: reference('authors')
          })
        },
        authors: {
          source: 'authors/*.yml'
        }
      }
    })

    expect(outcome).toMatchObject({
      ok: false,
      error: {
        code: 'SCHEMA_VALIDATION_FAILED',
        message: expect.stringContaining('author: unresolved reference "evan" in collection "authors"')
      }
    })
  })

  test('validates derived reference metadata without live collection schemas', () => {
    const relatedPost = pathMeta.transform!(
      { id: 'content:posts:related.md', type: 'markdown', body: {}, ref: 'evan' } as any,
      { locales: ['en'], defaultLocale: 'en' }
    )
    relatedPost.collection = 'posts'

    const article = pathMeta.transform!(
      { id: 'content:posts:hello.md', type: 'markdown', body: {}, author: 'evan' } as any,
      { locales: ['en'], defaultLocale: 'en' }
    )
    article.collection = 'posts'

    const outcome = validateContentGraph([relatedPost, article], {
      locales: ['en'],
      translatedSlugs: false,
      collections: {
        posts: {
          source: 'posts/*.md',
          references: {
            authors: ['author']
          }
        } as any,
        authors: {
          source: 'authors/*.yml'
        }
      }
    })

    expect(outcome).toMatchObject({
      ok: false,
      error: {
        code: 'SCHEMA_VALIDATION_FAILED',
        message: expect.stringContaining('author: unresolved reference "evan" in collection "authors"')
      }
    })
  })

  test('allows unscoped schema references to resolve across collections', () => {
    const author = pathMeta.transform!(
      { id: 'content:authors:evan.yml', type: 'yaml', body: null, ref: 'evan' } as any,
      { locales: ['en'], defaultLocale: 'en' }
    )
    author.collection = 'authors'

    const post = pathMeta.transform!(
      { id: 'content:posts:hello.md', type: 'markdown', body: {}, author: 'evan' } as any,
      { locales: ['en'], defaultLocale: 'en' }
    )
    post.collection = 'posts'

    const outcome = validateContentGraph([author, post], {
      locales: ['en'],
      translatedSlugs: false,
      collections: {
        posts: {
          source: 'posts/*.md',
          schema: z.object({
            author: reference()
          })
        },
        authors: {
          source: 'authors/*.yml'
        }
      }
    })

    expect(outcome).toMatchObject({ ok: true })
  })

  test('errors when inline and file-based locale variants collide on the same canonical locale', () => {
    const inlineDefault = pathMeta.transform!(
      { id: 'content:authors:evan.yml', body: null, type: 'yaml' as const },
      { locales: ['en', 'de'], defaultLocale: 'en' }
    )
    const fileVariant = pathMeta.transform!(
      { id: 'content:de:authors:evan.yml', body: null, type: 'yaml' as const },
      { locales: ['en', 'de'], defaultLocale: 'en' }
    )

    const inlineGerman = {
      ...inlineDefault,
      id: 'content:authors:evan.yml#__locale=de',
      locale: 'de'
    }

    const outcome = validateContentGraph([inlineDefault, inlineGerman, fileVariant], {
      locales: ['en', 'de'],
      translatedSlugs: false,
      collections: {}
    })
    expect(outcome).toMatchObject({
      ok: false,
      error: {
        code: 'DUPLICATE_CANONICAL_ID',
        message: expect.stringMatching(/duplicate canonical id .* locale "de"/)
      }
    })
  })
})
