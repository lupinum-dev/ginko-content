import { describe, expect, test } from 'vitest'
import { createInMemoryProvider } from '../harness/provider'
import { createBasicScenario } from '../harness/scenarios'
import { createTestEvent } from '../harness/event'
import { expectProviderError } from '../harness/assertions'

describe('basic content scenario harness', () => {
  const scenario = createBasicScenario()
  const provider = createInMemoryProvider(scenario)
  const event = createTestEvent({ scenario, provider })

  test('resolves page routes without a Nuxt production build', async () => {
    await expect(provider.page(event, 'pages', '/')).resolves.toMatchObject({
      title: 'Ginko',
      path: '/'
    })

    await expect(provider.page(event, 'docs', '/guide/getting-started')).resolves.toMatchObject({
      title: 'Getting Started',
      path: '/guide/getting-started'
    })

    await expect(provider.page(event, 'docs', '/missing-page')).resolves.toBeNull()
  })

  test('keeps hidden and draft content out of navigation-facing reads', async () => {
    const navigation = await provider.navigation(event, 'docs')
    expect(navigation.map(item => item.title)).toEqual(['Guide', 'Getting Started'])
    expect(JSON.stringify(navigation)).not.toContain('Hidden Page')

    const posts = await provider.navigation(event, 'posts')
    expect(JSON.stringify(posts)).not.toContain('Third Post')
  })

  test('covers query operators, count, windows, projection, and structured content in-process', async () => {
    await expect(provider.query(event, {
      collection: 'posts',
      where: {
        $and: [
          { category: 'journal' },
          { tags: { $contains: 'content' } },
          { _draft: { $ne: true } }
        ]
      },
      sort: [{ order: 1 }],
      only: ['title', '_path']
    })).resolves.toMatchObject({
      result: [
        { title: 'Hello World', _path: '/blog/hello-world' },
        { title: 'Second Post', _path: '/blog/second-post' }
      ],
      total: 2
    })

    await expect(provider.query(event, {
      collection: 'posts',
      where: { _draft: { $ne: true } },
      count: true
    })).resolves.toEqual({ result: 2 })

    await expect(provider.query(event, {
      collection: 'posts',
      where: { _draft: { $ne: true } },
      sort: [{ order: 1 }],
      skip: 1,
      limit: 1,
      only: ['title']
    })).resolves.toMatchObject({
      result: [{ title: 'Second Post' }],
      skip: 1,
      limit: 1,
      total: 2
    })

    await expect(provider.query(event, {
      collection: 'data',
      sort: [{ _path: 1 }],
      only: ['title', 'version', 'owner', 'downloads']
    })).resolves.toMatchObject({
      result: [
        { title: 'App config', version: 2, owner: 'Matthias' },
        { title: 'Metrics', downloads: 42 },
        { title: 'Team', owner: 'Matthias' }
      ]
    })
  })

  test('does not expose data collections through route or sitemap access', async () => {
    await expectProviderError(
      provider.page(event, 'data', '/data/app'),
      'data_collection_route_access',
      { collection: 'data' }
    )

    await expectProviderError(
      provider.sitemapEntries(event, { include: ['data'] }),
      'data_collection_sitemap_access',
      { collection: 'data' }
    )
  })
})
