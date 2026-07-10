import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createEvent, doc } from './_utils'
import { createProviderQuery } from '../../packages/content/src/runtime/server/provider-query'

vi.mock('#imports', () => ({
  useRuntimeConfig: () => ({
    public: { content: { navigation: { fields: [] } } },
    content: {
      defaultLocale: 'en',
      localeFallback: { de: ['en'] },
      collections: {
        docs: { i18n: true },
        blog: { i18n: false }
      }
    }
  })
}))

const getContentsList = vi.fn()
const getContent = vi.fn()
const createServerContentQuery = vi.fn()

vi.mock('../../packages/content/src/runtime/server/storage', () => ({
  createServerContentQuery
}))

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
// envelope. This walks the *module-owned* containers of a result — the item
// envelope itself, its `resolved` block, and the localization sub-envelopes
// `variants[]` / `localePaths` entries / `navigation` + `surround` items (and
// nested navigation `children`) — but deliberately does NOT descend into user
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

  descend(container.resolved, `${where}.resolved`)
  descendEach(container.variants, `${where}.variants`)
  descendEach(container.navigation, `${where}.navigation`)
  descendEach(container.surround, `${where}.surround`)
  descendEach(container.children, `${where}.children`)
  if (container.localePaths && typeof container.localePaths === 'object' && !Array.isArray(container.localePaths)) {
    for (const [locale, entry] of Object.entries(container.localePaths as Record<string, unknown>)) {
      descend(entry, `${where}.localePaths.${locale}`)
    }
  }
}

