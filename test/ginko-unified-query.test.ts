/**
 * Unit tests for the unified query API (ADR-0016).
 *
 * These tests target the pure layer — the filter compiler and the
 * `defineCollection` handle factory. End-to-end behavior (transport,
 * locale resolution, route matching) is covered by the playground
 * integration tests in `ginko-basic.test.ts` and `ginko-i18n.test.ts`.
 */
import { describe, expect, expectTypeOf, test } from 'vitest'
import { compileFallback, compileQueryParams, compileSort, compileWhere } from '../packages/content/src/core/query/filter'
import { normalizeContentQueryParams } from '../packages/content/src/core/query/params'
import { buildContentGraph } from '../packages/content/src/core/content/graph'
import { executeQueryPlan } from '../packages/content/src/core/query/execute'
import { lowerQueryPlan } from '../packages/content/src/core/query/lower'
import { navigationSelectFields } from '../packages/content/src/runtime/query/unified'
import { defineCollection, defineContentConfig, type ContentCollectionHandle } from '../packages/content/src/types/config'
import type { QueryWhere } from '../packages/content/src/types/query'
import { doc } from './contracts/_utils'

describe('defineCollection', () => {
  test('returns a handle carrying the name and config', () => {
    const config = defineContentConfig({
      collections: {
        blog: defineCollection({
          type: 'page',
          source: 'blog/*.md'
        })
      }
    })
    const blog = config.collections.blog

    expect(blog.name).toBe('blog')
    expect(blog.source).toBe('blog/*.md')
  })

  test('marks i18n collections with __i18n=true at the type level', () => {
    const config = defineContentConfig({
      collections: {
        docs: defineCollection({
          type: 'page',
          source: 'docs/**/*.md',
          i18n: { locales: ['en', 'fr'], defaultLocale: 'en' }
        })
      }
    })
    const docs = config.collections.docs

    expectTypeOf(docs).toMatchObjectType<ContentCollectionHandle<'docs', undefined, true>>()
  })

  test('non-i18n collections type as __i18n=false', () => {
    const config = defineContentConfig({
      collections: {
        blog: defineCollection({ type: 'page', source: 'blog/*.md' })
      }
    })
    const blog = config.collections.blog

    expectTypeOf(blog).toMatchObjectType<ContentCollectionHandle<'blog', undefined, false>>()
  })

  test('passes translatedSlugs through to runtime config', () => {
    const config = defineContentConfig({
      collections: {
        docs: defineCollection({
          type: 'page',
          source: 'docs/**/*.md',
          i18n: { locales: ['en', 'de'], defaultLocale: 'en' },
          translatedSlugs: true
        })
      }
    })
    const docs = config.collections.docs

    expect(docs.translatedSlugs).toBe(true)
  })
})

describe('compileWhere', () => {
  test('passes scalar equality through unchanged', () => {
    expect(compileWhere({ published: true })).toEqual({ published: true })
  })

  test('handles MongoDB-style operator objects', () => {
    expect(compileWhere({ category: { $in: ['tech', 'design'] } })).toEqual({
      category: { $in: ['tech', 'design'] }
    })
    expect(compileWhere({ score: { $gt: 5, $lte: 10 } })).toEqual({
      score: { $gt: 5, $lte: 10 }
    })
  })

  test('rewrites $nin to $not + $in', () => {
    expect(compileWhere({ category: { $nin: ['draft'] } })).toEqual({
      category: { $not: { $in: ['draft'] } }
    })
  })

  test('maps public path filters to internal _path', () => {
    const where: QueryWhere = { path: '/guide/intro', published: true }
    expect(compileWhere(where)).toEqual({ _path: '/guide/intro', published: true })
  })

  test('returns undefined when no field clauses remain', () => {
    expect(compileWhere({})).toBeUndefined()
    expect(compileWhere(undefined)).toBeUndefined()
  })

  test('supports path prefix filters without exposing _path', () => {
    expect(compileWhere({ path: { $prefix: '/blog/2024' } })).toEqual({
      _path: { $prefix: '/blog/2024' }
    })
  })

  test('recurses into $and / $or', () => {
    expect(compileWhere({
      $or: [{ category: 'tech' }, { category: 'design' }]
    })).toEqual({
      $or: [{ category: 'tech' }, { category: 'design' }]
    })
  })

  test('recurses into nested filter objects on subfields', () => {
    expect(compileWhere({
      nested: { level: { $eq: 2 } }
    } as QueryWhere)).toEqual({
      nested: { level: { $eq: 2 } }
    })
  })

  test('drops empty $and / $or arrays', () => {
    expect(compileWhere({ $or: [{}] } as QueryWhere)).toBeUndefined()
  })

  test('rejects unsupported operators instead of compiling ignored filters', () => {
    expect(() => compileWhere({ title: { $near: 'intro' } } as unknown as QueryWhere)).toThrow('Unsupported content query operator: $near')
    expect(() => lowerQueryPlan({
      collection: 'docs',
      where: [{ title: { $near: 'intro' } } as never]
    })).toThrow('Unsupported content query operator: $near')
  })

  test('lowers $regex options as part of the regex comparison instead of a second operator', () => {
    const plan = lowerQueryPlan({
      collection: 'docs',
      where: [{ title: { $regex: 'intro', $options: 'i' } }]
    })

    expect(plan.filter).toEqual({
      type: 'compare',
      field: 'title',
      operator: 'regex',
      value: /intro/i
    })
  })
})

