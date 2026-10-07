import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { registerContentNitroConfig } from '../../packages/content/src/module/nitro-config'

// Content routes reach Nitro's prerender queue through the cache/build
// route's `x-nitro-prerender` header, which works with or without
// `crawlLinks`. The module still turns link crawling on by default for
// compatibility; `content.prerender` lets live-data sites opt out, and an
// explicit `nitro.prerender.crawlLinks` setting always wins.

function createNuxt(generate = false) {
  const hooks = new Map<string, (...arguments_: any[]) => any>()
  const nuxt = {
    options: {
      dev: false,
      _generate: generate,
      rootDir: '/workspace/app',
      srcDir: '/workspace/app',
      buildDir: '/workspace/.nuxt',
      ignore: [] as string[]
    },
    hook(name: string, fn: (...arguments_: any[]) => any) {
      hooks.set(name, fn)
    }
  }
  return { nuxt, hooks }
}

function createHarness(
  prerenderOverrides: Record<string, any> = {},
  provider = 'filesystem',
  agent = false,
  integrity: number | null = 123,
  generate = false,
  moduleOptions: Record<string, any> = {}
) {
  const { nuxt, hooks } = createNuxt(generate)
  const logger = { warn: vi.fn() }

  registerContentNitroConfig({
    nuxt: nuxt as any,
    options: {
      api: { baseURL: '/api/_content' },
      ...(agent ? { agent: { routes: true, delivery: 'runtime' } } : {}),
      ...moduleOptions
    } as any,
    appContentConfig: agent ? { agent: { site: {} } } as any : {} as any,
    contentContext: { provider, sources: {}, sitemap: false, cache: false } as any,
    buildIntegrity: integrity ?? undefined,
    resolvedI18n: { locales: [], defaultLocale: undefined },
    resolveRuntimeModule: (path: string) => `/resolved/runtime/${path}`,
    resolveModuleFile: (path: string) => `/resolved/module/${path}`,
    getResolvedContentContext: () => ({ sitemap: false, provider }) as any,
    getSearchRuntime: () => false,
    logger
  })

  const nitroConfig: Record<string, any> = {
    prerender: { routes: [], ...prerenderOverrides }
  }
  hooks.get('nitro:config')?.(nitroConfig)

  return { nitroConfig, logger, hooks, nuxt }
}

describe('nitro-config crawlLinks handling', () => {
  test('uses the same integrity-qualified cache route as the server handler', () => {
    const { nitroConfig } = createHarness()

    expect(nitroConfig.prerender.routes[0]).toBe('/api/_content/cache.123.json')
  })

  test('uses the stable cache route when build integrity is unavailable', () => {
    const { nitroConfig } = createHarness({}, 'filesystem', false, null)

    expect(nitroConfig.prerender.routes[0]).toBe('/api/_content/cache.json')
  })

  test('defaults crawlLinks to true and warns nothing when the user left it unset', () => {
    const { nitroConfig, logger } = createHarness()

    expect(nitroConfig.prerender.crawlLinks).toBe(true)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  test('respects an explicit crawlLinks: false without warning because content routes are seeded by header', () => {
    const { nitroConfig, logger } = createHarness({ crawlLinks: false })

    expect(nitroConfig.prerender.crawlLinks).toBe(false)
    expect(nitroConfig.prerender.routes).toEqual(['/api/_content/cache.123.json'])
    expect(logger.warn).not.toHaveBeenCalled()
  })

  test('prerender.crawlLinks: false leaves crawling off but still prerenders the cache/build route', () => {
    const { nitroConfig, logger } = createHarness({}, 'filesystem', false, 123, false, {
      prerender: { crawlLinks: false }
    })

    expect(nitroConfig.prerender.crawlLinks).toBeUndefined()
    expect(nitroConfig.prerender.routes).toEqual(['/api/_content/cache.123.json'])
    expect(logger.warn).not.toHaveBeenCalled()
  })

  test('prerender: false keeps the snapshot build route and does not force crawling', () => {
    const { nitroConfig } = createHarness({}, 'filesystem', false, 123, false, { prerender: false })

    expect(nitroConfig.prerender.crawlLinks).toBeUndefined()
    expect(nitroConfig.prerender.routes).toEqual(['/api/_content/cache.123.json'])
  })

  test('warns when runtime agent delivery loses the crawler it depends on', () => {
    const { logger } = createHarness({}, 'filesystem', true, 123, false, { prerender: { crawlLinks: false } })

    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn.mock.calls[0][0]).toMatch(/delivery `runtime`/)
  })

  test('does not warn when the user explicitly enabled crawlLinks', () => {
    const { nitroConfig, logger } = createHarness({ crawlLinks: true })

    expect(nitroConfig.prerender.crawlLinks).toBe(true)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  test('seeds the build endpoint for external providers so routes() can feed the crawler', () => {
    const { nitroConfig } = createHarness({}, 'cms-demo')

    expect(nitroConfig.prerender.routes).toEqual(['/api/_content/cache.123.json'])
    expect(nitroConfig.prerender.crawlLinks).toBe(true)
  })

  test('registers the agent recovery plugin only when agent routes exist', () => {
    expect(createHarness({}, 'filesystem', true).nitroConfig.plugins).toEqual([
      '/resolved/runtime/server/plugins/agent-errors.js'
    ])
    expect(createHarness().nitroConfig.plugins).toBeUndefined()
  })

  test('runtime delivery keeps crawling so page data dependencies are retained', () => {
    const { nitroConfig, logger } = createHarness({ crawlLinks: true }, 'filesystem', true)

    expect(nitroConfig.prerender.crawlLinks).toBe(true)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  test('runtime delivery removes server-build HTML but preserves static-generation HTML', async () => {
    for (const [generate, expectedToExist] of [[false, false], [true, true]] as const) {
      const publicDir = await mkdtemp(join(tmpdir(), 'content-agent-delivery-'))
      const artifactPath = join(publicDir, 'guide/index.html')
      try {
        await mkdir(join(publicDir, 'guide'), { recursive: true })
        await writeFile(artifactPath, '<!doctype html><html></html>', 'utf8')
        const { nitroConfig } = createHarness({}, 'filesystem', true, 123, generate)

        await nitroConfig.hooks['prerender:init']({ options: { output: { publicDir } } })
        await nitroConfig.hooks['prerender:done']({
          prerenderedRoutes: [{ contentType: 'text/html', fileName: '/guide/index.html' }]
        })

        const exists = await readFile(artifactPath, 'utf8').then(() => true, () => false)
        expect(exists).toBe(expectedToExist)
      }
      finally {
        await rm(publicDir, { recursive: true, force: true })
      }
    }
  })

})
