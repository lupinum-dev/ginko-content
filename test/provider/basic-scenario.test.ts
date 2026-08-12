import { describe, expect, test } from 'vitest'
import { toContentProviderQuery } from '../../packages/content/src/public/provider-query'
import { createProviderQuery } from '../../packages/content/src/runtime/server/provider-query'
import { createInMemoryProvider } from '../support/provider-scenarios/provider'
import { createBasicScenario } from '../support/provider-scenarios/scenarios'
import { createTestEvent } from '../support/provider-scenarios/event'

describe('basic in-memory provider scenario', () => {
  const scenario = createBasicScenario()
  const provider = createInMemoryProvider(scenario)
  const event = createTestEvent({ scenario, provider })

  test('resolves routes through the provider query wire', async () => {
    await expect(provider.query(event, createProviderQuery({
      collection: 'docs',
      first: true,
      resolveVariant: { route: '/guide/getting-started' }
    }, scenario.runtime))).resolves.toMatchObject({
      result: {
        title: 'Getting Started',
        contentPath: '/guide/getting-started',
        canonicalKey: expect.any(String)
      }
    })

    await expect(provider.query(event, createProviderQuery({
      collection: 'docs',
      first: true,
      resolveVariant: { route: '/missing-page' }
    }, scenario.runtime))).resolves.toEqual({ result: undefined })
  })

  test('returns raw route facts and excludes hidden or draft navigation items', async () => {
    const navigation = await provider.navigation!(event, toContentProviderQuery({
      collection: 'docs',
      sort: [{ path: 1 }]
    }))
    expect(navigation.map(item => item.title)).toEqual(['Guide', 'Getting Started'])
    expect(navigation[0]?.route).toEqual(expect.objectContaining({
      collection: 'docs',
      contentPath: expect.stringMatching(/^\//)
    }))
    expect(JSON.stringify(navigation)).not.toContain('Hidden Page')
  })

  test('covers operators, count, windows, projection, and data documents', async () => {
    await expect(provider.query(event, toContentProviderQuery({
      collection: 'posts',
      where: {
        $and: [
          { category: 'journal' },
          { tags: { $contains: 'content' } },
          { draft: { $ne: true } }
        ]
      },
      sort: [{ order: 1 }],
      only: ['title']
    }))).resolves.toMatchObject({
      result: [
        { title: 'Hello World' },
        { title: 'Second Post' }
      ],
      total: 2
    })

    await expect(provider.query(event, toContentProviderQuery({
      collection: 'posts',
      where: { draft: { $ne: true } },
      count: true
    }))).resolves.toEqual({ result: 2 })

    await expect(provider.query(event, toContentProviderQuery({
      collection: 'posts',
      where: { draft: { $ne: true } },
      sort: [{ order: 1 }],
      skip: 1,
      limit: 1,
      only: ['title']
    }))).resolves.toMatchObject({
      result: [{ title: 'Second Post' }],
      skip: 1,
      limit: 1,
      total: 2
    })
  })

  test('keeps data collections out of route enumeration', async () => {
    const routes = await provider.routes!(event)
    expect(routes.some(route => route.collection === 'data')).toBe(false)
  })
})
