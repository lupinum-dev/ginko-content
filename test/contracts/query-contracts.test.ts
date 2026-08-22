import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createTestEvent } from '../support/provider-scenarios/event'
import { doc } from '../support/content-documents'
import { createProviderQuery } from '../../packages/content/src/runtime/server/provider-query'
import { compileQueryParams } from '../../packages/content/src/core/query/filter'
import { fromContentProviderQueryPlan } from '../../packages/content/src/features/query/query-plan-boundary'

const docsLocalePolicy = {
  localized: true,
  locales: ['en', 'de'],
  defaultLocale: 'en',
  fallback: { de: ['en'] },
  translatedSlugs: false,
  routeMounts: { en: '/', de: '/' }
}

vi.mock('#imports', () => ({
  useRuntimeConfig: () => ({
    content: {
      navigation: { fields: [] },
      defaultLocale: 'en',
      localeFallback: { de: ['en'] },
      collections: {
        docs: { i18n: true, localePolicy: docsLocalePolicy },
        blog: { i18n: false }
      }
    }
  })
}))

const getContentsList = vi.fn()
const getContent = vi.fn()
vi.mock('../../packages/content/src/storage/contents', () => ({
  getContentsList,
  getContent
}))

vi.mock('../../packages/content/src/storage/driver', () => ({
  contentConfig: () => ({
    locales: ['en', 'de'],
    defaultLocale: 'en',
    localeFallback: { de: ['en'] }
  })
}))

// Assert an envelope carries no module-owned `_`-prefixed key. Underscore keys
// are reserved for internal metadata and must never survive into the wire
// envelope. This walks the module-owned `route`, `resolution`, `navigation`,
// and `surround` containers (including alternates and nested navigation
// children), but deliberately does not descend into user
// content (`body`, frontmatter `data`, or the directory `dir` config), where
// authored `_`-prefixed fields are legal.
const assertNoModuleOwnedUnderscoreKeys = (value: unknown, where: string) => {
  expect(value && typeof value === 'object', `${where} must be an object`).toBe(true)
  const container = value as Record<string, unknown>
  for (const key of Object.keys(container)) {
    expect(key.startsWith('_'), `${where}.${key} is module-owned underscore metadata`).toBe(false)
  }

  const descend = (child: unknown, childWhere: string) => {
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      assertNoModuleOwnedUnderscoreKeys(child, childWhere)
    }
  }
  const descendEach = (list: unknown, childWhere: string) => {
    if (Array.isArray(list)) {
      list.forEach((entry, index) => descend(entry, `${childWhere}[${index}]`))
    }
  }

  descend(container.route, `${where}.route`)
  descend(container.resolution, `${where}.resolution`)
  descend(container.requested, `${where}.requested`)
  descend(container.resolved, `${where}.resolved`)
  descendEach(container.alternates, `${where}.alternates`)
  descendEach(container.navigation, `${where}.navigation`)
  descendEach(container.surround, `${where}.surround`)
  descendEach(container.children, `${where}.children`)
}

