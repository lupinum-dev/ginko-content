import { readFile } from 'node:fs/promises'
import { describe, expect, test, vi } from 'vitest'

vi.mock('../../packages/content/dist/runtime/app/composables/content-i18n.js', () => ({
  useRouteBaseName: () => () => undefined,
  useSetI18nParams: () => () => {},
  useSwitchLocalePath: () => () => ''
}))

describe('package export contracts', () => {
  test('built root export loads as Node ESM', async () => {
    const module = await import('@lupinum/ginko-content')

    expect(module.default).toBeTypeOf('function')
    expect(module.defineContentConfig).toBeTypeOf('function')
  })

  test('built server export loads as Node ESM', async () => {
    const server = await import('../../packages/content/dist/public/server.js')

    // Unified query API (ADR-0016).
    expect(server.one).toBeTypeOf('function')
    expect(server.many).toBeTypeOf('function')
    expect(server.paginate).toBeTypeOf('function')
    expect(server.backlinks).toBeTypeOf('function')
    expect(server.resolveOne).toBeTypeOf('function')
    expect(server.variants).toBeTypeOf('function')
    expect(server.tree).toBeTypeOf('function')
    expect(server.neighbors).toBeTypeOf('function')
    expect(server.getCollectionPath).toBeTypeOf('function')
    // Auxiliary / sitemap helpers preserved across the redesign.
    expect(server.queryCollectionsSitemapEntries).toBeTypeOf('function')
    expect(server.createContentProviderError).toBeTypeOf('function')
    expect(server).not.toHaveProperty('serverQueryCollection')
    expect(server).not.toHaveProperty('resolveContentReference')
  })

  test('built client export loads as Node ESM', async () => {
    const client = await import('../../packages/content/dist/public/client.js')

    // Unified query API (ADR-0016).
    expect(client.one).toBeTypeOf('function')
    expect(client.many).toBeTypeOf('function')
    expect(client.paginate).toBeTypeOf('function')
    expect(client.backlinks).toBeTypeOf('function')
    expect(client.resolveOne).toBeTypeOf('function')
    expect(client.variants).toBeTypeOf('function')
    expect(client.tree).toBeTypeOf('function')
    expect(client.neighbors).toBeTypeOf('function')
    expect(client.getCollectionPath).toBeTypeOf('function')
    expect(client.useContentHead).toBeTypeOf('function')
    expect(client.useContentPage).toBeTypeOf('function')
    expect(client.useContentOne).toBeTypeOf('function')
    expect(client.useContentMany).toBeTypeOf('function')
    expect(client.useContentPagination).toBeTypeOf('function')
    expect(client.useContentBacklinks).toBeTypeOf('function')
    expect(client.useContentSearch).toBeTypeOf('function')
    expect(client.useContentTree).toBeTypeOf('function')
    expect(client.useContentNavigation).toBeTypeOf('function')
    expect(client).not.toHaveProperty('queryCollection')
    expect(client).not.toHaveProperty('useContentList')
  })

  test('built provider fixture export loads as Node ESM', async () => {
    const fixtureModule = await import('@lupinum/ginko-content/testing/provider-fixture')

    expect(fixtureModule.createProviderFixture).toBeTypeOf('function')
    expect(fixtureModule.createFixtureContentProvider).toBeTypeOf('function')
    expect(fixtureModule.createProviderFixtureEvent).toBeTypeOf('function')
    expect(fixtureModule.createSaasProviderFixture).toBeTypeOf('function')
    expect(fixtureModule.createAuthorDependencyProviderFixture).toBeTypeOf('function')
  })

  test('built provider contract export loads as Node ESM', async () => {
    const contractModule = await import('@lupinum/ginko-content/testing/provider-contract')

    expect(contractModule.createAuthorDependencyContractProvider).toBeTypeOf('function')
    expect(contractModule.runSaasProviderFixtureContractSuite).toBeTypeOf('function')
    expect(contractModule.runAuthorDependencyContractTest).toBeTypeOf('function')
    expect(contractModule.runAuthorDependencyFixtureSelfTest).toBeTypeOf('function')
  })

  test('public export files keep Node ESM relative specifiers explicit', async () => {
    const [client, server] = await Promise.all([
      readFile('packages/content/dist/public/client.js', 'utf8'),
      readFile('packages/content/dist/public/server.js', 'utf8')
    ])

    expect(client).not.toMatch(/from ['"]\.\.\/runtime\/[^'"]*(?<!\.js)['"]/)
    expect(server).not.toMatch(/from ['"]\.\.\/runtime\/[^'"]*(?<!\.js)['"]/)
  })

  test('package exports are ESM-only and do not advertise require fallbacks', async () => {
    const manifest = JSON.parse(await readFile('packages/content/package.json', 'utf8')) as {
      exports: Record<string, Record<string, string> | string>
    }

    for (const [subpath, target] of Object.entries(manifest.exports)) {
      if (typeof target === 'string') continue
      expect(target, subpath).not.toHaveProperty('require')
    }
  })
})
