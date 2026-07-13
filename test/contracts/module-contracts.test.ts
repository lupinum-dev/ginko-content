import { beforeEach, describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { fields } from '../../packages/content/src/types/fields'

const applyContentRuntimeConfig = vi.fn()
const registerContentServerHandlers = vi.fn()
const sitemapLoggerWarn = vi.fn()

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
        sources: [
          {
            context: {
              name: 'nuxt:pages'
            },
            fetch: '/__sitemap__/pages'
          },
          {
            context: {
              name: '@lupinum/ginko-content:urls'
            },
            fetch: '/api/_content/sitemap'
          }
        ] as any[]
      }
    },
    hook(name: string, fn: (...arguments_: any[]) => any) {
      hooks.set(name, fn)
    },
    async callHook(name: string, ...arguments_: any[]) {
      return await hooks.get(name)?.(...arguments_)
    }
  }

  return { nuxt, hooks }
}

function createOptions(overrides: Record<string, any> = {}) {
  return {
    api: { baseURL: '/api/_content' },
    i18n: true,
    sitemap: true,
    watch: true,
    sources: {},
    ignores: [],
    markdown: { plugins: [], tags: {}, anchorLinks: { depth: 4, exclude: [1] } },
    yaml: {},
    csv: { delimiter: ',', json: true },
    navigation: { fields: [] },
    respectPathCase: false,
    ...overrides
  }
}

