import { describe, expect, test, vi } from 'vitest'
import { createEvent } from './_utils'
import { runSaasProviderFixtureContractSuite } from '../../packages/content/src/testing/provider-contract'

const providerError = (code: string, details: Record<string, unknown> = {}) => Object.assign(new Error(code), {
  statusCode: code === 'missing_locale_route' ? 404 : 400,
  statusMessage: code,
  data: { code, ...details }
})

vi.mock('../../packages/content/src/runtime/server/query-executor', () => ({
  executeFilesystemContentQuery: vi.fn(async (_event, query) => {
    if (query.collection === 'missing') {
      throw providerError('unknown_collection', { collection: 'missing' })
    }
    if (query.where?.title?.$near) {
      throw providerError('unsupported_query_operator', { operator: '$near' })
    }
    if (query.collection === 'versions') {
      return { result: [{ title: 'Launch readiness' }], total: 1 }
    }
    if (query.count) {
      return { result: 1 }
    }
    return {
      result: [
        {
          title: 'Mehrsprachiges Onboarding',
          path: '/magazin/mehrsprachiges-onboarding',
          _locale: 'de'
        }
      ],
      total: 1
    }
  })
}))

vi.mock('../../packages/content/src/runtime/server/navigation-query', () => ({
  resolveContentNavigation: vi.fn(async () => [
    { title: 'Einstieg', path: '/dokumentation/einstieg' }
  ])
}))

vi.mock('../../packages/content/src/runtime/server/collection-helpers', () => ({
  queryFilesystemCollectionNavigation: vi.fn(async () => [
    { title: 'Einstieg', description: 'Start here', path: '/dokumentation/einstieg', _locale: 'de', ref: 'docs.getting-started', stableId: 'docs.getting-started' },
    { title: 'Installation', path: '/dokumentation/einstieg/installation', _locale: 'de', ref: 'docs.installation', stableId: 'docs.installation' }
  ]),
  queryFilesystemCollectionItemSurroundings: vi.fn(async () => [
    { title: 'Alltag', canonicalPath: '/dokumentation/einstieg/alltag', path: '/de/dokumentation/einstieg/alltag' },
    null
  ]),
  queryFilesystemCollectionSearchSections: vi.fn(async () => [
    {
      id: '/de/dokumentation/einstieg#intro',
      title: 'Einstieg',
      titles: ['Einstieg'],
      content: 'Einstieg'
    }
  ]),
  queryFilesystemCollectionPage: vi.fn(async (event, collection, routeOrPath) => {
    if (routeOrPath === '/de/dokumentation/not-found') {
      return null
    }
    event.context.__contentRuntime ||= { memo: {} }
    event.context.__contentRuntime.cacheHint = {
      tags: ['entry:posts:posts.onboarding', 'entry:authors:emily', 'collection:posts', 'route:/de/magazin/mehrsprachiges-onboarding'],
      paths: ['/de/magazin/mehrsprachiges-onboarding']
    }
    return {
      title: 'Einstieg',
      locale: 'de',
      path: '/de/dokumentation/einstieg',
      defaultLocale: 'en',
      resolved: {
        requestedLocale: 'de',
        locale: 'de',
        fallback: false
      },
      variants: [
        { locale: 'en', path: '/docs/getting-started' },
        { locale: 'de', path: '/de/dokumentation/einstieg' }
      ],
      localePaths: {
        en: '/docs/getting-started',
        de: '/de/dokumentation/einstieg'
      }
    }
  }),
  queryFilesystemCollectionRouteMeta: vi.fn(async () => ({
    path: '/de/dokumentation/einstieg',
    locale: 'de',
    defaultLocale: 'en',
    resolved: {
      requestedLocale: 'de',
      locale: 'de',
      fallback: false
    },
    variants: [
      { locale: 'en', path: '/docs/getting-started' },
      { locale: 'de', path: '/de/dokumentation/einstieg' }
    ],
    title: 'Einstieg'
  }))
}))

vi.mock('../../packages/content/src/runtime/server/sitemap', () => ({
  queryFilesystemCollectionsSitemapEntries: vi.fn(async (_event, options) => {
    if (options?.include?.includes('versions')) {
      throw providerError('data_collection_sitemap_access', { collection: 'versions' })
    }
    return [
    { loc: 'https://example.test/de/dokumentation/einstieg' }
    ]
  })
}))

describe('filesystem provider conformance', () => {
  const collectNavPaths = (items: Array<{ path?: string, children?: any[] }>): string[] =>
    items.flatMap(item => [
      item.path,
      ...collectNavPaths(item.children || [])
    ].filter(Boolean) as string[])

  runSaasProviderFixtureContractSuite({
    name: 'filesystem',
    expectedProviderName: 'filesystem',
    loadProvider: async () => {
      const { filesystemProvider } = await import('../../packages/content/src/runtime/server/providers/filesystem')
      return filesystemProvider
    },
    createEvent,
    collectNavPaths
  })

  test('accepts public prefix filters advertised by the query contract', async () => {
    const { filesystemProvider } = await import('../../packages/content/src/runtime/server/providers/filesystem')

    await expect(filesystemProvider.query(createEvent(), {
      collection: 'posts',
      where: { path: { $prefix: '/magazin' } }
    })).resolves.toMatchObject({
      result: expect.any(Array)
    })
  })

  test('rejects standalone regex options instead of treating them as match-all filters', async () => {
    const { filesystemProvider } = await import('../../packages/content/src/runtime/server/providers/filesystem')

    expect(filesystemProvider.capabilities.query.operators).not.toContain('$options')
    expect(() => filesystemProvider.query(createEvent(), {
      collection: 'posts',
      where: { title: { $options: 'i' } }
    })).toThrow('$options requires $regex')
  })
})