describe('query execution contracts', () => {
  beforeEach(() => {
    getContentsList.mockReset()
    getContent.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('executeContentQuery resolves locale variants and composes count/skip/limit/projection', async () => {
    const dataset = [
      doc({ collection: 'docs', title: 'Intro EN', canonicalKey: 'docs/intro', locale: 'en', path: '/guide/intro', order: 2 }),
      doc({ collection: 'docs', title: 'Intro DE', id: 'content:de:guide:intro.md', file: { path: '/de/guide/intro.md' }, canonicalKey: 'docs/intro', locale: 'de', path: '/leitfaden/einstieg', order: 1 }),
      doc({ collection: 'docs', title: 'Advanced EN', id: 'content:en:guide:advanced.md', file: { path: '/en/guide/advanced.md' }, canonicalKey: 'docs/advanced', locale: 'en', path: '/guide/advanced', order: 4 }),
      doc({ collection: 'docs', title: 'Guide EN', id: 'content:en:guide:index.md', file: { path: '/en/guide/index.md' }, canonicalKey: 'docs/guide', locale: 'en', path: '/guide', order: 3 }),
      doc({ collection: 'docs', title: 'Middle DE', id: 'content:de:guide:middle.md', file: { path: '/de/guide/middle.md' }, canonicalKey: 'docs/middle', locale: 'de', path: '/leitfaden/mitte', order: 3.5 }),
      doc({ collection: 'docs', title: 'Zed EN', id: 'content:en:guide:zed.md', file: { path: '/en/guide/zed.md' }, canonicalKey: 'docs/zed', locale: 'en', path: '/guide/zed', order: 0 }),
      doc({ collection: 'docs', title: 'Zed DE', id: 'content:de:guide:zed.md', file: { path: '/de/guide/zed.md' }, canonicalKey: 'docs/zed', locale: 'de', path: '/leitfaden/zed', order: 5 })
    ]

    getContentsList.mockResolvedValue(dataset)

    const { executeFilesystemContentQuery: rawExecuteContentQuery } = await import('../../packages/content/src/runtime/server/query-executor')
    // Adapt builder parameters to the lowered plan expected by this helper.
    const executeContentQuery = (event: any, params: any) => {
      const query = createProviderQuery(params, {
        defaultLocale: 'en',
        localeFallback: { de: ['en'] },
        collections: {
          docs: { i18n: true, localePolicy: docsLocalePolicy }
        }
      } as any)
      return rawExecuteContentQuery(event, fromContentProviderQueryPlan(query.plan, query.collection, docsLocalePolicy))
    }
    const event = createTestEvent()

    const list = await executeContentQuery(event, {
      collection: 'docs',
      resolveLocale: { locale: 'de', fallback: ['en'] },
      sort: [{ order: 1 }],
      only: ['title', 'resolved'],
      without: ['body']
    } as any)

    expect(list).toEqual({
      result: [
      {
        title: 'Intro DE',
        resolved: {
          requestedLocale: 'de',
          locale: 'de',
          fallback: false,
          availableLocales: ['en', 'de'],
          variantPaths: {
            en: '/guide/intro',
            de: '/leitfaden/einstieg'
          }
        }
      },
      {
        title: 'Guide EN',
        resolved: {
          requestedLocale: 'de',
          locale: 'en',
          fallback: true,
          availableLocales: ['en'],
          variantPaths: { en: '/guide' }
        }
      },
      {
        title: 'Middle DE',
        resolved: {
          requestedLocale: 'de',
          locale: 'de',
          fallback: false,
          availableLocales: ['de'],
          variantPaths: { de: '/leitfaden/mitte' }
        }
      },
      {
        title: 'Advanced EN',
        resolved: {
          requestedLocale: 'de',
          locale: 'en',
          fallback: true,
          availableLocales: ['en'],
          variantPaths: { en: '/guide/advanced' }
        }
      },
      {
        title: 'Zed DE',
        resolved: {
          requestedLocale: 'de',
          locale: 'de',
          fallback: false,
          availableLocales: ['en', 'de'],
          variantPaths: {
            en: '/guide/zed',
            de: '/leitfaden/zed'
          }
        }
      }
      ],
      skip: 0,
      limit: 100,
      total: 5
    })

    // The list envelope and every item (including the nested `resolved` block)
    // must be free of module-owned underscore metadata.
    for (const [index, item] of (list.result as Array<Record<string, unknown>>).entries()) {
      assertNoModuleOwnedUnderscoreKeys(item, `list.result[${index}]`)
    }

    await expect(executeContentQuery(event, {
      collection: 'docs',
      resolveLocale: { locale: 'de', exact: true },
      first: true,
      sort: [{ order: 1 }]
    } as any)).resolves.toMatchObject({
      result: {
        title: 'Intro DE',
        resolved: { locale: 'de' }
      }
    })

    await expect(executeContentQuery(event, {
      collection: 'docs',
      resolveLocale: { locale: 'de', fallback: ['en'] },
      count: true
    } as any)).resolves.toEqual({ result: 5 })

    await expect(executeContentQuery(event, {
      collection: 'docs',
      resolveLocale: { locale: 'de', fallback: ['en'] },
      sort: [{ order: 1 }],
      skip: 1,
      limit: 1
    } as any)).resolves.toMatchObject({
      result: [
        expect.objectContaining({ title: 'Guide EN' })
      ],
      skip: 1,
      limit: 1,
      total: 5
    })
  })

  test('executeContentQuery reports not-found errors for missing locale-resolved results', async () => {
    const dataset = [
      doc({ collection: 'docs', title: 'Intro DE', id: 'content:de:guide:intro.md', file: { path: '/de/guide/intro.md' }, canonicalKey: 'docs/intro', locale: 'de', path: '/leitfaden/einstieg', order: 1 }),
      doc({ collection: 'docs', title: 'Guide EN', id: 'content:en:guide:index.md', file: { path: '/en/guide/index.md' }, canonicalKey: 'docs/guide', locale: 'en', path: '/guide', order: 2 }),
      doc({ collection: 'docs', title: 'Advanced EN', id: 'content:en:guide:advanced.md', file: { path: '/en/guide/advanced.md' }, canonicalKey: 'docs/advanced', locale: 'en', path: '/guide/advanced', order: 3 })
    ]

    getContentsList.mockResolvedValue(dataset)

    const { executeFilesystemContentQuery: rawExecuteContentQuery } = await import('../../packages/content/src/runtime/server/query-executor')
    const executeContentQuery = (event: any, params: any) => {
      const query = createProviderQuery(params, {
        defaultLocale: 'en',
        localeFallback: { de: ['en'] },
        collections: {
          docs: { i18n: true, localePolicy: docsLocalePolicy }
        }
      } as any)
      return rawExecuteContentQuery(event, fromContentProviderQueryPlan(query.plan, query.collection, docsLocalePolicy))
    }
    const event = createTestEvent()

    await expect(executeContentQuery(event, {
      collection: 'docs',
      resolveLocale: { locale: 'de', fallback: ['en'] },
      first: true,
      where: [{ path: '/missing' }]
    } as any)).rejects.toMatchObject({
      statusCode: 404
    })
  })

  test('locale result arrays use default-locale-first order independent of graph insertion', async () => {
    const documents = [
      doc({
        collection: 'docs',
        title: 'Intro DE',
        id: 'content:de:guide:intro.md',
        file: { path: '/de/guide/intro.md' },
        canonicalKey: 'docs/intro',
        locale: 'de',
        path: '/leitfaden/einstieg'
      }),
      doc({
        collection: 'docs',
        title: 'Intro EN',
        id: 'content:en:guide:intro.md',
        file: { path: '/en/guide/intro.md' },
        canonicalKey: 'docs/intro',
        locale: 'en',
        path: '/guide/intro'
      })
    ]
    const { buildContentGraph } = await import('../../packages/content/src/core/content/graph')
    const { executeQueryPlan } = await import('../../packages/content/src/core/query/execute')

    const plan = createProviderQuery({
      collection: 'docs',
      resolveLocale: { locale: 'de', fallback: ['en'] },
      first: true,
      only: ['resolved']
    } as any).plan
    const list = executeQueryPlan(buildContentGraph(documents), plan, {
      defaultLocale: 'en',
      collections: {
        docs: {
          i18n: {
            defaultLocale: 'en',
            locales: ['en', 'de']
          }
        }
      }
    })

    expect(list.result.resolved.availableLocales).toEqual(['en', 'de'])

    // Reverse insertion direction. Canonical ordering must be identical
    // (default-locale first), proving it is independent of graph insertion.
    const reversedList = executeQueryPlan(buildContentGraph([...documents].reverse()), plan, {
      defaultLocale: 'en',
      collections: {
        docs: {
          i18n: {
            defaultLocale: 'en',
            locales: ['en', 'de']
          }
        }
      }
    })

    expect(reversedList.result.resolved.availableLocales).toEqual(['en', 'de'])

  })

  test('executeContentQuery resolves route variants and returns variant paths', async () => {
    getContentsList.mockResolvedValue([
      doc({
        collection: 'docs',
        id: 'content:en:guide:intro.md',
        canonicalKey: 'docs/intro',
        path: '/guide/intro',
        title: 'Intro EN'
      }),
      doc({
        collection: 'docs',
        id: 'content:en:_dir.yml',
        path: '/guide/intro',
        navigationFile: true,
        partial: true,
        body: { badge: 'New' }
      })
    ])

    const { executeFilesystemContentQuery: rawExecuteContentQuery } = await import('../../packages/content/src/runtime/server/query-executor')
    const executeContentQuery = (event: any, params: any) => {
      const query = createProviderQuery(params, {
        defaultLocale: 'en',
        localeFallback: { de: ['en'] },
        collections: {
          docs: { i18n: true, localePolicy: docsLocalePolicy }
        }
      } as any)
      return rawExecuteContentQuery(event, fromContentProviderQueryPlan(query.plan, query.collection, docsLocalePolicy))
    }

    const result = await executeContentQuery(createTestEvent(), {
      collection: 'docs',
      first: true,
      resolveVariant: {
        path: '/guide/intro',
        locale: 'de',
        fallback: ['en']
      }
    } as any)

    expect(result).toMatchObject({
      result: {
        title: 'Intro EN',
        resolved: {
          requestedLocale: 'de',
          locale: 'en',
          fallback: true,
          variantPaths: {
            en: '/guide/intro'
          }
        },
        dir: {
          badge: 'New'
        }
      }
    })
    assertNoModuleOwnedUnderscoreKeys(result.result, 'result')
    assertNoModuleOwnedUnderscoreKeys(result.result.resolved, 'result.resolved')
  })

  test('canonical query plan applies collection prefilter and projection in the correct order', async () => {
    const { executeQueryPlanOnDocuments } = await import('../../packages/content/src/core/query/execute')
    const { lowerQueryPlan } = await import('../../packages/content/src/core/query/lower')
    const contents = [
      doc({ collection: 'docs', path: '/guide/intro', title: 'Intro', order: 1, group: 'docs' }),
      doc({ collection: 'docs', path: '/guide/advanced', title: 'Advanced', order: 2, group: 'docs' }),
      doc({ collection: 'blog', path: '/blog/post', title: 'Post', order: 0, group: 'blog' })
    ]

    const plan = lowerQueryPlan(compileQueryParams({
      collection: 'docs',
      where: { path: '/guide/advanced', group: 'docs' },
      sort: { order: 'asc' },
      select: ['title', 'path']
    }))
    const result = executeQueryPlanOnDocuments(contents, plan)

    expect(result.result).toEqual([
      { title: 'Advanced', path: '/guide/advanced' }
    ])
  })

  // One core visibility decision, applied at the
  // untrusted public query boundary. Structural eligibility (partial,
  // navigationFile) is unconditional — never a route, in any environment —
  // while draft is the one environment-aware publication-visibility fact.
  test('executeContentQuery applies structural exclusion unconditionally and draft visibility per environment', async () => {
    const { executeFilesystemContentQuery: rawExecuteContentQuery } = await import('../../packages/content/src/runtime/server/query-executor')
    const executeContentQuery = (event: any, params: any) => {
      const query = createProviderQuery(params)
      return rawExecuteContentQuery(event, fromContentProviderQueryPlan(query.plan, query.collection, undefined))
    }

    const dataset = [
      doc({ id: 'content:en:docs:published.md', collection: 'docs', canonicalKey: 'docs/published', path: '/docs/published', title: 'Published' }),
      doc({ id: 'content:en:docs:draft.md', collection: 'docs', canonicalKey: 'docs/draft', path: '/docs/draft', title: 'Draft', draft: true }),
      doc({ id: 'content:en:docs:_dir.yml', collection: 'docs', canonicalKey: 'docs/_dir', path: '/docs', title: 'Dir config', partial: true }),
      doc({ id: 'content:en:docs:_nav.yml', collection: 'docs', canonicalKey: 'docs/_nav', path: '/docs/nav', title: 'Nav marker', navigationFile: true })
    ]
    getContentsList.mockResolvedValue(dataset)

    const result = await executeContentQuery(createTestEvent(), { collection: 'docs' })
    const titles = (result.result as any[]).map(item => item.title).sort()

    // Structural non-routes never reach the public query, and an explicit
    // client `where` cannot override that (it is not even referenced here,
    // proving the exclusion is unconditional rather than opt-out-shaped).
    expect(titles).not.toContain('Dir config')
    expect(titles).not.toContain('Nav marker')
    // This suite's ambient (test) environment resolves to production
    // semantics with no preview authorized, so the draft is hidden by
    // default alongside the two structural exclusions — only the published
    // page is visible. See `test/runtime/snapshot-runtime-boundary.test.ts`
    // for the same predicate showing drafts in development and rejecting an
    // authenticated preview request in production.
    expect(titles).toEqual(['Published'])
  })

  test('executeContentQuery rejects empty public graph queries', async () => {
    const { executeFilesystemContentQuery: rawExecuteContentQuery } = await import('../../packages/content/src/runtime/server/query-executor')
    // Adapt builder parameters to the lowered plan expected by this helper.
    const executeContentQuery = (event: any, params: any) => {
      const query = createProviderQuery(params)
      return rawExecuteContentQuery(event, fromContentProviderQueryPlan(query.plan, query.collection, undefined))
    }

    await expect(executeContentQuery(createTestEvent(), {
      where: [{ path: '/guide/intro' }]
    } as any)).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'Invalid content query'
    })
  })

  test('executeContentQuery rejects public regex filters before graph execution', async () => {
    const { executeFilesystemContentQuery: rawExecuteContentQuery } = await import('../../packages/content/src/runtime/server/query-executor')
    // Adapt builder parameters to the lowered plan expected by this helper.
    const executeContentQuery = (event: any, params: any) => {
      const query = createProviderQuery(params)
      return rawExecuteContentQuery(event, fromContentProviderQueryPlan(query.plan, query.collection, undefined))
    }

    await expect(Promise.resolve().then(() => executeContentQuery(createTestEvent(), {
      collection: 'docs',
      where: [{ title: { $regex: 'intro' } }]
    } as any))).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'unsupported_query_operator'
    })

    await expect(Promise.resolve().then(() => executeContentQuery(createTestEvent(), {
      collection: 'docs',
      where: [{ title: /intro/ }]
    } as any))).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'Invalid content query'
    })
  })

  test('regex comparator rejects untagged {source,flags} operands instead of char-class matching', async () => {
    const { evaluateQueryPlanFilter } = await import('../../packages/content/src/core/query/execute')
    const { isPlanRegex } = await import('../../packages/content/src/core/query/plan')

    const untagged = { source: 'ma', flags: '' }
    // The old-wire shape looks like a regex but is NOT a tagged PlanRegex.
    expect(isPlanRegex(untagged)).toBe(false)

    // Both directions. Pre-fix the executor stringified the untagged object to
    // `'[object Object]'`, which `new RegExp` compiled to the char-class
    // `/[objectObject ]/` — that matches `'match'` (shared c/t/a chars) and
    // silently returned a wrong `true`. Post-fix it throws instead of guessing.
    expect(() => evaluateQueryPlanFilter({ title: 'match' }, {
      type: 'compare', field: 'title', operator: 'regex', value: untagged
    })).toThrow(TypeError)
    // The diagnostic names the tagged wire shape and the wire version.
    expect(() => evaluateQueryPlanFilter({ title: 'match' }, {
      type: 'compare', field: 'title', operator: 'regex', value: untagged
    })).toThrow(/__ginkoContentQueryValue.*PROVIDER_QUERY_VERSION/)

    // Plain-string operands keep their exact semantics: string-form regex...
    expect(evaluateQueryPlanFilter({ title: 'Intro' }, {
      type: 'compare', field: 'title', operator: 'regex', value: '/^intro$/i'
    })).toBe(true)
    expect(evaluateQueryPlanFilter({ title: 'Intro/v1' }, {
      type: 'compare', field: 'title', operator: 'regex', value: '/^intro\\/v1$/i'
    })).toBe(true)
    for (const malformed of ['/intro/z', '/intro/ii']) {
      expect(() => evaluateQueryPlanFilter({ title: 'Intro' }, {
        type: 'compare', field: 'title', operator: 'regex', value: malformed
      })).toThrow(expect.objectContaining({ statusMessage: 'unsupported_query_shape' }))
    }
    // ...and bare-string literal matching.
    expect(evaluateQueryPlanFilter({ title: 'Introduction' }, {
      type: 'compare', field: 'title', operator: 'regex', value: 'ntro'
    })).toBe(true)
    expect(evaluateQueryPlanFilter({ title: 'Bar' }, {
      type: 'compare', field: 'title', operator: 'regex', value: 'ntro'
    })).toBe(false)

    // A properly tagged PlanRegex operand still matches (revive path intact).
    expect(evaluateQueryPlanFilter({ title: 'match' }, {
      type: 'compare', field: 'title', operator: 'regex',
      value: { __ginkoContentQueryValue: 'RegExp', source: 'ma', flags: '' }
    })).toBe(true)
  })

  test('executeContentQuery accepts public path prefix filters without exposing regex', async () => {
    const dataset = [
      doc({ collection: 'docs', id: 'content:guide:intro.md', file: { path: '/guide/intro.md' }, canonicalKey: 'guide/intro', path: '/guide/intro', title: 'Intro' }),
      doc({ collection: 'docs', id: 'content:guide:advanced.md', file: { path: '/guide/advanced.md' }, canonicalKey: 'guide/advanced', path: '/guide/advanced', title: 'Advanced' }),
      doc({ collection: 'docs', id: 'content:api:index.md', file: { path: '/api/index.md' }, canonicalKey: 'api/index', path: '/api', title: 'API' })
    ]
    getContentsList.mockResolvedValue(dataset)

    const { executeFilesystemContentQuery: rawExecuteContentQuery } = await import('../../packages/content/src/runtime/server/query-executor')
    // Adapt builder parameters to the lowered plan expected by this helper.
    const executeContentQuery = (event: any, params: any) => {
      const query = createProviderQuery(params)
      return rawExecuteContentQuery(event, fromContentProviderQueryPlan(query.plan, query.collection, undefined))
    }

    await expect(executeContentQuery(createTestEvent(), {
      collection: 'docs',
      where: [{ path: { $prefix: '/guide' } }],
      sort: [{ title: 1 }],
      only: ['title', 'path']
    } as any)).resolves.toEqual({
      result: [
        { title: 'Advanced', path: '/guide/advanced' },
        { title: 'Intro', path: '/guide/intro' }
      ],
      skip: 0,
      limit: 100,
      total: 2
    })
  })

  test('provider queries reject invalid public pagination instead of clamping it', () => {
    expect(() => createProviderQuery({
      collection: 'docs',
      sort: [{ order: 1 }],
      limit: 9999
    } as any)).toThrow(/Content query limit/)
    expect(() => createProviderQuery({
      collection: 'docs',
      sort: [{ order: 1 }],
      skip: -5
    } as any)).toThrow(/Content query skip/)
    expect(getContentsList).not.toHaveBeenCalled()
  })

  test('module-owned envelope walk covers current query result shapes and rejects nested underscore metadata', () => {
    const navigation = [
      { title: 'Guide', path: '/guide', children: [{ title: 'Intro', path: '/guide/intro' }] }
    ]
    const surround = [
      { title: 'Prev', path: '/guide/a' },
      { title: 'Next', path: '/guide/b' }
    ]

    const navigationResult = { result: navigation, navigation, surround }
    // A single walk descends into navigation[], surround[], and nested children.
    assertNoModuleOwnedUnderscoreKeys(navigationResult, 'navigationResult')

    // Depth proof (both directions): a `_`-prefixed key nested inside an
    // envelope sub-container must be rejected. A shallow top-level-only check
    // would pass these because the underscore is nested.
    expect(() => assertNoModuleOwnedUnderscoreKeys({
      route: { resolvedPath: '/guide', alternates: [{ locale: 'en', path: '/guide', source: 'variant', _leak: true }] }
    }, 'nestedRouteLeak')).toThrow()
    expect(() => assertNoModuleOwnedUnderscoreKeys({
      navigation: [{ title: 'Guide', path: '/guide', children: [{ title: 'Intro', path: '/guide/intro', _leak: true }] }]
    }, 'nestedNavigationChildLeak')).toThrow()
    expect(() => assertNoModuleOwnedUnderscoreKeys({
      resolution: { requested: {}, resolved: { locale: 'en', _leak: true }, usedFallback: false }
    }, 'nestedResolutionLeak')).toThrow()

    // Control: the same shapes without the nested leak pass, proving the walk
    // does not spuriously reject clean nested envelopes.
    expect(() => assertNoModuleOwnedUnderscoreKeys({
      route: { resolvedPath: '/guide', alternates: [{ locale: 'en', path: '/guide', source: 'variant' }] },
      resolution: { requested: {}, resolved: { locale: 'en' }, usedFallback: false }
    }, 'cleanEnvelope')).not.toThrow()
  })
})