describe('module contracts', () => {
  beforeEach(() => {
    vi.resetModules()
    applyContentRuntimeConfig.mockReset()
    registerContentServerHandlers.mockReset()
    sitemapLoggerWarn.mockReset()

    vi.doMock('@nuxt/kit', () => ({
      createResolver: () => ({
        resolve: (...parts: string[]) => `/resolved/${parts.join('/')}`,
        resolvePath: vi.fn(async (value: string) => value)
      }),
      defineNuxtModule: (definition: any) => definition,
      addTemplate: vi.fn(),
      useLogger: vi.fn(() => ({
        info: vi.fn(),
        warn: sitemapLoggerWarn
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

  test.each(['collections', 'provider', 'providers'])('rejects nuxt.config content.%s as a second source of truth', async (key) => {
    const { validateContentConfigOnlyOptions } = await import('../../packages/content/src/module/validation')
    expect(() => validateContentConfigOnlyOptions({
      ...createOptions(),
      [key]: key === 'provider' ? 'cms' : {}
    })).toThrow(`content.${key} was removed from nuxt.config`)
  })

  test('registers the content sitemap Nitro plugin when sitemap integration is enabled', async () => {
    const { nuxt, hooks } = createNuxt()

    const mod = await import('../../packages/content/src/module')
    await mod.default.setup(createOptions(), nuxt as any)

    const nitroConfig: Record<string, any> = {}
    hooks.get('nitro:config')?.(nitroConfig)

    expect((nitroConfig.plugins as string[]).some(plugin => plugin.includes('runtime/server/plugins/sitemap.js'))).toBe(true)
    expect(nuxt.options.sitemap.sources).toEqual([
      {
        context: {
          name: 'nuxt:pages'
        },
        fetch: '/__sitemap__/pages'
      },
      {
        context: {
          name: '@lupinum/ginko-content:urls'
        },
        fetch: '/api/_content/sitemap'
      }
    ])
    expect(nuxt.options.sitemap.excludeAppSources).toBeUndefined()
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

  test('fails when collection map key and authored handle name drift', async () => {
    const { nuxt } = createNuxt()

    vi.doMock('../../packages/content/src/utils/content-config', () => ({
      loadContentConfig: vi.fn(async () => ({
        collections: {
          docs: { name: 'guides', source: '**/*.md' }
        }
      })),
      resolveContentConfigPath: vi.fn(() => '/workspace/app/content.config.ts')
    }))

    const mod = await import('../../packages/content/src/module')
    await expect(mod.default.setup(createOptions(), nuxt as any)).rejects.toThrow(
      '@lupinum/ginko-content collection key "docs" must match collection name "guides"'
    )
  })

  test('validates explicit content page route metadata against collection route mounts', async () => {
    const { nuxt, hooks } = createNuxt()

    vi.doMock('../../packages/content/src/utils/content-config', () => ({
      loadContentConfig: vi.fn(async () => ({
        collections: {
          docs: {
            source: '**/*.md',
            route: { en: '/docs', de: '/dokumentation' },
            i18n: { defaultLocale: 'en', locales: ['en', 'de'] }
          }
        }
      })),
      resolveContentConfigPath: vi.fn(() => '/workspace/app/content.config.ts')
    }))

    const mod = await import('../../packages/content/src/module')
    await mod.default.setup(createOptions(), nuxt as any)

    expect(() => hooks.get('pages:extend')?.([{
      file: '/workspace/app/pages/docs/[...slug].vue',
      meta: {
        content: {
          collection: 'docs',
          route: { en: '/docs', de: '/docs' }
        }
      }
    }])).toThrow(
      'collection "docs" locale "de" expected route "/dokumentation" but page metadata declares "/docs"'
    )
  })

  test('accepts a provider implementation registered by a Nuxt module hook', async () => {
    const { nuxt, hooks } = createNuxt()
    nuxt.hook('content:providers', (providers: Record<string, string>) => {
      providers.cms = '@lupinum/ginko-cms/nuxt-provider'
    })

    vi.doMock('../../packages/content/src/utils/content-config', () => ({
      loadContentConfig: vi.fn(async () => ({
        provider: 'cms',
        collections: {
          docs: { source: '**/*.md' }
        }
      })),
      resolveContentConfigPath: vi.fn(() => '/workspace/app/content.config.ts')
    }))

    const mod = await import('../../packages/content/src/module')
    await mod.default.setup(createOptions(), nuxt as any)
    await hooks.get('modules:done')?.()

    expect(applyContentRuntimeConfig).toHaveBeenCalledWith(
      nuxt,
      expect.not.objectContaining({ provider: 'cms' }),
      expect.objectContaining({
        provider: 'cms',
        providers: {
          cms: '@lupinum/ginko-cms/nuxt-provider'
        }
      }),
      expect.objectContaining({
        provider: 'cms'
      }),
      expect.any(Object),
      expect.any(Object),
      expect.anything(),
      expect.anything()
    )
  })

  test('serializes derived collection relation metadata without live schemas in runtime config', async () => {
    const { nuxt, hooks } = createNuxt()
    nuxt.options.dev = true

    vi.doMock('../../packages/content/src/utils/content-config', () => ({
      loadContentConfig: vi.fn(async () => ({
        collections: {
          posts: {
            source: 'posts/*.md',
            schema: z.object({
              authors: fields.relations('authors')
            })
          },
          authors: {
            source: 'authors/*.yml'
          }
        }
      })),
      resolveContentConfigPath: vi.fn(() => '/workspace/app/content.config.ts')
    }))

    const mod = await import('../../packages/content/src/module')
    await mod.default.setup(createOptions(), nuxt as any)
    await hooks.get('modules:done')?.()

    expect(applyContentRuntimeConfig).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        collections: expect.any(Object)
      }),
      expect.objectContaining({
        posts: expect.objectContaining({
          source: 'posts/*.md',
          references: {
            authors: ['authors']
          }
        }),
        authors: expect.not.objectContaining({
          references: expect.anything()
        })
      }),
      expect.objectContaining({
        posts: expect.objectContaining({
          source: 'posts/*.md',
          references: {
            authors: ['authors']
          }
        })
      }),
      undefined,
      expect.anything()
    )

    const privateCollections = applyContentRuntimeConfig.mock.calls[0][5]
    expect(privateCollections.posts).not.toHaveProperty('schema')
  })

  test('fails loudly when cms provider is selected without the CMS module registration', async () => {
    const { nuxt, hooks } = createNuxt()

    vi.doMock('../../packages/content/src/utils/content-config', () => ({
      loadContentConfig: vi.fn(async () => ({
        provider: 'cms',
        collections: {
          docs: { source: '**/*.md' }
        }
      })),
      resolveContentConfigPath: vi.fn(() => '/workspace/app/content.config.ts')
    }))

    const mod = await import('../../packages/content/src/module')
    await mod.default.setup(createOptions(), nuxt as any)

    await expect(hooks.get('modules:done')?.()).rejects.toThrow(
      'content.config.ts sets provider "cms", but no CMS provider module registered it'
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

    expect(nitroConfig.plugins).toHaveLength(2)
    expect(nitroConfig.plugins[0]).toBe('/existing/plugin')
    expect(nitroConfig.plugins[1]).toEqual(expect.stringContaining('runtime/server/plugins/sitemap.js'))
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

  test('warns when content.sitemap is enabled but @nuxtjs/sitemap is not registered', async () => {
    const { nuxt } = createNuxt()
    nuxt.options.modules = ['@nuxtjs/i18n']

    const mod = await import('../../packages/content/src/module')
    await mod.default.setup(createOptions(), nuxt as any)

    expect(sitemapLoggerWarn).toHaveBeenCalledWith(expect.stringContaining('@nuxtjs/sitemap'))
  })

  test('does not warn about @nuxtjs/sitemap when it is registered', async () => {
    const { nuxt } = createNuxt()

    const mod = await import('../../packages/content/src/module')
    await mod.default.setup(createOptions(), nuxt as any)

    expect(sitemapLoggerWarn).not.toHaveBeenCalled()
  })

  test('does not warn about @nuxtjs/sitemap when content.sitemap is disabled', async () => {
    const { nuxt } = createNuxt()
    nuxt.options.modules = ['@nuxtjs/i18n']

    const mod = await import('../../packages/content/src/module')
    await mod.default.setup(createOptions({ sitemap: false }), nuxt as any)

    expect(sitemapLoggerWarn).not.toHaveBeenCalled()
  })

  test('does not register a sitemap Nitro plugin when content.sitemap is disabled', async () => {
    const { nuxt, hooks } = createNuxt()

    const mod = await import('../../packages/content/src/module')
    await mod.default.setup(createOptions({ sitemap: false }), nuxt as any)

    const nitroConfig: Record<string, any> = {}
    hooks.get('nitro:config')?.(nitroConfig)

    expect(nitroConfig.plugins).toBeUndefined()
    expect(nuxt.options.sitemap.sources).toEqual([
      {
        context: {
          name: 'nuxt:pages'
        },
        fetch: '/__sitemap__/pages'
      },
      {
        context: {
          name: '@lupinum/ginko-content:urls'
        },
        fetch: '/api/_content/sitemap'
      }
    ])
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

  test('respects Nuxt Sitemap single-sitemap mode when resolving static prerender routes', async () => {
    const { nuxt } = createNuxt()
    nuxt.options.sitemap = {
      ...nuxt.options.sitemap,
      sitemaps: false
    } as typeof nuxt.options.sitemap
    const { resolveNuxtSitemapPrerenderRoutes } = await import('../../packages/content/src/module/options')

    expect(resolveNuxtSitemapPrerenderRoutes(nuxt as any)).toEqual(['/sitemap.xml'])
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
            requireProductionSiteUrl: false,
            requiredCollections: ['docs'],
            requiredPaths: [],
            forbiddenPathPrefixes: [],
            sitemaps: {
              'de-DE': {
                allowEmpty: true
              }
            }
          }
        })
      }),
      expect.objectContaining({
        collections: expect.any(Object)
      }),
      expect.objectContaining({
        docs: expect.objectContaining({
          source: '**/*.md'
        })
      }),
      expect.objectContaining({
        docs: expect.any(Object)
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
        collections: expect.any(Object)
      }),
      expect.objectContaining({
        docs: expect.objectContaining({
          source: '**/*.md'
        })
      }),
      expect.objectContaining({
        docs: expect.any(Object)
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
      expect.stringContaining('runtime'),
      'comark',
      '@comark/vue'
    ]))
    expect(nuxt.options.build.transpile).toEqual(expect.arrayContaining(['comark', '@comark/vue']))
    expect((nuxt.options.vite as any).ssr.noExternal).toEqual(expect.arrayContaining(['comark', '@comark/vue']))
  })

  // VNEXT.md §12.1/§22: Nuxt I18n is the sole locale/default-locale authority
  // when installed. Ginko must fail setup rather than union or ignore
  // duplicate declarations. Paired with the resolver unit tests in
  // test/unit/locale-policy.test.ts.
  test('fails setup when Nuxt I18n is installed and content.i18n also declares locales', async () => {
    const { nuxt } = createNuxt()

    const mod = await import('../../packages/content/src/module')
    await expect(mod.default.setup(createOptions({
      i18n: { locales: ['en', 'de'] }
    }), nuxt as any)).rejects.toThrow(/sole locale\/default-locale authority/)
  })

  test('fails setup when Nuxt I18n is installed and content.i18n also declares a default locale', async () => {
    const { nuxt } = createNuxt()

    const mod = await import('../../packages/content/src/module')
    await expect(mod.default.setup(createOptions({
      i18n: { defaultLocale: 'de' }
    }), nuxt as any)).rejects.toThrow(/sole locale\/default-locale authority/)
  })

  // VNEXT.md §17.4: `content:providers` remains the mutable setup registry
  // (fires before provider validation); `content:context` becomes a
  // read-only notification that only fires after the content context is
  // fully resolved, carrying finalized default locale, fallback,
  // translated-slug mode, and route mounts.
  test('content:providers fires before provider selection is validated, and content:context observes the finalized context', async () => {
    const { nuxt, hooks } = createNuxt()
    const observedContext: any[] = []
    let providersRegisteredBeforeContext = false

    nuxt.hook('content:providers', (providers: Record<string, string>) => {
      providers.cms = '@lupinum/ginko-cms/nuxt-provider'
      providersRegisteredBeforeContext = true
    })
    nuxt.hook('content:context', (ctx: any) => {
      observedContext.push(ctx)
    })

    vi.doMock('../../packages/content/src/utils/content-config', () => ({
      loadContentConfig: vi.fn(async () => ({
        provider: 'cms',
        collections: {
          docs: { source: '**/*.md', i18n: true }
        }
      })),
      resolveContentConfigPath: vi.fn(() => '/workspace/app/content.config.ts')
    }))

    const mod = await import('../../packages/content/src/module')
    await mod.default.setup(createOptions({
      i18n: true
    }), nuxt as any)
    await hooks.get('modules:done')?.()

    expect(providersRegisteredBeforeContext).toBe(true)
    expect(observedContext).toHaveLength(1)
    const finalized = observedContext[0]
    expect(finalized.defaultLocale).toBe('en')
    expect(finalized.locales).toEqual(['en', 'de'])
    expect(finalized.localeFallback).toEqual({})
    expect(finalized.translatedSlugs).toBe(false)
    expect(finalized.contract).toMatchObject({
      format: 'ginko-content-contract',
      version: 1,
      defaultLocale: 'en',
      locales: ['en', 'de'],
      collections: { docs: { id: 'docs' } },
    })
    expect(finalized.contractSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(finalized.localePolicy.collections.docs).toMatchObject({
      localized: true,
      locales: ['en', 'de'],
      defaultLocale: 'en',
      // Localized collections carry a per-locale route mount map
      // (VNEXT.md §22.2 step 7 / §23), not a single `default` mount.
      routeMounts: { en: '/docs', de: '/docs' }
    })
  })

  test('freezes the resolved content context in dev so content:context observers cannot mutate it', async () => {
    const { nuxt, hooks } = createNuxt()
    nuxt.options.dev = true
    let observed: any

    nuxt.hook('content:context', (ctx: any) => {
      observed = ctx
    })

    const mod = await import('../../packages/content/src/module')
    await mod.default.setup(createOptions({ i18n: true }), nuxt as any)
    await hooks.get('modules:done')?.()

    expect(Object.isFrozen(observed)).toBe(true)
    expect(() => {
      observed.defaultLocale = 'de'
    }).toThrow()
  })
})
