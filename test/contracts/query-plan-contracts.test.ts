import { describe, expect, test } from 'vitest'
import { doc } from './_utils'

describe('query plan contracts', () => {
  test('lowers grouped where clauses into an explicit AST', async () => {
    const { lowerQueryPlan } = await import('../../packages/content/src/core/query/lower')

    const plan = lowerQueryPlan({
      collection: 'docs',
      where: [
        {
          $or: [
            { path: '/guide/intro' },
            { $and: [{ published: true }, { title: { $regex: /intro/i } }] }
          ]
        }
      ],
      sort: [{ date: -1, $numeric: true }],
      only: ['title', 'path']
    } as any)

    expect(plan).toMatchObject({
      collection: 'docs',
      filter: {
        type: 'or',
        clauses: [
          {
            type: 'compare',
            field: 'path',
            operator: 'eq',
            value: '/guide/intro'
          },
          {
            type: 'and',
            clauses: [
              {
                type: 'compare',
                field: 'published',
                operator: 'eq',
                value: true
              },
              {
                type: 'compare',
                field: 'title',
                operator: 'regex'
              }
            ]
          }
        ]
      },
      sort: [{ field: 'date', direction: -1, numeric: true }],
      projection: { only: ['title', 'path'], without: [] },
      mode: 'all'
    })
    expect(plan.pagination).toEqual({ mode: 'slice', skip: 0, limit: 100 })
    expect(plan).not.toHaveProperty('skip')
    expect(plan).not.toHaveProperty('limit')
    expect(plan).not.toHaveProperty('paging')
  })

  test('captures locale and variant resolution as explicit plan nodes', async () => {
    const { lowerQueryPlan } = await import('../../packages/content/src/core/query/lower')

    const localePlan = lowerQueryPlan({
      first: true,
      resolveLocale: {
        locale: 'de',
        fallback: ['fr', 'en'],
        exact: false
      }
    } as any)
    const variantPlan = lowerQueryPlan({
      first: true,
      resolveVariant: {
        path: '/guide/intro',
        locale: 'de',
        fallback: ['en']
      }
    } as any)

    expect(localePlan).toMatchObject({
      mode: 'first',
      resolveLocale: {
        locale: 'de',
        fallback: ['fr', 'en'],
        exact: false
      }
    })
    expect(variantPlan).toMatchObject({
      mode: 'first',
      variant: {
        path: '/guide/intro',
        locale: 'de',
        fallback: ['en']
      }
    })

    const noFallbackPlan = lowerQueryPlan({
      first: true,
      resolveVariant: {
        ref: 'docs.intro',
        locale: 'de'
      }
    } as any)
    expect(noFallbackPlan.variant).toEqual({
      ref: 'docs.intro',
      locale: 'de'
    })

    const disabledFallbackPlan = lowerQueryPlan({
      first: true,
      resolveLocale: { locale: 'de', fallback: false, exact: false },
      resolveVariant: { ref: 'docs.intro', locale: 'de', fallback: false, exact: false }
    } as any)
    expect(disabledFallbackPlan.resolveLocale).toEqual({ locale: 'de', exact: true })
    expect(disabledFallbackPlan.variant).toEqual({ ref: 'docs.intro', locale: 'de', exact: true })
  })

  test('uses the selected collection default when locale resolution has no explicit fallback', async () => {
    const { buildContentGraph } = await import('../../packages/content/src/core/content/graph')
    const { executeQueryPlan } = await import('../../packages/content/src/core/query/execute')
    const { lowerQueryPlan } = await import('../../packages/content/src/core/query/lower')

    const graph = buildContentGraph([
      doc({ collection: 'docs', canonicalKey: 'docs:intro', locale: 'en', path: '/docs/intro', title: 'Global default' }),
      doc({ collection: 'docs', canonicalKey: 'docs:intro', locale: 'fr', path: '/documentation/introduction', title: 'Collection default' })
    ])
    const plan = lowerQueryPlan({
      collection: 'docs',
      first: true,
      resolveLocale: { locale: 'de' }
    } as any)

    const response = executeQueryPlan<{ title: string, locale: string }>(graph, plan, {
      defaultLocale: 'en',
      collections: {
        docs: {
          i18n: { defaultLocale: 'fr', locales: ['fr', 'de', 'en'] }
        }
      }
    })

    expect(response.result).toMatchObject({
      title: 'Collection default',
      locale: 'fr'
    })
  })

  test('executes path equality without using path indexes for unsafe $or branches', async () => {
    const { buildContentGraph } = await import('../../packages/content/src/core/content/graph')
    const { executeQueryPlan } = await import('../../packages/content/src/core/query/execute')
    const { lowerQueryPlan } = await import('../../packages/content/src/core/query/lower')

    const graph = buildContentGraph([
      doc({ collection: 'docs', id: 'content:docs:a.md', path: '/docs/a', canonicalKey: 'docs/a', title: 'A', order: 1 }),
      doc({ collection: 'docs', id: 'content:docs:b.md', path: '/docs/b', canonicalKey: 'docs/b', title: 'Outside', order: 2 }),
      doc({ collection: 'docs', id: 'content:docs:c.md', path: '/docs/c', canonicalKey: 'docs/c', title: 'C', order: 3 })
    ])
    const plan = lowerQueryPlan({
      collection: 'docs',
      where: [{ $or: [{ path: '/docs/a' }, { title: 'Outside' }] }],
      sort: [{ order: 1 }]
    } as any)

    const result = executeQueryPlan<Record<string, unknown>>(graph, plan)

    expect((result.result as Array<Record<string, unknown>>).map(item => item.title)).toEqual([
      'A',
      'Outside'
    ])
  })

  test('executes $not path filters without preselecting the negated path', async () => {
    const { buildContentGraph } = await import('../../packages/content/src/core/content/graph')
    const { executeQueryPlan } = await import('../../packages/content/src/core/query/execute')
    const { lowerQueryPlan } = await import('../../packages/content/src/core/query/lower')

    const graph = buildContentGraph([
      doc({ collection: 'docs', id: 'content:docs:a.md', path: '/docs/a', canonicalKey: 'docs/a', title: 'A', order: 1 }),
      doc({ collection: 'docs', id: 'content:docs:b.md', path: '/docs/b', canonicalKey: 'docs/b', title: 'B', order: 2 }),
      doc({ collection: 'docs', id: 'content:docs:c.md', path: '/docs/c', canonicalKey: 'docs/c', title: 'C', order: 3 })
    ])
    const plan = lowerQueryPlan({
      collection: 'docs',
      where: [{ $not: { path: '/docs/a' } }],
      sort: [{ order: 1 }]
    } as any)

    const result = executeQueryPlan<Record<string, unknown>>(graph, plan)

    expect((result.result as Array<Record<string, unknown>>).map(item => item.title)).toEqual([
      'B',
      'C'
    ])
  })

  test('still executes simple path equality filters', async () => {
    const { buildContentGraph } = await import('../../packages/content/src/core/content/graph')
    const { executeQueryPlan } = await import('../../packages/content/src/core/query/execute')
    const { lowerQueryPlan } = await import('../../packages/content/src/core/query/lower')

    const graph = buildContentGraph([
      doc({ collection: 'docs', id: 'content:docs:a.md', path: '/docs/a', canonicalKey: 'docs/a', title: 'A', order: 1 }),
      doc({ collection: 'docs', id: 'content:docs:b.md', path: '/docs/b', canonicalKey: 'docs/b', title: 'B', order: 2 })
    ])
    const plan = lowerQueryPlan({
      collection: 'docs',
      where: [{ path: '/docs/b' }]
    } as any)

    const result = executeQueryPlan<Record<string, unknown>>(graph, plan)

    expect((result.result as Array<Record<string, unknown>>).map(item => item.title)).toEqual(['B'])
  })

  test('resolves route variants for single-locale content without requiring a default locale', async () => {
    const { buildContentGraph } = await import('../../packages/content/src/core/content/graph')
    const { executeQueryPlan } = await import('../../packages/content/src/core/query/execute')
    const { lowerQueryPlan } = await import('../../packages/content/src/core/query/lower')

    const graph = buildContentGraph([
      doc({ collection: 'docs', id: 'content:docs:intro.md', path: '/docs/intro', locale: undefined, canonicalKey: 'docs/intro', title: 'Intro' })
    ])
    const plan = lowerQueryPlan({
      collection: 'docs',
      first: true,
      resolveVariant: { route: '/docs/intro' }
    } as any)

    const result = executeQueryPlan<Record<string, unknown>>(graph, plan, {
      collections: { docs: { route: '/docs' } }
    })

    expect(result.result).toMatchObject({
      title: 'Intro',
      resolved: { requestedRoute: '/docs/intro' }
    })
  })

  test('executes multi-key sort with earlier fields as dominant keys', async () => {
    const { executeQueryPlanOnDocuments } = await import('../../packages/content/src/core/query/execute')
    const { lowerQueryPlan } = await import('../../packages/content/src/core/query/lower')

    const documents = [
      { title: 'new-unfeatured', featured: false, date: '2026-01-01' },
      { title: 'new-featured', featured: true, date: '2025-01-01' },
      { title: 'old-featured', featured: true, date: '2024-01-01' },
      { title: 'old-unfeatured', featured: false, date: '2023-01-01' }
    ]
    const plan = lowerQueryPlan({
      sort: [{ featured: -1, date: -1 }]
    } as any)

    const result = executeQueryPlanOnDocuments(documents, plan)

    expect(result.result.map(item => item.title)).toEqual([
      'new-featured',
      'old-featured',
      'new-unfeatured',
      'old-unfeatured'
    ])
  })

  test('filesystem cursor execution rejects malformed or noncanonical offsets instead of restarting the first page', async () => {
    const { executeQueryPlanOnDocuments } = await import('../../packages/content/src/core/query/execute')
    const { lowerQueryPlan } = await import('../../packages/content/src/core/query/lower')
    const documents = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

    const firstPlan = lowerQueryPlan({
      paging: { mode: 'cursor', after: null, limit: 1 }
    } as any)
    const firstPage = executeQueryPlanOnDocuments(documents, firstPlan)
    expect(firstPage).toMatchObject({
      mode: 'cursor',
      result: [{ id: 'a' }],
      pageInfo: { hasNext: true, endCursor: expect.any(String) }
    })

    const cursor = (firstPage as { pageInfo: { endCursor: string } }).pageInfo.endCursor
    const secondPlan = lowerQueryPlan({
      paging: { mode: 'cursor', after: cursor, limit: 1 }
    } as any)
    expect(executeQueryPlanOnDocuments(documents, secondPlan)).toMatchObject({
      result: [{ id: 'b' }]
    })

    const encoded = (raw: string) => Buffer.from(raw).toString('base64')
    const malformedCursors = {
      empty: '',
      'invalid base64': 'not-base64!',
      'invalid UTF-8': Buffer.from([0xFF]).toString('base64'),
      'wrong prefix': encoded('x:1'),
      'negative offset': encoded('o:-1'),
      'fractional offset': encoded('o:1.5'),
      'unsafe integer offset': encoded('o:9007199254740992'),
      'leading-zero offset': encoded('o:01'),
      'noncanonical base64': encoded('o:10').replace(/=+$/u, '')
    }

    for (const [name, after] of Object.entries(malformedCursors)) {
      const plan = lowerQueryPlan({
        paging: { mode: 'cursor', after, limit: 1 }
      } as any)
      expect(
        () => executeQueryPlanOnDocuments(documents, plan),
        name
      ).toThrow(expect.objectContaining({
        statusCode: 400,
        statusMessage: 'unsupported_query_shape',
        data: expect.objectContaining({
          code: 'unsupported_query_shape',
          provider: 'filesystem',
          field: 'paging.after'
        })
      }))
    }
  })

  // The canonical document value model has no Date union —
  // query comparison operates on canonical strings (UTC ISO 8601 for
  // `fields.datetime()`). This test pins the JSON-wire round-trip contract
  // using that canonical string shape instead of a raw `Date` operand.
  test('executes UTC ISO string operands consistently after JSON wire lowering', async () => {
    const { executeQueryPlanOnDocuments } = await import('../../packages/content/src/core/query/execute')
    const { lowerQueryPlan } = await import('../../packages/content/src/core/query/lower')

    const plan = lowerQueryPlan({
      where: [{ date: { $gt: '2026-01-01T00:00:00.000Z' } }]
    } as any)

    const documents = [
      { title: 'before', date: '2025-12-31T00:00:00.000Z' },
      { title: 'after', date: '2026-01-02T00:00:00.000Z' }
    ]

    const inProcess = executeQueryPlanOnDocuments(documents, plan)
    const roundTripped = executeQueryPlanOnDocuments(documents, JSON.parse(JSON.stringify(plan)))

    expect(inProcess.result.map(item => item.title)).toEqual(['after'])
    expect(roundTripped.result.map(item => item.title)).toEqual(['after'])
  })
})
