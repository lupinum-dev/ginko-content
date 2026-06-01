import { beforeEach, describe, expect, test, vi } from 'vitest'

const applyContentRuntimeConfig = vi.fn()
const registerContentServerHandlers = vi.fn()

function createNuxt() {
  const hooks = new Map<string, (...arguments_: any[]) => any>()
  const nuxt = {
    options: {
      dev: false,
      rootDir: '/workspace/app',
      srcDir: '/workspace/app',
      buildDir: '/workspace/.nuxt',
      build: {
        transpile: [] as Array<string | RegExp | ((ctx: { isClient?: boolean, isServer?: boolean }) => boolean)>
      },
      vite: {},
      experimental: {},
      ignore: [] as string[],
      modules: ['@nuxtjs/i18n', '@nuxtjs/sitemap'],
      i18n: {
        defaultLocale: 'en',
        locales: [{ code: 'en', language: 'en-US' }, { code: 'de', language: 'de-DE' }]
      },
      sitemap: {
        sources: [] as string[]
      }
    },
    hook(name: string, fn: (...arguments_: any[]) => any) {
      hooks.set(name, fn)
    },
    async callHook() {}
  }

  return { nuxt, hooks }
}

function createOptions(overrides: Record<string, any> = {}) {
  return {
    api: { baseURL: '/api/_content' },
    i18n: true,
    sitemap: true,
    watch: { ws: { port: { port: 4000, portRange: [4000, 4040] }, hostname: 'localhost', showURL: false } },
    sources: {},
    ignores: [],
    collections: {},
    markdown: { plugins: [], tags: {}, anchorLinks: { depth: 4, exclude: [1] } },
    yaml: {},
    csv: { delimiter: ',', json: true },
    navigation: { fields: [] },
    contentHead: true,
    respectPathCase: false,
    experimental: { stripQueryParameters: false },
    ...overrides
  }
}