describe('compileSort', () => {
  test('converts SortSpec to sort array', () => {
    expect(compileSort({ date: 'desc', title: 'asc' })).toEqual([
      { date: -1 },
      { title: 1 }
    ])
  })

  test('skips entries that are not 1 or -1', () => {
    expect(compileSort({ date: -1, weird: 0 as 1 } as { date: -1, weird: 1 })).toEqual([
      { date: -1 }
    ])
  })

  test('returns undefined for empty sort', () => {
    expect(compileSort(undefined)).toBeUndefined()
    expect(compileSort({})).toBeUndefined()
  })
})

describe('compileFallback', () => {
  test('passes booleans through', () => {
    expect(compileFallback(true)).toBe(true)
    expect(compileFallback(false)).toBe(false)
  })

  test('wraps a single locale string into an array', () => {
    expect(compileFallback('en')).toEqual(['en'])
  })

  test('passes arrays through', () => {
    expect(compileFallback(['en', 'fr'])).toEqual(['en', 'fr'])
  })

  test('returns undefined when omitted', () => {
    expect(compileFallback(undefined)).toBeUndefined()
  })
})

describe('compileQueryParams', () => {
  test('builds a simple many params payload', () => {
    expect(compileQueryParams({
      collection: 'blog',
      where: { published: true },
      sort: { date: 'desc' },
      limit: 10
    })).toEqual({
      collection: 'blog',
      where: [{ published: true }],
      sort: [{ date: -1 }],
      limit: 10
    })
  })

  test('does not inject default locale filters into variant-resolution queries', () => {
    expect(normalizeContentQueryParams({
      collection: 'docs',
      first: true,
      resolveVariant: {
        path: '/leitfaden/fortgeschritten',
        locale: 'de',
        fallback: ['en']
      }
    }, {
      collectionI18n: { defaultLocale: 'en', locales: ['en', 'de'] },
      defaultLocale: 'en',
      activeLocale: 'en'
    }).where).toEqual([])
  })

  test('routes locale-aware path selectors through resolveVariant', () => {
    const params = compileQueryParams({
      collection: 'docs',
      by: { path: '/documentation/pour-commencer' },
      locale: 'fr',
      fallback: 'en'
    }) as { resolveVariant?: { path?: string, locale?: string }, resolveLocale?: { locale?: string } }

    expect(params.resolveVariant).toEqual({
      path: '/documentation/pour-commencer',
      locale: 'fr',
      fallback: ['en']
    })
    expect(params.resolveLocale).toEqual({
      locale: 'fr',
      fallback: ['en']
    })
  })

  test('routes plain path selectors through where when no locale context exists', () => {
    const params = compileQueryParams({
      collection: 'blog',
      by: { path: '/blog/hello-world' }
    }) as { resolveVariant?: unknown, where?: Array<Record<string, unknown>> }

    expect(params.resolveVariant).toBeUndefined()
    expect(params.where).toEqual([{ _path: '/blog/hello-world' }])
  })

  test('routes ref selectors through resolveVariant.ref regardless of locale', () => {
    const params = compileQueryParams({
      collection: 'docs',
      by: { ref: 'guide.getting-started' },
      locale: 'fr'
    }) as { resolveVariant?: { ref?: string, locale?: string } }

    expect(params.resolveVariant?.ref).toBe('guide.getting-started')
    expect(params.resolveVariant?.locale).toBe('fr')
  })

  test('routes public route selectors through resolveVariant.route', () => {
    const params = compileQueryParams({
      collection: 'docs',
      by: { route: '/de/dokumentation/essentials/fallback-lab' },
      locale: 'de',
      fallback: true
    }) as { resolveVariant?: { route?: string, locale?: string, fallback?: boolean } }

    expect(params.resolveVariant).toEqual({
      route: '/de/dokumentation/essentials/fallback-lab',
      locale: 'de',
      fallback: true
    })
  })

  test('carries exact locale intent into variant selectors', () => {
    const params = compileQueryParams({
      collection: 'docs',
      by: { route: '/de/dokumentation/essentials/fallback-lab' },
      locale: 'de'
    }) as { resolveLocale?: { exact?: boolean }, resolveVariant?: { exact?: boolean } }

    expect(params.resolveLocale?.exact).toBe(true)
    expect(params.resolveVariant?.exact).toBe(true)
  })

  test('combines a locale-aware selector with extra where filters', () => {
    const params = compileQueryParams({
      collection: 'docs',
      by: { path: '/x' },
      where: { published: true },
      locale: 'fr'
    }) as { where?: unknown[], resolveVariant?: { path?: string } }

    expect(params.resolveVariant?.path).toBe('/x')
    expect(params.where).toEqual([{ published: true }])
  })

  test('omits resolveVariant when no reserved selector is present', () => {
    const params = compileQueryParams({
      collection: 'blog',
      where: { published: true }
    }) as { resolveVariant?: unknown }
    expect(params.resolveVariant).toBeUndefined()
  })

  test('forwards select to only', () => {
    expect(compileQueryParams({
      collection: 'blog',
      select: ['title', 'date']
    })).toEqual({
      collection: 'blog',
      only: ['title', 'date']
    })
  })

  test('locale-without-fallback defaults exact to true unless the caller overrides it', () => {
    // Standard query: locale-without-fallback → exact: true (so wrong-locale
    // variants don't leak in).
    const queryParams = compileQueryParams({
      collection: 'docs',
      locale: 'de'
    })
    expect(queryParams.resolveLocale).toEqual({ locale: 'de', exact: true })

    const navParams = compileQueryParams({
      collection: 'docs',
      locale: 'de',
      exact: false
    })
    expect(navParams.resolveLocale).toEqual({ locale: 'de' })
    expect((navParams.resolveLocale as { exact?: boolean }).exact).toBeUndefined()
  })
})

