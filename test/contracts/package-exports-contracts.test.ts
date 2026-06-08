import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { runtimeAppImportSpecs } from '../../packages/content/src/module/runtime-assets'

vi.mock('../../packages/content/dist/runtime/app/composables/content-i18n.js', () => ({
  useRouteBaseName: () => () => undefined,
  useSetI18nParams: () => () => {},
  useSwitchLocalePath: () => () => ''
}))

type PublicSurface = {
  packageExportSubpaths: Record<string, PublicSurfaceEntry>
  clientValueExports: Record<string, PublicSurfaceEntry>
  clientTypeExports: Record<string, PublicSurfaceEntry>
  serverValueExports: Record<string, PublicSurfaceEntry>
  serverTypeExports: Record<string, PublicSurfaceEntry>
  runtimeAppAutoImports: Record<string, PublicSurfaceEntry>
}

type PublicSurfaceEntry = {
  category: string
  audience: string
  docs: string
}

const readPublicSurface = async (): Promise<PublicSurface> =>
  JSON.parse(await readFile('meta/public-surface.json', 'utf8')) as PublicSurface

const collectMarkdownFiles = async (root: string): Promise<string[]> => {
  const entries = await readdir(root, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return collectMarkdownFiles(path)
    return entry.name.endsWith('.md') ? [path] : []
  }))
  return nested.flat()
}

const readPublicDocsCorpus = async () => {
  const files = await Promise.all([
    collectMarkdownFiles('docs/content'),
    collectMarkdownFiles('packages/content/docs'),
    collectMarkdownFiles('meta/skill')
  ])
  const source = await Promise.all(files.flat().map(file => readFile(file, 'utf8')))
  return source.join('\n')
}

const extractValueExports = (source: string) => {
  const names = new Set<string>()
  const exportBlockPattern = /export\s*\{([\s\S]*?)\}\s*from/g
  for (const match of source.matchAll(exportBlockPattern)) {
    const entries = match[1]
      .split(',')
      .map(entry => entry.trim())
      .filter(Boolean)

    for (const entry of entries) {
      if (entry.startsWith('type ')) continue
      names.add(entry.split(/\s+as\s+/)[0]!.trim())
    }
  }

  for (const match of source.matchAll(/export\s+const\s+([A-Za-z0-9_]+)/g)) {
    names.add(match[1]!)
  }

  return [...names].sort()
}

const extractTypeExports = (source: string) => {
  const names = new Set<string>()
  const exportBlockPattern = /export\s*\{([\s\S]*?)\}\s*from/g
  for (const match of source.matchAll(exportBlockPattern)) {
    const entries = match[1]
      .split(',')
      .map(entry => entry.trim())
      .filter(Boolean)

    for (const entry of entries) {
      if (!entry.startsWith('type ')) continue
      names.add(entry.replace(/^type\s+/, '').split(/\s+as\s+/)[0]!.trim())
    }
  }

  const exportTypeBlockPattern = /export\s+type\s*\{([\s\S]*?)\}\s*from/g
  for (const match of source.matchAll(exportTypeBlockPattern)) {
    const entries = match[1]
      .split(',')
      .map(entry => entry.trim())
      .filter(Boolean)

    for (const entry of entries) {
      names.add(entry.split(/\s+as\s+/)[0]!.trim())
    }
  }

  return [...names].sort()
}