describe('module contracts', () => {
  beforeEach(() => {
    vi.resetModules()
    applyContentRuntimeConfig.mockReset()
    registerContentServerHandlers.mockReset()

    vi.doMock('@nuxt/kit', () => ({
      createResolver: () => ({
        resolve: (...parts: string[]) => `/resolved/${parts.join('/')}`,
        resolvePath: vi.fn(async (value: string) => value)
      }),
      defineNuxtModule: (definition: any) => definition,
      addTemplate: vi.fn(),
      useLogger: vi.fn(() => ({
        info: vi.fn()
      }))
    }))
    vi.doMock('../../packages/content/src/utils/content-config', () => ({
      loadContentConfig: vi.fn(async () => ({
        collections: {
          docs: { source: '**/*.md' }
        }
      })),
      resolveContentConfigPath: vi.fn(() => '/workspace/app/content.config.ts')
    }))
    vi.doMock('../../packages/content/src/utils', () => ({
      processMarkdownOptions: vi.fn((value: any) => value),
      useContentMounts: vi.fn(() => ({}))
    }))
    vi.doMock('../../packages/content/src/module/virtual', () => ({
      createVirtualContentTemplates: vi.fn(() => ({
        transformersTemplate: {},
        virtualConfigTemplate: {}
      })),
      registerVirtualContentAliases: vi.fn()
    }))
    vi.doMock('../../packages/content/src/module/dev', () => ({
      registerContentDevRuntime: vi.fn(),
      registerContentBuildCache: vi.fn()
    }))
    vi.doMock('../../packages/content/src/module/runtime-assets', () => ({
      registerContentI18nTemplate: vi.fn(),
      registerGeneratedTypes: vi.fn(),
      registerRuntimeComponents: vi.fn(),
      registerRuntimeImports: vi.fn(),
      registerRuntimeStashPlugin: vi.fn(),
      registerUserContentComponents: vi.fn(async () => {}),
      registerContentI18nRuntimeImport: vi.fn(),
      registerDevRuntimePlugin: vi.fn()
    }))
    vi.doMock('../../packages/content/src/module/server-handlers', () => ({
      registerContentServerHandlers,
      registerContentSearchServerHandlers: vi.fn()
    }))
    vi.doMock('../../packages/content/src/module/runtime-config', () => ({
      applyContentRuntimeConfig
    }))
    vi.doMock('../../packages/content/src/module/content-components-template', () => ({
      registerContentComponentsTemplate: vi.fn()
    }))
    vi.doMock('../../packages/content/src/core/content/locale', () => ({
      resolveCollectionI18nConfig: vi.fn((collection: any) => collection.i18n)
    }))
  })

  test('registers the content sitemap Nitro plugin when sitemap integration is enabled', async () => {
    const { nuxt, hooks } = createNuxt()

    const mod = await import('../../packages/content/src/module')
    await mod.default.setup(createOptions(), nuxt as any)

    const nitroConfig: Record<string, any> = {}
    hooks.get('nitro:config')?.(nitroConfig)

    expect(nitroConfig.plugins).toContain('/resolved/./runtime/server/plugins/sitemap.js')
    expect(nuxt.options.sitemap.sources).toEqual([
      {
        context: {
          name: '@lupinum/ginko-content:urls'
        },
        fetch: '/api/_content/sitemap'
      }
    ])
    expect(nuxt.options.sitemap.excludeAppSources).toBe(true)
    expect(registerContentServerHandlers).toHaveBeenCalled()

    await hooks.get('modules:done')?.()

    expect(applyContentRuntimeConfig).toHaveBeenCalled()
  })

  test('requires a content config with at least one collection', async () => {
    const { nuxt } = createNuxt()

    vi.doMock('../../packages/content/src/utils/content-config', () => ({
      loadContentConfig: vi.fn(async () => ({})),
      resolveContentConfigPath: vi.fn(() => undefined)
    }))

    const mod = await import('../../packages/content/src/module')
    await expect(mod.default.setup(createOptions(), nuxt as any)).rejects.toThrow(
      '@lupinum/ginko-content requires a content.config.ts with at least one collection'
    )
  })

  test('preserves existing Nitro plugins when adding the content sitemap plugin', async () => {
    const { nuxt, hooks } = createNuxt()

    const mod = await import('../../packages/content/src/module')
    await mod.default.setup(createOptions(), nuxt as any)

    const nitroConfig: Record<string, any> = {
      plugins: ['/existing/plugin']
    }
    hooks.get('nitro:config')?.(nitroConfig)

    expect(nitroConfig.plugins).toEqual([
      '/existing/plugin',
      '/resolved/./runtime/server/plugins/sitemap.js'
    ])
  })

  test('bundles production parsed content with the same storage key runtime readers use', async () => {
    const { nuxt, hooks } = createNuxt()

    const mod = await import('../../packages/content/src/module')
    await mod.default.setup(createOptions(), nuxt as any)

    const nitroConfig: Record<string, any> = {}
    hooks.get('nitro:config')?.(nitroConfig)

    expect(nitroConfig.bundledStorage).toContain('cache:content')
    expect(nitroConfig.bundledStorage).not.toContain('/cache/content')
  })

  test('does not register a sitemap Nitro plugin when content.sitemap is disabled', async () => {
    const { nuxt, hooks } = createNuxt()

    const mod = await import('../../packages/content/src/module')
    await mod.default.setup(createOptions({ sitemap: false }), nuxt as any)

    const nitroConfig: Record<string, any> = {}
    hooks.get('nitro:config')?.(nitroConfig)

    expect(nitroConfig.plugins).toBeUndefined()
    expect(nuxt.options.sitemap.sources).toEqual([])
    expect(nuxt.options.sitemap.excludeAppSources).toBeUndefined()
  })

  test('registers sitemap assertion on the final Nuxt sitemap hook and keeps build fallback in Nitro', async () => {
    const { nuxt, hooks } = createNuxt()

    const mod = await import('../../packages/content/src/module')
    await mod.default.setup(createOptions({
      sitemap: {
        assert: {
          enabled: true
        }
      }
    }), nuxt as any)

    const nitroConfig: Record<string, any> = {}
    hooks.get('nitro:config')?.(nitroConfig)

    expect(nitroConfig.hooks?.compiled).toBeTypeOf('function')
    expect(hooks.get('sitemap:prerender:done')).toBeTypeOf('function')
  })

  test('resolves Nuxt Sitemap i18n XML routes for static prerender', async () => {
    const { nuxt } = createNuxt()
    const { resolveNuxtSitemapPrerenderRoutes } = await import('../../packages/content/src/module/options')

    expect(resolveNuxtSitemapPrerenderRoutes(nuxt as any)).toEqual([
      '/sitemap.xml',
      '/sitemap_index.xml',
      '/__sitemap__/en-US.xml',
      '/__sitemap__/de-DE.xml'
    ])
  })

  test('normalizes sitemap assertion defaults and exposes them to module internals', async () => {
    const { nuxt, hooks } = createNuxt()

    const mod = await import('../../packages/content/src/module')
    await mod.default.setup(createOptions({
      sitemap: {
        include: ['docs'],
        assert: {
          enabled: true,
          requiredCollections: ['docs'],
          sitemaps: {
            'de-DE': {
              allowEmpty: true
            }
          }
        }
      }
    }), nuxt as any)
    await hooks.get('modules:done')?.()

    expect(applyContentRuntimeConfig).toHaveBeenCalledWith(
      nuxt,
      expect.any(Object),
      expect.objectContaining({
        sitemap: expect.objectContaining({
          include: ['docs'],
          assert: {
            enabled: true,
            mode: 'generate',
            allowEmpty: false,
            minUrlsPerSitemap: 1,
            requireImages: false,
            requiredCollections: ['docs'],
            sitemaps: {
              'de-DE': {
                allowEmpty: true
              }
            }
          }
        })
      }),
      expect.objectContaining({
        docs: expect.objectContaining({
          source: '**/*.md'
        })
      }),
      expect.anything(),
      expect.anything()
    )
  })

  test('derives runtime i18n defaults from Nuxt i18n and keeps translatedSlugs opt-in', async () => {
    const { nuxt, hooks } = createNuxt()

    const mod = await import('../../packages/content/src/module')
    await mod.default.setup(createOptions({ i18n: true }), nuxt as any)
    await hooks.get('modules:done')?.()

    expect(applyContentRuntimeConfig).toHaveBeenCalledWith(
      nuxt,
      expect.any(Object),
      expect.objectContaining({
        locales: ['en', 'de'],
        defaultLocale: 'en',
        translatedSlugs: false
      }),
      expect.objectContaining({
        docs: expect.objectContaining({
          source: '**/*.md'
        })
      }),
      expect.anything(),
      expect.anything()
    )
  })

  test('inlines comark runtime dependencies into Nitro', async () => {
    const { nuxt, hooks } = createNuxt()

    const mod = await import('../../packages/content/src/module')
    await mod.default.setup(createOptions(), nuxt as any)

    const nitroConfig: Record<string, any> = {}
    hooks.get('nitro:config')?.(nitroConfig)

    expect(nitroConfig.externals?.inline).toEqual(expect.arrayContaining([
      '/resolved/./runtime',
      'comark',
      '@comark/vue'
    ]))
    expect(nuxt.options.build.transpile).toEqual(expect.arrayContaining(['comark', '@comark/vue']))
    expect((nuxt.options.vite as any).ssr.noExternal).toEqual(expect.arrayContaining(['comark', '@comark/vue']))
  })
})