describe('route mount resolution', () => {
  test('resolves requested-locale public routes to fallback-locale content paths', () => {
    const graph = buildContentGraph([
      doc({
        _collection: 'docs',
        _id: 'content:en:1.docs:2.essentials:5.fallback-lab.md',
        _path: '/docs/essentials/fallback-lab',
        _file: '/en/1.docs/2.essentials/5.fallback-lab.md',
        _locale: 'en',
        _canonicalKey: '1/2/5',
        title: 'Fallback Lab'
      })
    ], {
      defaultLocale: 'en',
      locales: ['en', 'de']
    })
    const plan = lowerQueryPlan({
      collection: 'docs',
      first: true,
      resolveVariant: {
        route: '/de/dokumentation/essentials/fallback-lab',
        locale: 'de',
        fallback: ['en']
      }
    } as never)
    const response = executeQueryPlan(graph, plan, {
      defaultLocale: 'en',
      localeFallback: { de: ['en'] },
      collections: {
        docs: {
          i18n: { defaultLocale: 'en', locales: ['en', 'de'] },
          route: { en: '/docs', de: '/dokumentation' }
        }
      }
    })

    expect(response.result).toMatchObject({
      title: 'Fallback Lab',
      _requestedRoute: '/de/dokumentation/essentials/fallback-lab',
      _resolvedLocale: 'en',
      _fallback: true
    })
  })

  test('applies filters and projection to variant results', () => {
    const graph = buildContentGraph([
      doc({
        _collection: 'docs',
        _id: 'content:en:docs:intro.md',
        _path: '/docs/intro',
        _file: '/en/docs/intro.md',
        _locale: 'en',
        _canonicalKey: 'docs/intro',
        title: 'Intro',
        secret: 'hidden',
        _draft: true
      })
    ], {
      defaultLocale: 'en',
      locales: ['en']
    })

    const filtered = executeQueryPlan(graph, lowerQueryPlan({
      collection: 'docs',
      first: true,
      where: [{ _draft: { $ne: true } }],
      resolveVariant: {
        path: '/docs/intro',
        locale: 'en'
      }
    }), { defaultLocale: 'en' })

    expect(filtered.result).toBeUndefined()

    const projected = executeQueryPlan(graph, lowerQueryPlan({
      collection: 'docs',
      first: true,
      only: ['title'],
      resolveVariant: {
        path: '/docs/intro',
        locale: 'en'
      }
    }), { defaultLocale: 'en' })

    expect(projected.result).toEqual({ title: 'Intro' })
  })

  test('applies count mode to variant results', () => {
    const graph = buildContentGraph([
      doc({
        _collection: 'docs',
        _id: 'content:en:docs:intro.md',
        _path: '/docs/intro',
        _file: '/en/docs/intro.md',
        _locale: 'en',
        _canonicalKey: 'docs/intro',
        title: 'Intro'
      })
    ], {
      defaultLocale: 'en',
      locales: ['en']
    })

    const response = executeQueryPlan(graph, lowerQueryPlan({
      collection: 'docs',
      count: true,
      resolveVariant: {
        path: '/docs/intro',
        locale: 'en'
      }
    }), { defaultLocale: 'en' })

    expect(response.result).toBe(1)
  })
})

