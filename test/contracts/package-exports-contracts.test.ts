import { readdir, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { describe, expect, test } from 'vitest'

type PublicSurface = {
  packageExportSubpaths: Record<string, PublicSurfaceEntry>
  clientValueExports: Record<string, PublicSurfaceEntry>
  clientTypeExports: Record<string, PublicSurfaceEntry>
  serverValueExports: Record<string, PublicSurfaceEntry>
  serverTypeExports: Record<string, PublicSurfaceEntry>
  providerValueExports: Record<string, PublicSurfaceEntry>
  providerTypeExports: Record<string, PublicSurfaceEntry>
  providerContractValueExports: Record<string, PublicSurfaceEntry>
  providerContractTypeExports: Record<string, PublicSurfaceEntry>
  agentValueExports: Record<string, PublicSurfaceEntry>
  agentTypeExports: Record<string, PublicSurfaceEntry>
  rootValueExports: Record<string, PublicSurfaceEntry>
  rootTypeExports: Record<string, PublicSurfaceEntry>
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

const collectJavaScriptFiles = async (root: string): Promise<string[]> => {
  const entries = await readdir(root, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async entry => {
      const path = join(root, entry.name)
      if (entry.isDirectory()) return collectJavaScriptFiles(path)
      return entry.name.endsWith('.js') || entry.name.endsWith('.mjs') ? [path] : []
    })
  )
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

  for (const match of source.matchAll(/export\s+interface\s+([A-Za-z0-9_]+)/g)) {
    names.add(match[1]!)
  }

  for (const match of source.matchAll(/export\s+type\s+([A-Za-z0-9_]+)\s*[=<{]/g)) {
    names.add(match[1]!)
  }

  return [...names].sort()
}

describe('package export contracts', () => {
  test('source agent facade value exports stay intentionally curated', async () => {
    const publicSurface = await readPublicSurface()
    const source = await readFile('packages/content/src/public/agent.ts', 'utf8')

    expect(extractValueExports(source)).toEqual(Object.keys(publicSurface.agentValueExports).sort())
  })

  test('source agent facade type exports stay intentionally curated', async () => {
    const publicSurface = await readPublicSurface()
    const source = await readFile('packages/content/src/public/agent.ts', 'utf8')

    expect(extractTypeExports(source)).toEqual(Object.keys(publicSurface.agentTypeExports).sort())
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

  test('server facade no longer re-exports agent or provider types', async () => {
    const source = await readFile('packages/content/src/public/server.ts', 'utf8')

    // Agent surface has a single home (`./agent`).
    expect(source).not.toContain('AgentMarkdown')
    expect(source).not.toContain('agent-markdown.js')
    // Provider types have a single home (`./provider`).
    expect(extractTypeExports(source)).not.toContain('ContentProvider')
    expect(extractTypeExports(source)).not.toContain('ContentProviderQuery')
  })

  test('source provider facade value exports stay intentionally curated', async () => {
    const publicSurface = await readPublicSurface()
    const source = await readFile('packages/content/src/public/provider.ts', 'utf8')

    expect(extractValueExports(source)).toEqual(Object.keys(publicSurface.providerValueExports).sort())
  })

  test('source provider facade type exports stay intentionally curated', async () => {
    const publicSurface = await readPublicSurface()
    const source = await readFile('packages/content/src/public/provider.ts', 'utf8')

    expect(extractTypeExports(source)).toEqual(Object.keys(publicSurface.providerTypeExports).sort())
  })

  test('source provider contract value exports stay intentionally curated', async () => {
    const publicSurface = await readPublicSurface()
    const source = await readFile('packages/content/src/testing/provider-contract.ts', 'utf8')

    expect(extractValueExports(source)).toEqual(Object.keys(publicSurface.providerContractValueExports).sort())
  })

  test('source provider contract type exports stay intentionally curated', async () => {
    const publicSurface = await readPublicSurface()
    const source = await readFile('packages/content/src/testing/provider-contract.ts', 'utf8')

    expect(extractTypeExports(source)).toEqual(Object.keys(publicSurface.providerContractTypeExports).sort())
  })

  test('source root entry value exports stay intentionally curated', async () => {
    const publicSurface = await readPublicSurface()
    const source = await readFile('packages/content/src/module.ts', 'utf8')

    expect(extractValueExports(source)).toEqual(Object.keys(publicSurface.rootValueExports).sort())
  })

  test('source root entry type exports stay intentionally curated', async () => {
    const publicSurface = await readPublicSurface()
    const source = await readFile('packages/content/src/module.ts', 'utf8')

    expect(extractTypeExports(source)).toEqual(Object.keys(publicSurface.rootTypeExports).sort())
  })

  test('root entry no longer wildcard-exports the internal type graph', async () => {
    const source = await readFile('packages/content/src/module.ts', 'utf8')

    expect(source).not.toMatch(/export\s+type\s*\*/)
  })

  test('package export subpaths stay classified in the public surface manifest', async () => {
    const publicSurface = await readPublicSurface()
    const manifest = JSON.parse(await readFile('packages/content/package.json', 'utf8')) as {
      exports: Record<string, unknown>
    }

    expect(Object.keys(manifest.exports).sort()).toEqual(Object.keys(publicSurface.packageExportSubpaths).sort())
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
      'advanced-agent-subpath',
      'advanced-cms-contract',
      'advanced-cms-import',
      'pure-provider-contract',
      'pure-portability-contract',
      'testing-only-provider-fixture',
      'testing-only-provider-contract',
      'testing-only-data-source-contract',
      'testing-only-portability-contract',
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
      ...Object.values(publicSurface.providerValueExports),
      ...Object.values(publicSurface.providerTypeExports),
      ...Object.values(publicSurface.providerContractValueExports),
      ...Object.values(publicSurface.providerContractTypeExports),
      ...Object.values(publicSurface.agentValueExports),
      ...Object.values(publicSurface.agentTypeExports),
      ...Object.values(publicSurface.rootValueExports),
      ...Object.values(publicSurface.rootTypeExports),
      ...Object.values(publicSurface.runtimeAppAutoImports)
    ]

    for (const entry of entries) {
      expect([...knownCategories], entry.category).toContain(entry.category)
      expect(entry.audience).toMatch(/^[a-z][a-z-]+$/)
      expect(entry.docs).toMatch(/^(docs|packages|meta)\//)
      await expect(readFile(entry.docs, 'utf8'), entry.docs).resolves.toBeTypeOf('string')
    }
  })

  test('premature locale-switch helpers are not part of the public surface', async () => {
    const publicSurface = await readPublicSurface()
    const runtimeAssets = await readFile('packages/content/src/module/runtime-assets.ts', 'utf8')
    const clientSource = await readFile('packages/content/src/public/client.ts', 'utf8')

    // `useContentLocaleSwitch` never shipped; `useContentSwitchLocalePath` is
    // a hard-cut deletion (VNEXT.md 10.4, 10.6) — locale switching now reads
    // `page.route.alternates` directly (VNEXT.md 27.4).
    for (const removed of ['useContentLocaleSwitch', 'useContentSwitchLocalePath']) {
      expect(publicSurface.clientValueExports).not.toHaveProperty(removed)
      expect(publicSurface.runtimeAppAutoImports).not.toHaveProperty(removed)
      expect(runtimeAssets).not.toContain(removed)
      expect(clientSource).not.toContain(removed)
    }
  })

  test('built root export loads as Node ESM', async () => {
    const module = await import('@lupinum/ginko-content')

    expect(module.default).toBeTypeOf('function')
    expect(module.defineContentConfig).toBeTypeOf('function')
    expect(module).not.toHaveProperty('agentMetadataFields')
    expect(module).not.toHaveProperty('defineAgentAppPage')
  })

  test('built server export loads as Node ESM', async () => {
    const server = await import('../../packages/content/dist/public/server.js')

    // Unified query API (ADR-0016).
    expect(server.one).toBeTypeOf('function')
    expect(server.many).toBeTypeOf('function')
    expect(server.paginate).toBeTypeOf('function')
    expect(server.backlinks).toBeTypeOf('function')
    expect(server.resolveOne).toBeTypeOf('function')
    expect(server.surround).toBeTypeOf('function')
    expect(server.navigation).toBeTypeOf('function')
    expect(server.getCollectionPath).toBeTypeOf('function')
    // Auxiliary / sitemap helpers preserved across the redesign.
    expect(server.queryCollectionsSitemapEntries).toBeTypeOf('function')
    expect(server).not.toHaveProperty('createContentProviderError')
    expect(server).not.toHaveProperty('withContentCache')
    expect(server).not.toHaveProperty('vercelContentCache')
    expect(server).not.toHaveProperty('createServerContentQueryContext')
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
    expect(client.surround).toBeTypeOf('function')
    expect(client.navigation).toBeTypeOf('function')
    expect(client.getCollectionPath).toBeTypeOf('function')
    // The public composable surface is exactly `useContentPage` and
    // `useContentSearch` (VNEXT.md 10.5, 10.8) — every other wrapper is a
    // hard-cut deletion, replaced by these pure operations + useAsyncData.
    expect(client.useContentPage).toBeTypeOf('function')
    expect(client.useContentSearch).toBeTypeOf('function')
    expect(client).not.toHaveProperty('queryCollection')
    expect(client).not.toHaveProperty('useContentList')
    expect(client).not.toHaveProperty('useContentHead')
    expect(client).not.toHaveProperty('useContentOne')
    expect(client).not.toHaveProperty('useContentMany')
    expect(client).not.toHaveProperty('useContentPagination')
    expect(client).not.toHaveProperty('useContentBacklinks')
    expect(client).not.toHaveProperty('useContentResolveOne')
    expect(client).not.toHaveProperty('useContentVariants')
    expect(client).not.toHaveProperty('useContentTree')
    expect(client).not.toHaveProperty('useContentNavigation')
    expect(client).not.toHaveProperty('useContentNeighbors')
    expect(client).not.toHaveProperty('useContentToc')
    expect(client).not.toHaveProperty('useContentSwitchLocalePath')
    expect(client).not.toHaveProperty('useContentSearchData')
    expect(client).not.toHaveProperty('useContentSearchResults')
    expect(client).not.toHaveProperty('useContentPreview')
  })

  test('built agent export loads as Node ESM', async () => {
    const agent = await import('../../packages/content/dist/public/agent.js')

    // LLM markdown output surface now lives on its own subpath.
    expect(agent.registerAgentMarkdownSerializer).toBeTypeOf('function')
    expect(agent.createAgentMarkdownRegistry).toBeTypeOf('function')
    expect(agent.defineAgentMarkdownComponent).toBeTypeOf('function')
    expect(agent.renderLlmsTxt).toBeTypeOf('function')
    expect(agent.agentMarkdownPathForRoute('/docs/intro')).toBe('/docs/intro/index.md')
    expect(agent.agentRawPathForRoute('/docs/intro')).toBe('/raw/docs/intro.md')
    expect(agent.normalizeAgentRoutePath('/docs/intro/')).toBe('/docs/intro')
    expect(agent).not.toHaveProperty('resolveContentMarkdown')
    expect(agent).not.toHaveProperty('buildAgentPageIndex')
  })

  test('ships browser-safe agent paths on an explicit matching subpath', async () => {
    const manifest = JSON.parse(await readFile('packages/content/package.json', 'utf8')) as {
      exports: Record<string, Record<string, string>>
    }
    expect(manifest.exports['./agent']).not.toHaveProperty('browser')
    expect(manifest.exports['./agent-paths']).toEqual({
      types: './dist/public/agent-paths.d.ts',
      import: './dist/public/agent-paths.js',
      default: './dist/public/agent-paths.js'
    })

    const browserAgent = await readFile('packages/content/dist/public/agent-paths.js', 'utf8')
    expect(browserAgent).toContain('agentRawPathForRoute')
    expect(browserAgent).not.toContain('runtime/server')
    expect(browserAgent).not.toContain('nitropack/runtime')
  })

  test('built config export keeps one field-builder vocabulary', async () => {
    const config = await import('../../packages/content/dist/config.mjs')

    expect(config.fields.richtext).toBeTypeOf('function')
    expect(config.fields.select).toBeTypeOf('function')
    expect(config.fields.boolean).toBeTypeOf('function')
    expect(config.fields).not.toHaveProperty('markdown')
    expect(config.fields).not.toHaveProperty('enum')
    expect(config.fields).not.toHaveProperty('toggle')
    for (const alias of ['image', 'asset', 'file', 'relation', 'relations', 'richtext', 'text']) {
      expect(config).not.toHaveProperty(alias)
    }
  })

  test('built provider export loads as Node ESM', async () => {
    const provider = await import('../../packages/content/dist/public/provider.js')

    expect(provider.toContentProviderQuery).toBeTypeOf('function')
    expect(provider.withContentCache).toBeTypeOf('function')
    expect(provider.isContentProviderResult).toBeTypeOf('function')
    expect(provider.normalizeProviderDocument).toBeTypeOf('function')
    expect(provider.shapeProviderDocument).toBeUndefined()
  })

  test('published JavaScript uses Node-resolvable relative specifiers', async () => {
    const files = await collectJavaScriptFiles('packages/content/dist')
    const unresolved: string[] = []
    const relativeSpecifier = /(?:from\s*|import\s*\()(['"])(\.\.?\/[^'"]+)\1/g

    for (const file of files) {
      const source = await readFile(file, 'utf8')
      for (const match of source.matchAll(relativeSpecifier)) {
        if (!extname(match[2])) unresolved.push(`${file}: ${match[2]}`)
      }
    }

    expect(unresolved).toEqual([])
  })

  test('built provider fixture export loads as Node ESM', async () => {
    const fixtureModule = await import('@lupinum/ginko-content/testing/provider-fixture')

    expect(fixtureModule.createProviderFixture).toBeTypeOf('function')
    expect(fixtureModule.createFixtureContentProvider).toBeTypeOf('function')
    expect(fixtureModule.createProviderFixtureEvent).toBeTypeOf('function')
    expect(fixtureModule.createDefaultProviderFixture).toBeTypeOf('function')
    expect(fixtureModule.createAuthorDependencyProviderFixture).toBeTypeOf('function')
  })

  test('built provider contract export loads as Node ESM', async () => {
    const contractModule = await import('@lupinum/ginko-content/testing/provider-contract')

    expect(contractModule.expectProviderCapabilities).toBeTypeOf('function')
    expect(contractModule.runProviderContractSuite).toBeTypeOf('function')
    expect(contractModule.unwrapProviderContractResult).toBeTypeOf('function')
  })

  test('testing provider contract keeps vitest optional for package consumers', async () => {
    const manifest = JSON.parse(await readFile('packages/content/package.json', 'utf8')) as {
      peerDependencies?: Record<string, string>
      peerDependenciesMeta?: Record<string, { optional?: boolean }>
    }

    expect(manifest.peerDependencies?.vitest).toBeTypeOf('string')
    expect(manifest.peerDependenciesMeta?.vitest?.optional).toBe(true)
  })

  test('built CMS import export loads as Node ESM', async () => {
    const cmsImport = await import('@lupinum/ginko-content/cms-import')

    expect(cmsImport.parseCmsImportFile).toBeTypeOf('function')
    expect(cmsImport.buildCmsImportGraph).toBeTypeOf('function')
  })

  test('public export files keep Node ESM relative specifiers explicit', async () => {
    const [client, server, provider, agent] = await Promise.all([
      readFile('packages/content/dist/public/client.js', 'utf8'),
      readFile('packages/content/dist/public/server.js', 'utf8'),
      readFile('packages/content/dist/public/provider.js', 'utf8'),
      readFile('packages/content/dist/public/agent.js', 'utf8')
    ])

    expect(client).not.toMatch(/from ['"]\.\.\/runtime\/[^'"]*(?<!\.js)['"]/)
    expect(server).not.toMatch(/from ['"]\.\.\/runtime\/[^'"]*(?<!\.js)['"]/)
    expect(provider).not.toMatch(/from ['"]\.\.\/runtime\/[^'"]*(?<!\.js)['"]/)
    expect(agent).not.toMatch(/from ['"]\.\.\/runtime\/[^'"]*(?<!\.js)['"]/)
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