describe('query execution contracts', () => {
  beforeEach(() => {
    getContentsList.mockReset()
    getContent.mockReset()
    createServerContentQuery.mockReset()
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

    const { executeContentQuery: rawExecuteContentQuery } = await import('../../packages/content/src/runtime/server/query-executor')
    // The executor now takes a lowered plan (CS-5); lower builder params here.
    const executeContentQuery = (event: any, params: any) => rawExecuteContentQuery(event, createProviderQuery(params).plan)
    const event = createEvent()

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
          availableLocales: ['en', 'de']
        }
      },
      {
        title: 'Guide EN',
        resolved: {
          requestedLocale: 'de',
          locale: 'en',
          fallback: true,
          availableLocales: ['en']
        }
      },
      {
        title: 'Middle DE',
        resolved: {
          requestedLocale: 'de',
          locale: 'de',
          fallback: false,
          availableLocales: ['de']
        }
      },
      {
        title: 'Advanced EN',
        resolved: {
          requestedLocale: 'de',
          locale: 'en',
          fallback: true,
          availableLocales: ['en']
        }
      },
      {
        title: 'Zed DE',
        resolved: {
          requestedLocale: 'de',
          locale: 'de',
          fallback: false,
          availableLocales: ['en', 'de']
        }
      }
      ],
      skip: 0,
      limit: 0,
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

    const { executeContentQuery: rawExecuteContentQuery } = await import('../../packages/content/src/runtime/server/query-executor')
    // The executor now takes a lowered plan (CS-5); lower builder params here.
    const executeContentQuery = (event: any, params: any) => rawExecuteContentQuery(event, createProviderQuery(params).plan)
    const event = createEvent()

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
    const { localizePageResult } = await import('../../packages/content/src/features/localization/results')

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

    const shaped = localizePageResult({
      path: '/leitfaden/einstieg',
      locale: 'de',
      resolved: {
        locale: 'de',
        variantPaths: {
          de: '/leitfaden/einstieg',
          en: '/guide/intro'
        }
      }
    } as any, 'de', 'en', ['en', 'de'])

    expect(shaped.variants.map(variant => variant.locale)).toEqual(['en', 'de'])
    expect(shaped.resolved.availableLocales).toEqual(['en', 'de'])

    // Reverse insertion direction: feed the graph the same variants en-first,
    // and shape with the variant-path map en-first. Canonical ordering must be
    // identical (default-locale first), proving the result is independent of
    // graph-insertion / object-key order — not merely echoing the input.
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

    const reversedShaped = localizePageResult({
      path: '/guide/intro',
      locale: 'en',
      resolved: {
        locale: 'en',
        variantPaths: {
          en: '/guide/intro',
          de: '/leitfaden/einstieg'
        }
      }
    } as any, 'en', 'en', ['en', 'de'])

    expect(reversedShaped.variants.map(variant => variant.locale)).toEqual(['en', 'de'])
    expect(reversedShaped.resolved.availableLocales).toEqual(['en', 'de'])
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

    const { executeContentQuery: rawExecuteContentQuery } = await import('../../packages/content/src/runtime/server/query-executor')
    // The executor now takes a lowered plan (CS-5); lower builder params here.
    const executeContentQuery = (event: any, params: any) => rawExecuteContentQuery(event, createProviderQuery(params).plan)

    const result = await executeContentQuery(createEvent(), {
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
    const { createQuery } = await import('../../packages/content/src/core/query/builder')
    const contents = [
      doc({ collection: 'docs', path: '/guide/intro', title: 'Intro', order: 1, group: 'docs' }),
      doc({ collection: 'docs', path: '/guide/advanced', title: 'Advanced', order: 2, group: 'docs' }),
      doc({ collection: 'blog', path: '/blog/post', title: 'Post', order: 0, group: 'blog' })
    ]

    const query = createQuery(async (builtQuery: any) => {
      const plan = lowerQueryPlan(builtQuery.params())
      return executeQueryPlanOnDocuments(contents, plan)
    }, {
      initialParams: {
        collection: 'docs'
      } as any
    })
      .where('path', '=', '/guide/advanced')
      .where('group', '=', 'docs')
      .order('order', 'ASC')
      .select('title', 'path')

    const plan = lowerQueryPlan((query as any).params())
    const result = executeQueryPlanOnDocuments(contents, plan)

    expect(result.result).toEqual([
      { title: 'Advanced', path: '/guide/advanced' }
    ])
  })

  // VNEXT.md 13.6/24.2/24.4: one core visibility decision, applied at the
  // untrusted public query boundary. Structural eligibility (partial,
  // navigationFile) is unconditional — never a route, in any environment —
  // while draft is the one environment-aware publication-visibility fact.
  test('executeContentQuery applies structural exclusion unconditionally and draft visibility per environment', async () => {
    const { executeContentQuery: rawExecuteContentQuery } = await import('../../packages/content/src/runtime/server/query-executor')
    const executeContentQuery = (event: any, params: any) => rawExecuteContentQuery(event, createProviderQuery(params).plan)

    const dataset = [
      doc({ id: 'content:en:docs:published.md', collection: 'docs', canonicalKey: 'docs/published', path: '/docs/published', title: 'Published' }),
      doc({ id: 'content:en:docs:draft.md', collection: 'docs', canonicalKey: 'docs/draft', path: '/docs/draft', title: 'Draft', draft: true }),
      doc({ id: 'content:en:docs:_dir.yml', collection: 'docs', canonicalKey: 'docs/_dir', path: '/docs', title: 'Dir config', partial: true }),
      doc({ id: 'content:en:docs:_nav.yml', collection: 'docs', canonicalKey: 'docs/_nav', path: '/docs/nav', title: 'Nav marker', navigationFile: true })
    ]
    getContentsList.mockResolvedValue(dataset)

    const result = await executeContentQuery(createEvent(), { collection: 'docs' })
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
    const { executeContentQuery: rawExecuteContentQuery } = await import('../../packages/content/src/runtime/server/query-executor')
    // The executor now takes a lowered plan (CS-5); lower builder params here.
    const executeContentQuery = (event: any, params: any) => rawExecuteContentQuery(event, createProviderQuery(params).plan)

    await expect(executeContentQuery(createEvent(), {
      where: [{ path: '/guide/intro' }]
    } as any)).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'Invalid content query'
    })
  })

  test('executeContentQuery rejects public regex filters before graph execution', async () => {
    const { executeContentQuery: rawExecuteContentQuery } = await import('../../packages/content/src/runtime/server/query-executor')
    // The executor now takes a lowered plan (CS-5); lower builder params here.
    const executeContentQuery = (event: any, params: any) => rawExecuteContentQuery(event, createProviderQuery(params).plan)

    await expect(executeContentQuery(createEvent(), {
      collection: 'docs',
      where: [{ title: { $regex: 'intro' } }]
    } as any)).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'Invalid content query'
    })

    await expect(executeContentQuery(createEvent(), {
      collection: 'docs',
      where: [{ title: /intro/ }]
    } as any)).rejects.toMatchObject({
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

    const { executeContentQuery: rawExecuteContentQuery } = await import('../../packages/content/src/runtime/server/query-executor')
    // The executor now takes a lowered plan (CS-5); lower builder params here.
    const executeContentQuery = (event: any, params: any) => rawExecuteContentQuery(event, createProviderQuery(params).plan)

    await expect(executeContentQuery(createEvent(), {
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
      limit: 0,
      total: 2
    })
  })

  test('executeContentQuery clamps public pagination bounds', async () => {
    const dataset = [
      doc({ collection: 'docs', id: 'content:guide:a.md', file: { path: '/guide/a.md' }, canonicalKey: 'guide/a', path: '/guide/a', title: 'A', order: 1 }),
      doc({ collection: 'docs', id: 'content:guide:b.md', file: { path: '/guide/b.md' }, canonicalKey: 'guide/b', path: '/guide/b', title: 'B', order: 2 }),
      doc({ collection: 'docs', id: 'content:guide:c.md', file: { path: '/guide/c.md' }, canonicalKey: 'guide/c', path: '/guide/c', title: 'C', order: 3 })
    ]

    getContentsList.mockResolvedValue(dataset)

    const { executeContentQuery: rawExecuteContentQuery } = await import('../../packages/content/src/runtime/server/query-executor')
    // The executor now takes a lowered plan (CS-5); lower builder params here.
    const executeContentQuery = (event: any, params: any) => rawExecuteContentQuery(event, createProviderQuery(params).plan)

    await expect(executeContentQuery(createEvent(), {
      collection: 'docs',
      sort: [{ order: 1 }],
      skip: -5,
      limit: 9999
    } as any)).resolves.toMatchObject({
      result: [
        { title: 'A' },
        { title: 'B' },
        { title: 'C' }
      ],
      skip: 0,
      limit: 100,
      total: 3
    })
  })

  test('module-owned envelope walk covers navigation results and rejects nested underscore metadata', async () => {
    const { localizeNavigation, localizeSurround } = await import('../../packages/content/src/features/localization/results')

    // Real navigation/surround shaping produces the `navigation`/`surround`
    // sub-envelopes (with nested `children`) attached to a navigation result.
    const navigation = localizeNavigation([
      { title: 'Guide', path: '/guide', children: [{ title: 'Intro', path: '/guide/intro' }] } as any
    ], 'en', 'en', ['en', 'de'])
    const surround = localizeSurround([
      { title: 'Prev', path: '/guide/a' },
      { title: 'Next', path: '/guide/b' }
    ] as any, 'en', 'en', ['en', 'de'])

    const navigationResult = { result: navigation, navigation, surround }
    // A single walk descends into navigation[], surround[], and nested children.
    assertNoModuleOwnedUnderscoreKeys(navigationResult, 'navigationResult')

    // Depth proof (both directions): a `_`-prefixed key nested inside an
    // envelope sub-container must be rejected. A shallow top-level-only check
    // would pass these (their top-level keys are `resolved` / `variants` /
    // `navigation`, none underscore) — only the deepened walk catches the leak.
    expect(() => assertNoModuleOwnedUnderscoreKeys({
      path: '/guide',
      resolved: { locale: 'en', _leak: true }
    }, 'nestedResolvedLeak')).toThrow()
    expect(() => assertNoModuleOwnedUnderscoreKeys({
      path: '/guide',
      variants: [{ locale: 'en', path: '/guide', _leak: true }]
    }, 'nestedVariantLeak')).toThrow()
    expect(() => assertNoModuleOwnedUnderscoreKeys({
      navigation: [{ title: 'Guide', path: '/guide', children: [{ title: 'Intro', path: '/guide/intro', _leak: true }] }]
    }, 'nestedNavigationChildLeak')).toThrow()
    expect(() => assertNoModuleOwnedUnderscoreKeys({
      localePaths: { en: { path: '/guide', translated: true, _leak: true } }
    }, 'nestedLocalePathLeak')).toThrow()

    // Control: the same shapes without the nested leak pass, proving the walk
    // does not spuriously reject clean nested envelopes.
    expect(() => assertNoModuleOwnedUnderscoreKeys({
      path: '/guide',
      resolved: { locale: 'en' },
      variants: [{ locale: 'en', path: '/guide' }],
      localePaths: { en: { path: '/guide', translated: true } }
    }, 'cleanEnvelope')).not.toThrow()
  })
})
