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
      resolveVariant: {
        path: '/guide/intro',
        locale: 'de',
        fallback: ['en']
      }
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
      doc({ collection: 'docs', id: 'content:docs:intro.md', path: '/docs/intro', _locale: undefined, canonicalKey: 'docs/intro', title: 'Intro' })
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
})
