import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, test } from 'vitest'

const execFileAsync = promisify(execFile)

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
  test('server facade no longer re-exports agent or provider types', async () => {
    const source = await readFile('packages/content/src/public/server.ts', 'utf8')

    // Agent surface has a single home (`./agent`).
    expect(source).not.toContain('AgentMarkdown')
    expect(source).not.toContain('agent-markdown.js')
    // Provider types have a single home (`./provider`).
    expect(extractTypeExports(source)).not.toContain('ContentProvider')
    expect(extractTypeExports(source)).not.toContain('ContentProviderQuery')
  })

  test('root entry no longer wildcard-exports the internal type graph', async () => {
    const source = await readFile('packages/content/src/module.ts', 'utf8')

    expect(source).not.toMatch(/export\s+type\s*\*/)
  })

  test('premature locale-switch helpers are not part of the public surface', async () => {
    const runtimeAssets = await readFile('packages/content/src/module/runtime-assets.ts', 'utf8')
    const clientSource = await readFile('packages/content/src/public/client.ts', 'utf8')

    // `useContentLocaleSwitch` never shipped; `useContentSwitchLocalePath` is
    // a hard-cut deletion — locale switching now reads
    // `page.route.alternates` directly.
    for (const removed of ['useContentLocaleSwitch', 'useContentSwitchLocalePath']) {
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
    expect(server.findFirstNavigationPage).toBeTypeOf('function')
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
    expect(client.findFirstNavigationPage).toBeTypeOf('function')
    expect(client.getCollectionPath).toBeTypeOf('function')
    // The public composable surface is exactly `useContentPage` and
    // `useContentSearch` — every other wrapper is a
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

  test('built navigation export loads as runtime-free Node ESM', async () => {
    const navigation = await import('@lupinum/ginko-content/navigation')

    expect(Object.keys(navigation).sort()).toEqual([
      'findFirstNavigationChild',
      'findFirstNavigationPage',
      'findNavigationTrail',
      'navigationItemContainsPath',
      'normalizeNavigationPath',
      'walkNavigationTree'
    ])
    expect(navigation.normalizeNavigationPath('/docs/')).toBe('/docs')
  })

  test('new traversal helpers live only on the pure navigation subpath', async () => {
    const [client, server] = await Promise.all([
      import('../../packages/content/dist/public/client.js'),
      import('../../packages/content/dist/public/server.js')
    ])

    for (const facade of [client, server]) {
      expect(facade.findFirstNavigationPage).toBeTypeOf('function')
      expect(facade).not.toHaveProperty('findFirstNavigationChild')
      expect(facade).not.toHaveProperty('normalizeNavigationPath')
      expect(facade).not.toHaveProperty('navigationItemContainsPath')
      expect(facade).not.toHaveProperty('findNavigationTrail')
      expect(facade).not.toHaveProperty('walkNavigationTree')
    }
  })

  test('navigation subpath types resolve in bundler and node16 consumers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ginko-navigation-types-'))
    try {
      await mkdir(join(root, 'node_modules/@lupinum'), { recursive: true })
      await symlink(join(process.cwd(), 'packages/content'), join(root, 'node_modules/@lupinum/ginko-content'), 'junction')
      await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8')
      await writeFile(join(root, 'index.ts'), `
        import { findFirstNavigationPage, normalizeNavigationPath } from '@lupinum/ginko-content/navigation'
        import type { ContentNavigationTreeItem, NavigationSidebar } from '@lupinum/ginko-content/navigation'
        type Item = { title: string; path?: string; children: Item[] }
        const items: Item[] = [{ title: 'Docs', children: [{ title: 'Intro', path: '/docs/intro', children: [] }] }]
        const page = findFirstNavigationPage(items)
        const path: string | undefined = page?.path
        const projected: ContentNavigationTreeItem = { title: 'Docs', sidebar: 'section' }
        const sidebar: NavigationSidebar | undefined = projected.sidebar
        normalizeNavigationPath(path ?? '/')
        void sidebar
      `, 'utf8')

      for (const [module, moduleResolution] of [['ESNext', 'Bundler'], ['Node16', 'Node16']]) {
        await writeFile(join(root, 'tsconfig.json'), JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module,
            moduleResolution,
            strict: true,
            noEmit: true,
            skipLibCheck: true
          },
          files: ['index.ts']
        }), 'utf8')
        await execFileAsync('pnpm', ['exec', 'tsc', '-p', root], { cwd: process.cwd() })
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 15_000)

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

  test('keeps the agent registry subpath explicit', async () => {
    const registry = await import('../../packages/content/dist/public/agent-registry.js')

    expect(Object.keys(registry).sort()).toEqual([
      'blockquoteMarkdown',
      'clearAgentMarkdownSerializers',
      'createAgentMarkdownRegistry',
      'defineAgentMarkdownComponent',
      'getAgentMarkdownRegistry',
      'getMarkdownProp',
      'jsonFenceMarkdown',
      'linkMarkdown',
      'registerAgentMarkdownComponent',
      'registerAgentMarkdownComponents',
      'registerAgentMarkdownSerializer',
      'registerAgentMarkdownSerializers',
      'renderMarkdownChildren',
      'xmlComponentMarkdown'
    ])
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
    expect(provider.isContentProviderOperatorCapabilities).toBeUndefined()
    expect(provider.isContentProviderPaginationCapabilities).toBeUndefined()
    expect(provider.isContentProviderQueryCapabilities).toBeUndefined()
    expect(provider.defineContentProvider).toBeUndefined()
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

  test('published runtime floors match the supported Nuxt dependency graph', async () => {
    const [manifest, workspaceManifest] = await Promise.all([
      readFile('packages/content/package.json', 'utf8').then(JSON.parse),
      readFile('package.json', 'utf8').then(JSON.parse)
    ]) as [{
      engines?: { node?: string }
      peerDependencies?: Record<string, string>
    }, { engines?: { node?: string } }]

    expect(manifest.engines?.node).toBeTypeOf('string')
    expect(workspaceManifest.engines?.node).toBe(manifest.engines?.node)
    expect(manifest.peerDependencies?.nuxt).toMatch(/^>=\d+\.\d+\.\d+ <5$/)
    expect(manifest.peerDependencies?.vue).toMatch(/^\^\d+\.\d+\.\d+$/)
  })

  test('superseded CMS import mapping is absent from the package', async () => {
    const manifest = JSON.parse(await readFile('packages/content/package.json', 'utf8')) as {
      exports: Record<string, unknown>
    }

    expect(manifest.exports).not.toHaveProperty('./cms-import')
    await expect(access('packages/content/dist/cms-import')).rejects.toThrow()
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