describe('query executor correctness', () => {
  test('does not use path prefiltering for $or clauses with non-path branches', () => {
    const graph = buildContentGraph([
      doc({ _collection: 'docs', _id: 'content:docs:intro.md', _path: '/docs/intro', _canonicalKey: 'docs/intro', title: 'Intro', section: 'guide' }),
      doc({ _collection: 'docs', _id: 'content:docs:api.md', _path: '/docs/api', _canonicalKey: 'docs/api', title: 'API', section: 'reference' }),
      doc({ _collection: 'docs', _id: 'content:docs:about.md', _path: '/docs/about', _canonicalKey: 'docs/about', title: 'About', section: 'company' })
    ])

    const response = executeQueryPlan(graph, lowerQueryPlan({
      collection: 'docs',
      where: [{
        $or: [
          { _path: '/docs/intro' },
          { section: 'reference' }
        ]
      }],
      sort: [{ title: 1 }],
      only: ['title', '_path']
    }))

    expect(response.result).toEqual([
      { title: 'API', _path: '/docs/api' },
      { title: 'Intro', _path: '/docs/intro' }
    ])
  })

  test('does not use path prefiltering for negated path clauses', () => {
    const graph = buildContentGraph([
      doc({ _collection: 'docs', _id: 'content:docs:intro.md', _path: '/docs/intro', _canonicalKey: 'docs/intro', title: 'Intro' }),
      doc({ _collection: 'docs', _id: 'content:docs:api.md', _path: '/docs/api', _canonicalKey: 'docs/api', title: 'API' }),
      doc({ _collection: 'docs', _id: 'content:docs:about.md', _path: '/docs/about', _canonicalKey: 'docs/about', title: 'About' })
    ])

    const response = executeQueryPlan(graph, lowerQueryPlan({
      collection: 'docs',
      where: [{ $not: { _path: '/docs/intro' } }],
      sort: [{ title: 1 }],
      only: ['title', '_path']
    }))

    expect(response.result).toEqual([
      { title: 'About', _path: '/docs/about' },
      { title: 'API', _path: '/docs/api' }
    ])
  })

  test('keeps simple path equality prefiltering behavior', () => {
    const graph = buildContentGraph([
      doc({ _collection: 'docs', _id: 'content:docs:intro.md', _path: '/docs/intro', _canonicalKey: 'docs/intro', title: 'Intro' }),
      doc({ _collection: 'docs', _id: 'content:docs:api.md', _path: '/docs/api', _canonicalKey: 'docs/api', title: 'API' })
    ])

    const response = executeQueryPlan(graph, lowerQueryPlan({
      collection: 'docs',
      where: [{ _path: '/docs/api' }],
      only: ['title', '_path']
    }))

    expect(response.result).toEqual([
      { title: 'API', _path: '/docs/api' }
    ])
  })

  test('applies multi-key sort with earlier fields as dominant keys', () => {
    const graph = buildContentGraph([
      doc({ _collection: 'docs', _id: 'content:docs:beta-low.md', _path: '/docs/beta-low', _canonicalKey: 'docs/beta-low', title: 'Beta Low', group: 'beta', order: 1 }),
      doc({ _collection: 'docs', _id: 'content:docs:alpha-high.md', _path: '/docs/alpha-high', _canonicalKey: 'docs/alpha-high', title: 'Alpha High', group: 'alpha', order: 2 }),
      doc({ _collection: 'docs', _id: 'content:docs:alpha-low.md', _path: '/docs/alpha-low', _canonicalKey: 'docs/alpha-low', title: 'Alpha Low', group: 'alpha', order: 1 })
    ])

    const response = executeQueryPlan(graph, lowerQueryPlan({
      collection: 'docs',
      sort: [{ group: 1 }, { order: 1 }],
      only: ['title']
    }))

    expect(response.result).toEqual([
      { title: 'Alpha Low' },
      { title: 'Alpha High' },
      { title: 'Beta Low' }
    ])
  })
})

describe('navigationSelectFields', () => {
  test('keeps navigation internals when callers request projected fields', () => {
    expect(navigationSelectFields(['description'])).toEqual([
      '_id',
      '_path',
      '_file',
      '_canonicalKey',
      '_locale',
      '_draft',
      'navigation',
      'title',
      'description'
    ])
  })

  test('dedupes caller fields already required by navigation', () => {
    expect(navigationSelectFields(['title', '_path', 'description'])).toEqual([
      '_id',
      '_path',
      '_file',
      '_canonicalKey',
      '_locale',
      '_draft',
      'navigation',
      'title',
      'description'
    ])
  })
})
