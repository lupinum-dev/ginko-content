import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, test, vi } from 'vitest'
import { registerContentNitroConfig } from '../../packages/content/src/module/nitro-config'

// Covers the Phase 3 gate follow-up: provider content-route prerender
// injection depends on Nitro's own `crawlLinks` mechanism (see the long
// comment in `module/nitro-config.ts` and `module/integration-hooks.ts`).
// When a user has explicitly disabled `nitro.prerender.crawlLinks` in their
// own nuxt.config, forcing it back on would silently override their choice;
// silently leaving it off would silently break content prerendering. This
// asserts the module does neither silently: it respects the explicit
// setting and warns loudly instead.

function createNuxt() {
  const hooks = new Map<string, (...arguments_: any[]) => any>()
  const nuxt = {
    options: {
      dev: false,
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
  platform: NodeJS.Platform = process.platform
) {
  const { nuxt, hooks } = createNuxt()
  const logger = { warn: vi.fn() }

  registerContentNitroConfig({
    nuxt: nuxt as any,
    options: { api: { baseURL: '/api/_content' } } as any,
    appContentConfig: {} as any,
    contentContext: { provider, sources: {}, sitemap: false, cache: false } as any,
    runtimeInlineDependencies: [],
    buildIntegrity: 123,
    resolvedI18n: { locales: [], defaultLocale: undefined },
    resolveRuntimeModule: (path: string) => `/resolved/runtime/${path}`,
    resolveModuleFile: (path: string) => `/resolved/module/${path}`,
    getResolvedContentContext: () => ({ sitemap: false, provider }) as any,
    getSearchRuntime: () => false,
    logger,
    platform
  })

  const nitroConfig: Record<string, any> = {
    prerender: { routes: [], ...prerenderOverrides }
  }
  hooks.get('nitro:config')?.(nitroConfig)

  return { nitroConfig, logger, hooks, nuxt }
}

describe('nitro-config crawlLinks handling', () => {
  test('defaults crawlLinks to true and warns nothing when the user left it unset', () => {
    const { nitroConfig, logger } = createHarness()

    expect(nitroConfig.prerender.crawlLinks).toBe(true)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  test('respects an explicit crawlLinks: false and warns that content routes will not be prerendered', () => {
    const { nitroConfig, logger } = createHarness({ crawlLinks: false })

    expect(nitroConfig.prerender.crawlLinks).toBe(false)
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn.mock.calls[0][0]).toMatch(/crawlLinks/)
    expect(logger.warn.mock.calls[0][0]).toMatch(/NOT be prerendered/)
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

  test('bundles Nuxt\'s Windows file URL cache driver through a virtual module', () => {
    const { nitroConfig } = createHarness({}, 'filesystem', 'win32')
    const plugin = nitroConfig.rollupConfig.plugins.find(
      (item: { name?: string }) => item.name === 'ginko:nuxt-windows-cache-driver'
    )
    const root = mkdtempSync(join(tmpdir(), 'ginko-cache-driver-'))
    const driver = join(root, 'node_modules/@nuxt/nitro-server/dist/runtime/utils/cache-driver.js')
    mkdirSync(join(driver, '..'), { recursive: true })
    writeFileSync(driver, 'export default "cache driver"')

    try {
      const id = plugin.resolveId(pathToFileURL(driver).href)
      expect(id).toMatch(/^\0ginko:nuxt-windows-cache-driver:/)
      expect(plugin.load(id)).toBe('export default "cache driver"')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('does not install the Nuxt cache-driver resolver outside Windows', () => {
    const { nitroConfig } = createHarness({}, 'filesystem', 'linux')

    expect(nitroConfig.rollupConfig).toBeUndefined()
  })

})