describe('package export contracts', () => {
  test('source package export map stays intentionally curated', async () => {
    const publicSurface = await readPublicSurface()
    const manifest = JSON.parse(await readFile('packages/content/package.json', 'utf8')) as {
      exports: Record<string, Record<string, string> | string>
    }

    expect(Object.keys(manifest.exports).sort()).toEqual(Object.keys(publicSurface.packageExportSubpaths).sort())
  })

  test('source client facade value exports stay intentionally curated', async () => {
    const publicSurface = await readPublicSurface()
    const source = await readFile('packages/content/src/public/client.ts', 'utf8')

    expect(extractValueExports(source)).toEqual(Object.keys(publicSurface.clientValueExports).sort())
  })

  test('source client facade type exports stay intentionally curated', async () => {
    const publicSurface = await readPublicSurface()
    const source = await readFile('packages/content/src/public/client.ts', 'utf8')

    expect(extractTypeExports(source)).toEqual(Object.keys(publicSurface.clientTypeExports).sort())
  })

  test('source server facade value exports stay intentionally curated', async () => {
    const publicSurface = await readPublicSurface()
    const source = await readFile('packages/content/src/public/server.ts', 'utf8')

    expect(extractValueExports(source)).toEqual(Object.keys(publicSurface.serverValueExports).sort())
  })

  test('source server facade type exports stay intentionally curated', async () => {
    const publicSurface = await readPublicSurface()
    const source = await readFile('packages/content/src/public/server.ts', 'utf8')

    expect(extractTypeExports(source)).toEqual(Object.keys(publicSurface.serverTypeExports).sort())
  })

  test('runtime app auto-imports stay intentionally curated', async () => {
    const publicSurface = await readPublicSurface()

    expect(runtimeAppImportSpecs.map(spec => spec.name).sort()).toEqual(Object.keys(publicSurface.runtimeAppAutoImports).sort())
  })

  test('app-facing runtime imports are documented by name', async () => {
    const publicSurface = await readPublicSurface()
    const docsCorpus = await readPublicDocsCorpus()

    for (const name of Object.keys(publicSurface.runtimeAppAutoImports)) {
      expect(docsCorpus, name).toContain(name)
    }
  })

  test('public surface classification uses known audience categories and docs targets', async () => {
    const publicSurface = await readPublicSurface()
    const knownCategories = new Set([
      'nuxt-module-entry',
      'content-config-author',
      'server-runtime-and-provider-author',
      'app-runtime',
      'toc-compatibility',
      'advanced-cms-contract',
      'advanced-cms-import',
      'testing-only-provider-fixture',
      'testing-only-provider-contract',
      'markdown-transformer-extension',
      'stable-query-primitive',
      'stable-route-helper',
      'advanced-agent-path-helper',
      'stable-app-composable',
      'compatibility-app-composable',
      'stable-search-composable',
      'stable-site-data-helper',
      'stable-toc-helper',
      'stable-server-query',
      'advanced-server-query-context',
      'advanced-agent-markdown-extension',
      'advanced-agent-site-generation',
      'stable-sitemap-helper',
      'stable-provider-author-helper',
      'stable-provider-cache-helper',
      'stable-route-helper-type',
      'stable-app-composable-type',
      'stable-query-type',
      'stable-search-type',
      'stable-site-data-type',
      'stable-toc-type',
      'stable-content-rendering-type',
      'advanced-agent-markdown-type',
      'advanced-agent-site-type',
      'stable-sitemap-type',
      'transport-query-type',
      'stable-provider-cache-type',
      'stable-provider-author-type'
    ])

    const entries = [
      ...Object.values(publicSurface.packageExportSubpaths),
      ...Object.values(publicSurface.clientValueExports),
      ...Object.values(publicSurface.clientTypeExports),
      ...Object.values(publicSurface.serverValueExports),
      ...Object.values(publicSurface.serverTypeExports),
      ...Object.values(publicSurface.runtimeAppAutoImports)
    ]

    for (const entry of entries) {
      expect([...knownCategories], entry.category).toContain(entry.category)
      expect(entry.audience).toMatch(/^[a-z][a-z-]+$/)
      expect(entry.docs).toMatch(/^(docs|packages|meta)\//)
      await expect(readFile(entry.docs, 'utf8'), entry.docs).resolves.toBeTypeOf('string')
    }
  })

  test('premature locale-switch helper is not part of the public surface', async () => {
    const publicSurface = await readPublicSurface()
    const runtimeAssets = await readFile('packages/content/src/module/runtime-assets.ts', 'utf8')
    const clientSource = await readFile('packages/content/src/public/client.ts', 'utf8')

    expect(publicSurface.clientValueExports).not.toHaveProperty('useContentLocaleSwitch')
    expect(publicSurface.runtimeAppAutoImports).not.toHaveProperty('useContentLocaleSwitch')
    expect(runtimeAssets).not.toContain('useContentLocaleSwitch')
    expect(clientSource).not.toContain('useContentLocaleSwitch')
    expect(publicSurface.runtimeAppAutoImports.useContentSwitchLocalePath.category).toBe('compatibility-app-composable')
  })

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
