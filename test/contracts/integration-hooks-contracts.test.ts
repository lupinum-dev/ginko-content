import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { registerContentNitroIntegrationHooks } from '../../packages/content/src/module/integration-hooks'

// These contracts cover the Nuxt Sitemap prerender routes and the compiled
// server count fetch owned by `registerContentNitroIntegrationHooks`. Static
// route discovery itself is exercised by the real generate/build e2e lanes.
// Multiple compiled handlers are registered as one serial function because
// Nitro interprets an array as a nested hook namespace, not a handler list.
const runCompiledHooks = async (nitroConfig: Record<string, any>, payload: unknown) => {
  await nitroConfig.hooks?.compiled?.(payload)
}

describe('integration hook contracts', () => {
  const tempDirs: string[] = []

  // `fetchSitemapCollectionCounts` spawns `output.serverDir`'s entry as a
  // real process and fetches it over HTTP (no generic compiled Nitro preset
  // exposes an in-process `localFetch`-style hook to call itself directly —
  // see the doc comment on that function). `respond` receives the request
  // path and returns `{ status, body }` for a fake cache/build route.
  const writeCompiledServer = async (respond: string) => {
    const serverDir = await mkdtemp(join(tmpdir(), 'content-integration-hooks-server-'))
    tempDirs.push(serverDir)
    await writeFile(join(serverDir, 'index.mjs'), [
      'import { createServer } from \'node:http\'',
      `const respond = ${respond}`,
      'createServer((req, res) => {',
      '  const { status, body } = respond(req.url)',
      '  res.writeHead(status, { \'content-type\': \'application/json\' })',
      '  res.end(JSON.stringify(body))',
      '}).listen(Number(process.env.PORT), process.env.HOST)'
    ].join('\n'), 'utf8')
    return serverDir
  }

  const writeSitemapOutput = async () => {
    const publicDir = await mkdtemp(join(tmpdir(), 'content-integration-hooks-public-'))
    tempDirs.push(publicDir)
    await mkdir(join(publicDir, '__sitemap__'), { recursive: true })
    await writeFile(
      join(publicDir, '__sitemap__/en-US.xml'),
      '<urlset><url><loc>http://localhost/guide/getting-started</loc></url></urlset>',
      'utf8'
    )
    return publicDir
  }

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  test('prerender:routes only adds Nuxt Sitemap\'s own routes -- it no longer touches content routes at all', async () => {
    const nitroConfig: Record<string, any> = {}
    registerContentNitroIntegrationHooks(nitroConfig, {
      cacheRoute: '/api/_content/cache.123.json',
      sitemapPrerenderRoutes: ['/sitemap.xml', '/sitemap_index.xml', '/__sitemap__/en-US.xml']
    }, {
      sitemap: false,
      provider: 'filesystem'
    })

    const routes = new Set<string>(['/already-queued'])
    await nitroConfig.hooks['prerender:routes'](routes)

    expect([...routes].sort()).toEqual([
      '/__sitemap__/en-US.xml',
      '/already-queued',
      '/sitemap.xml',
      '/sitemap_index.xml'
    ])
  })

  test('prerender:routes re-resolves a function-valued sitemapPrerenderRoutes on every call', async () => {
    const nitroConfig: Record<string, any> = {}
    let sitemapPrerenderRoutes = ['/sitemap.xml']
    registerContentNitroIntegrationHooks(nitroConfig, {
      cacheRoute: '/api/_content/cache.123.json',
      sitemapPrerenderRoutes: () => sitemapPrerenderRoutes
    }, {
      sitemap: false,
      provider: 'cms'
    })

    sitemapPrerenderRoutes = ['/sitemap.xml', '/sitemap_index.xml']
    const routes = new Set<string>()
    await nitroConfig.hooks['prerender:routes'](routes)

    expect([...routes].sort()).toEqual(['/sitemap.xml', '/sitemap_index.xml'])
  })

  test('the cache/build-route cleanup deletes the stale static crawl-seed artifact from the shared publicDir', async () => {
    const publicDir = await mkdtemp(join(tmpdir(), 'content-integration-hooks-cleanup-'))
    tempDirs.push(publicDir)
    const cacheRoute = '/api/_content/cache.123.json'
    const artifactDir = join(publicDir, 'api/_content/cache.123.json')
    await mkdir(artifactDir, { recursive: true })
    await writeFile(join(artifactDir, 'index.html'), '<!doctype html><html></html>', 'utf8')

    const nitroConfig: Record<string, any> = {}
    registerContentNitroIntegrationHooks(nitroConfig, {
      cacheRoute
    }, {
      sitemap: false,
      provider: 'filesystem'
    })

    await nitroConfig.hooks['prerender:init']({ options: { output: { publicDir, serverDir: '/does/not/exist' }, static: false } })
    await nitroConfig.hooks['prerender:done']({ prerenderedRoutes: [], failedRoutes: [] })

    await expect(readFile(join(artifactDir, 'index.html'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('the cache/build-route cleanup hooks are registered on "prerender:init"/"prerender:done" when sitemap assertion is disabled', async () => {
    const nitroConfig: Record<string, any> = {}
    registerContentNitroIntegrationHooks(nitroConfig, {
      cacheRoute: '/api/_content/cache.123.json'
    }, {
      sitemap: false,
      provider: 'filesystem'
    })

    // No sitemap-assert "compiled" handler is added, but the unconditional
    // stale-artifact cleanup always is for a filesystem-provider build -- on
    // "prerender:init"/"prerender:done" rather than "compiled" (see the long
    // comment in `integration-hooks.ts`'s registration block for why:
    // "compiled" fires too late to matter). Both resolve safely even when
    // nothing was ever written to `publicDir`.
    expect(nitroConfig.hooks?.compiled).toBeUndefined()
    expect(typeof nitroConfig.hooks?.['prerender:init']).toBe('function')
    expect(typeof nitroConfig.hooks?.['prerender:done']).toBe('function')
    await nitroConfig.hooks['prerender:init']({ options: { output: { publicDir: '/does/not/exist', serverDir: '/does/not/exist' }, static: false } })
    await expect(nitroConfig.hooks['prerender:done']({ prerenderedRoutes: [], failedRoutes: [] })).resolves.toBeUndefined()
  })

  test('no cleanup hooks at all are registered for a non-filesystem provider with sitemap assertion disabled', async () => {
    const nitroConfig: Record<string, any> = {}
    registerContentNitroIntegrationHooks(nitroConfig, {
      cacheRoute: '/api/_content/cache.123.json'
    }, {
      sitemap: false,
      provider: 'cms'
    })

    expect(nitroConfig.hooks?.compiled).toBeUndefined()
    expect(nitroConfig.hooks?.['prerender:init']).toBeUndefined()
    expect(nitroConfig.hooks?.['prerender:done']).toBeUndefined()
  })

  test('the "compiled" hook is a no-op for static-like builds without touching the filesystem', async () => {
    const nitroConfig: Record<string, any> = {}
    registerContentNitroIntegrationHooks(nitroConfig, {
      cacheRoute: '/api/_content/cache.123.json'
    }, {
      provider: 'filesystem',
      sitemap: {
        assert: {
          enabled: true,
          mode: 'both',
          allowEmpty: false,
          minUrlsPerSitemap: 1,
          requireImages: false,
          requiredCollections: [],
          requiredPaths: [],
          forbiddenPathPrefixes: [],
          sitemaps: {}
        }
      } as any
    })

    // `output.serverDir` deliberately points at a directory that does not
    // exist -- if the static-like check did not short-circuit first, this
    // would throw trying to spawn it.
    await expect(runCompiledHooks(nitroConfig, {
      options: { output: { publicDir: '/does/not/exist', serverDir: '/does/not/exist' }, static: true },
      logger: { info: () => {} }
    })).resolves.toBeUndefined()
  })

  test('the "compiled" hook fetches sitemap collection counts from the compiled server bundle and asserts against them', async () => {
    const serverDir = await writeCompiledServer(
      '() => ({ status: 200, body: { sitemapByCollection: { docs: 1 } } })'
    )
    const publicDir = await writeSitemapOutput()

    const nitroConfig: Record<string, any> = {}
    registerContentNitroIntegrationHooks(nitroConfig, {
      cacheRoute: '/api/_content/cache.123.json'
    }, {
      provider: 'filesystem',
      sitemap: {
        assert: {
          enabled: true,
          mode: 'build',
          allowEmpty: false,
          minUrlsPerSitemap: 1,
          requireImages: false,
          requiredCollections: ['docs'],
          requiredPaths: [],
          forbiddenPathPrefixes: [],
          sitemaps: {}
        }
      } as any
    })

    await expect(runCompiledHooks(nitroConfig, {
      options: { output: { publicDir, serverDir }, static: false },
      logger: { info: () => {} }
    })).resolves.toBeUndefined()
  })

  test('the "compiled" hook fails loudly when the compiled cache/build route response is not ok', async () => {
    const serverDir = await writeCompiledServer(
      '() => ({ status: 500, body: { error: \'boom\' } })'
    )

    const nitroConfig: Record<string, any> = {}
    registerContentNitroIntegrationHooks(nitroConfig, {
      cacheRoute: '/api/_content/cache.123.json'
    }, {
      provider: 'filesystem',
      sitemap: {
        assert: {
          enabled: true,
          mode: 'build',
          allowEmpty: false,
          minUrlsPerSitemap: 1,
          requireImages: false,
          requiredCollections: [],
          requiredPaths: [],
          forbiddenPathPrefixes: [],
          sitemaps: {}
        }
      } as any
    })

    await expect(runCompiledHooks(nitroConfig, {
      options: { output: { publicDir: '/does/not/exist', serverDir }, static: false },
      logger: { info: () => {} }
    })).rejects.toThrow(/cache\/build route failed/)
  })

  test('external providers skip the compiled-bundle fetch and assert with empty collection counts', async () => {
    const publicDir = await writeSitemapOutput()

    const nitroConfig: Record<string, any> = {}
    registerContentNitroIntegrationHooks(nitroConfig, {
      // Deliberately unresolvable -- an external provider must never reach this.
      cacheRoute: '/api/_content/cache.123.json'
    }, {
      provider: 'cms',
      sitemap: {
        assert: {
          enabled: true,
          mode: 'build',
          allowEmpty: false,
          minUrlsPerSitemap: 1,
          requireImages: false,
          requiredCollections: [],
          requiredPaths: [],
          forbiddenPathPrefixes: [],
          sitemaps: {}
        }
      } as any
    })

    await expect(runCompiledHooks(nitroConfig, {
      options: { output: { publicDir, serverDir: '/does/not/exist' }, static: false },
      logger: { info: () => {} }
    })).resolves.toBeUndefined()
  })
})
