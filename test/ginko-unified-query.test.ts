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
import { navigationSelectFields } from '../packages/content/src/features/query/unified'
import { decorateLocalizedDocument } from '../packages/content/src/features/query/localized-docs'
import { defineCollection, defineContentConfig, type ContentCollectionHandle } from '../packages/content/src/types/config'
import type { QueryWhere } from '../packages/content/src/types/query'
import { doc } from './contracts/_utils'

describe('defineCollection', () => {
  test('rejects the removed named overload with an actionable diagnostic', () => {
    expect(() => (defineCollection as unknown as (...args: unknown[]) => unknown)('docs', {
      type: 'page',
      source: 'docs/**/*.md'
    })).toThrow('@lupinum/ginko-content defineCollection(name, config) was removed')
  })

  test('returns a handle carrying the name and config', () => {
    const authoredBlog = defineCollection({
      type: 'page',
      source: 'blog/*.md'
    })
    expect(authoredBlog).not.toHaveProperty('name')

    const config = defineContentConfig({
      collections: {
        blog: authoredBlog
      }
    })
    const blog = config.collections.blog

    expect(blog.name).toBe('blog')
    expect(authoredBlog.name).toBe('blog')
    expect(blog.type).toBe('page')
    expect(blog.source).toBe('blog/*.md')
    expect(blog.sitemap).toBeUndefined()
  })

  test('rejects stale collection names that drift from config map keys', () => {
    const guides = {
      name: 'guides',
      type: 'page',
      source: 'docs/**/*.md'
    }

    expect(() => defineContentConfig({
      collections: { docs: guides }
    })).toThrow('@lupinum/ginko-content collection key "docs" must match collection name "guides"')
  })

  test('defaults data collections out of sitemap generation', () => {
    const authors = defineCollection({
      type: 'data',
      source: 'authors/*.yml'
    })

    const config = defineContentConfig({
      collections: { authors }
    })

    expect(config.collections.authors).toMatchObject({
      name: 'authors',
      type: 'data',
      source: 'authors/*.yml',
      sitemap: false
    })
  })

  test('normalizes include and exclude collection sources', () => {
    const docs = defineCollection({
      type: 'page',
      source: {
        include: 'docs/**/*.md',
        exclude: ['docs/private/**']
      }
    })

    const config = defineContentConfig({
      collections: { docs }
    })

    expect(config.collections.docs).toMatchObject({
      name: 'docs',
      type: 'page',
      source: 'docs/**/*.md',
      exclude: ['docs/private/**'],
      sitemap: undefined
    })
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

  test('keeps $nin as the provider-advertised first-class operator', () => {
    expect(compileWhere({ category: { $nin: ['draft'] } })).toEqual({
      category: { $nin: ['draft'] }
    })
  })

  test('maps public path filters to internal path', () => {
    const where: QueryWhere = { path: '/guide/intro', published: true }
    expect(compileWhere(where)).toEqual({ path: '/guide/intro', published: true })
  })

  test('returns undefined when no field clauses remain', () => {
    expect(compileWhere({})).toBeUndefined()
    expect(compileWhere(undefined)).toBeUndefined()
  })

  test('supports path prefix filters without exposing path', () => {
    expect(compileWhere({ path: { $prefix: '/blog/2024' } })).toEqual({
      path: { $prefix: '/blog/2024' }
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

  test('rejects empty logical and nested filters instead of broadening the query', () => {
    for (const where of [
      { $and: [] },
      { $or: [] },
      { $and: [{}] },
      { $or: [{}] },
      { $not: {} },
      { nested: {} }
    ]) {
      expect(() => compileWhere(where as QueryWhere)).toThrow(/cannot be empty|members cannot be empty|filters cannot be empty/)
    }
  })

  test('rejects unsupported operators instead of compiling ignored filters', () => {
    expect(() => compileWhere({ title: { $near: 'intro' } } as unknown as QueryWhere)).toThrow('Unsupported content query operator: $near')
    expect(() => compileWhere({ title: { $regex: 'intro' } } as unknown as QueryWhere)).toThrow('Unsupported content query operator: $regex')
    expect(() => lowerQueryPlan({
      collection: 'docs',
      where: [{ title: { $near: 'intro' } } as never]
    })).toThrow('Unsupported content query operator: $near')
  })

  test('rejects malformed filters instead of silently broadening them', () => {
    class FilterValue {
      status = 'draft'
    }

    for (const where of [
      5,
      new Map([['status', 'draft']]),
      new Set(['draft']),
      new FilterValue()
    ]) {
      expect(() => compileWhere(where as unknown as QueryWhere)).toThrow(/expected a plain object/)
    }

    for (const operand of [
      /draft/i,
      new Date('2026-01-01T00:00:00.000Z'),
      new Map([['status', 'draft']]),
      new Set(['draft']),
      new FilterValue()
    ]) {
      expect(() => compileWhere({ status: operand } as unknown as QueryWhere)).toThrow(/Invalid content query filter/)
    }

    expect(() => compileWhere({ $and: { status: 'draft' } } as unknown as QueryWhere)).toThrow(/expected an array/)
    expect(() => compileWhere({ $or: 'draft' } as unknown as QueryWhere)).toThrow(/expected an array/)
    expect(() => compileWhere({ $not: 'draft' } as unknown as QueryWhere)).toThrow(/expected a plain object/)
    expect(() => compileWhere({ status: { $eq: 'draft', nested: true } } as unknown as QueryWhere)).toThrow(/cannot mix operator and field keys/)

    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => compileWhere(circular as QueryWhere)).toThrow(/circular references/)
  })

  test('rejects dangerous own keys before object assignment can drop the filter', () => {
    const parsed = JSON.parse('{"__proto__":{"$eq":"secret"}}') as QueryWhere
    expect(Object.prototype.hasOwnProperty.call(parsed, '__proto__')).toBe(true)
    expect(() => compileWhere(parsed)).toThrow(/Invalid query field path/)

    const nullPrototype = Object.create(null) as Record<string, unknown>
    nullPrototype.constructor = { name: 'Object' }
    expect(() => compileWhere(nullPrototype as QueryWhere)).toThrow(/Invalid query field path/)
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
      value: { __ginkoContentQueryValue: 'RegExp', source: 'intro', flags: 'i' }
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

  test('skips omitted entries but rejects non-string sort directions', () => {
    expect(compileSort({ date: 'desc', omitted: undefined })).toEqual([{ date: -1 }])

    for (const direction of [-1, 1, 0, 2, null, 'sideways']) {
      expect(() => compileSort({ title: direction } as never)).toThrow(/Invalid content query sort direction/)
    }
    expect(() => compileSort(new Map([['title', 1]]) as unknown as { title: 1 })).toThrow(/expected a plain object/)
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

  test('rejects a bare locale string', () => {
    expect(() => compileFallback('en' as never)).toThrow(/Invalid content query fallback/)
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

  test('rejects invalid public pagination instead of coercing or forwarding it', () => {
    expect(compileQueryParams({ collection: 'blog', limit: 0 })).toEqual({
      collection: 'blog',
      limit: 0
    })

    for (const limit of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 101, '10']) {
      expect(() => compileQueryParams({
        collection: 'blog',
        limit: limit as number
      })).toThrow(/Content query limit/)
    }

    for (const skip of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 10_001, '10']) {
      expect(() => compileQueryParams({
        collection: 'blog',
        skip: skip as number
      })).toThrow(/Content query skip/)
    }
  })

  test('rejects malformed selectors, locale options, and selections before transport', () => {
    for (const by of [
      {},
      { ref: 0 },
      { ref: '' },
      { path: '/docs', route: '/docs' },
      { path: '/docs', unknown: true },
      new Map([['path', '/docs']])
    ]) {
      expect(() => compileQueryParams({
        collection: 'docs',
        by: by as never
      })).toThrow(/Invalid content query selector/)
    }

    for (const fallback of ['', ['en', ''], 5, null, { locale: 'en' }]) {
      expect(() => compileQueryParams({
        collection: 'docs',
        fallback: fallback as never
      })).toThrow(/Invalid content query fallback/)
    }

    for (const select of [['title', 5], ['title', ''], ['__proto__']]) {
      expect(() => compileQueryParams({
        collection: 'docs',
        select: select as never
      })).toThrow(/Invalid content query selection/)
    }

    expect(() => compileQueryParams({ collection: 'docs', locale: '' })).toThrow(/Invalid content query locale/)
    expect(() => compileQueryParams({ collection: 'docs', exact: 'yes' as never })).toThrow(/Invalid content query exact/)
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
      defaultLocale: 'en'
    }).where).toBeUndefined()
  })

  test('normalizes the public default-locale shorthand before lowering', () => {
    const normalized = normalizeContentQueryParams(compileQueryParams({
      collection: 'docs',
      by: { ref: 'docs.intro' },
      locale: 'de',
      fallback: 'default'
    }), {
      collectionI18n: { defaultLocale: 'fr', locales: ['de', 'fr'] },
      defaultLocale: 'en',
      localeFallback: { de: ['en'] }
    })

    expect(normalized.resolveLocale?.fallback).toEqual(['fr'])
    expect(normalized.resolveVariant?.fallback).toEqual(['fr'])
  })

  test('canonicalizes an explicit empty fallback to exact locale intent', () => {
    const normalized = normalizeContentQueryParams({
      collection: 'docs',
      resolveLocale: { locale: 'de', fallback: [] },
      resolveVariant: { path: '/dokumentation/fehlend', locale: 'de', fallback: [] }
    }, {
      collectionI18n: { defaultLocale: 'en', locales: ['en', 'de'] },
      defaultLocale: 'en',
      localeFallback: { de: ['en'] }
    })

    expect(normalized.resolveLocale).toEqual({ locale: 'de', exact: true })
    expect(normalized.resolveVariant).toEqual({ path: '/dokumentation/fehlend', locale: 'de', exact: true })
  })

  test('routes locale-aware path selectors through resolveVariant', () => {
    const params = compileQueryParams({
      collection: 'docs',
      by: { path: '/documentation/pour-commencer' },
      locale: 'fr',
      fallback: ['en']
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
    expect(params.where).toEqual([{ path: '/blog/hello-world' }])
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

describe('query document locale policy', () => {
  const rawDocument = {
    id: 'content:de:guide:einstieg.md',
    collection: 'docs',
    canonicalKey: 'docs:intro',
    locale: 'de',
    path: '/einstieg',
    type: 'markdown' as const,
    body: { type: 'root' as const, children: [] },
    resolved: {
      locale: 'de',
      variantPaths: { en: '/intro', de: '/einstieg' }
    }
  }

  test('does not derive query variants from global locales when collection i18n is disabled', () => {
    const result = decorateLocalizedDocument(rawDocument, 'docs', {
      defaultLocale: 'en',
      locales: ['en', 'de'],
      collections: { docs: { i18n: false, route: '/docs' } }
    }, 'de')

    expect(result).toMatchObject({
      locale: '',
      route: { resolvedPath: '/einstieg', alternates: [] },
      resolution: { requested: {}, resolved: { locale: '' }, usedFallback: false }
    })
  })

  test('continues to inherit global locale policy when the collection does not override it', () => {
    const result = decorateLocalizedDocument(rawDocument, 'docs', {
      defaultLocale: 'en',
      locales: ['en', 'de'],
      collections: { docs: { route: '/docs' } }
    }, 'de')

    expect(result).toMatchObject({
      locale: 'de',
      route: {
        resolvedPath: '/de/docs/einstieg',
        alternates: [
          { locale: 'en', path: '/docs/intro', source: 'variant' },
          { locale: 'de', path: '/de/docs/einstieg', source: 'variant' }
        ]
      }
    })
  })
})

describe('route mount resolution', () => {
  test('resolves requested-locale public routes to fallback-locale content paths', () => {
    const graph = buildContentGraph([
      doc({
        collection: 'docs',
        id: 'content:en:1.docs:2.essentials:5.fallback-lab.md',
        path: '/docs/essentials/fallback-lab',
        file: { path: '/en/1.docs/2.essentials/5.fallback-lab.md' },
        locale: 'en',
        canonicalKey: '1/2/5',
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
      resolved: {
        requestedRoute: '/de/dokumentation/essentials/fallback-lab',
        locale: 'en',
        fallback: true
      }
    })
  })

  test('applies filters and projection to variant results', () => {
    const graph = buildContentGraph([
      doc({
        collection: 'docs',
        id: 'content:en:docs:intro.md',
        path: '/docs/intro',
        file: { path: '/en/docs/intro.md' },
        locale: 'en',
        canonicalKey: 'docs/intro',
        title: 'Intro',
        secret: 'hidden',
        draft: true
      })
    ], {
      defaultLocale: 'en',
      locales: ['en']
    })

    const filtered = executeQueryPlan(graph, lowerQueryPlan({
      collection: 'docs',
      first: true,
      where: [{ draft: { $ne: true } }],
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
        collection: 'docs',
        id: 'content:en:docs:intro.md',
        path: '/docs/intro',
        file: { path: '/en/docs/intro.md' },
        locale: 'en',
        canonicalKey: 'docs/intro',
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
  test('locale resolution keeps equal canonical keys from different collections distinct', () => {
    const graph = buildContentGraph([
      doc({ collection: 'docs', id: 'docs:en:shared.md', path: '/docs/shared', canonicalKey: 'shared', locale: 'en', title: 'Docs' }),
      doc({ collection: 'authors', id: 'authors:en:shared.md', path: '/authors/shared', canonicalKey: 'shared', locale: 'en', title: 'Author' })
    ], { defaultLocale: 'en', locales: ['en'] })

    const response = executeQueryPlan(graph, lowerQueryPlan({
      resolveLocale: { locale: 'en' },
      sort: [{ title: 1 }],
      only: ['collection', 'title']
    } as never), { defaultLocale: 'en' })

    expect(response.result).toEqual([
      { collection: 'authors', title: 'Author' },
      { collection: 'docs', title: 'Docs' }
    ])
  })

  test('collection-less plans reach .navigation.yml rows that belong to no collection', () => {
    const graph = buildContentGraph([
      doc({ collection: 'docs', id: 'content:docs:guide:index.md', path: '/docs/guide', canonicalKey: 'docs/guide', title: 'Guide' }),
      doc({
        id: 'content:docs:guide:.navigation.yml',
        path: '/docs/guide',
        canonicalKey: 'docs/guide-nav',
        title: 'Guide',
        type: 'yaml',
        partial: true,
        navigationFile: true,
        sidebar: 'section'
      } as never)
    ])

    const scoped = executeQueryPlan(graph, lowerQueryPlan({
      collection: 'docs',
      where: [{ navigationFile: true }],
      only: ['title', 'sidebar']
    }))
    const unscoped = executeQueryPlan(graph, lowerQueryPlan({
      where: [{ navigationFile: true }],
      only: ['title', 'sidebar']
    } as never))

    // Navigation files typically match no collection glob (`*.md` sources), so
    // the server's directory-config plan must not be collection-scoped —
    // otherwise `.navigation.yml` titles/icons/sidebar markers silently vanish.
    expect(scoped.result).toEqual([])
    expect(unscoped.result).toEqual([{ title: 'Guide', sidebar: 'section' }])
  })

  test('does not use path prefiltering for $or clauses with non-path branches', () => {
    const graph = buildContentGraph([
      doc({ collection: 'docs', id: 'content:docs:intro.md', path: '/docs/intro', canonicalKey: 'docs/intro', title: 'Intro', section: 'guide' }),
      doc({ collection: 'docs', id: 'content:docs:api.md', path: '/docs/api', canonicalKey: 'docs/api', title: 'API', section: 'reference' }),
      doc({ collection: 'docs', id: 'content:docs:about.md', path: '/docs/about', canonicalKey: 'docs/about', title: 'About', section: 'company' })
    ])

    const response = executeQueryPlan(graph, lowerQueryPlan({
      collection: 'docs',
      where: [{
        $or: [
          { path: '/docs/intro' },
          { section: 'reference' }
        ]
      }],
      sort: [{ title: 1 }],
      only: ['title', 'path']
    }))

    expect(response.result).toEqual([
      { title: 'API', path: '/docs/api' },
      { title: 'Intro', path: '/docs/intro' }
    ])
  })

  test('does not use path prefiltering for negated path clauses', () => {
    const graph = buildContentGraph([
      doc({ collection: 'docs', id: 'content:docs:intro.md', path: '/docs/intro', canonicalKey: 'docs/intro', title: 'Intro' }),
      doc({ collection: 'docs', id: 'content:docs:api.md', path: '/docs/api', canonicalKey: 'docs/api', title: 'API' }),
      doc({ collection: 'docs', id: 'content:docs:about.md', path: '/docs/about', canonicalKey: 'docs/about', title: 'About' })
    ])

    const response = executeQueryPlan(graph, lowerQueryPlan({
      collection: 'docs',
      where: [{ $not: { path: '/docs/intro' } }],
      sort: [{ title: 1 }],
      only: ['title', 'path']
    }))

    expect(response.result).toEqual([
      { title: 'About', path: '/docs/about' },
      { title: 'API', path: '/docs/api' }
    ])
  })

  test('keeps simple path equality prefiltering behavior', () => {
    const graph = buildContentGraph([
      doc({ collection: 'docs', id: 'content:docs:intro.md', path: '/docs/intro', canonicalKey: 'docs/intro', title: 'Intro' }),
      doc({ collection: 'docs', id: 'content:docs:api.md', path: '/docs/api', canonicalKey: 'docs/api', title: 'API' })
    ])

    const response = executeQueryPlan(graph, lowerQueryPlan({
      collection: 'docs',
      where: [{ path: '/docs/api' }],
      only: ['title', 'path']
    }))

    expect(response.result).toEqual([
      { title: 'API', path: '/docs/api' }
    ])
  })

  test('applies multi-key sort with earlier fields as dominant keys', () => {
    const graph = buildContentGraph([
      doc({ collection: 'docs', id: 'content:docs:beta-low.md', path: '/docs/beta-low', canonicalKey: 'docs/beta-low', title: 'Beta Low', group: 'beta', order: 1 }),
      doc({ collection: 'docs', id: 'content:docs:alpha-high.md', path: '/docs/alpha-high', canonicalKey: 'docs/alpha-high', title: 'Alpha High', group: 'alpha', order: 2 }),
      doc({ collection: 'docs', id: 'content:docs:alpha-low.md', path: '/docs/alpha-low', canonicalKey: 'docs/alpha-low', title: 'Alpha Low', group: 'alpha', order: 1 })
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
      'id',
      'path',
      'file',
      'canonicalKey',
      'locale',
      'draft',
      'navigation',
      'title',
      'description'
    ])
  })

  test('dedupes caller fields already required by navigation', () => {
    expect(navigationSelectFields(['title', 'path', 'description'])).toEqual([
      'id',
      'path',
      'file',
      'canonicalKey',
      'locale',
      'draft',
      'navigation',
      'title',
      'description'
    ])
  })
})
