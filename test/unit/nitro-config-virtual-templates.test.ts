import { describe, expect, test, vi } from 'vitest'
import { registerContentNitroConfig } from '../../packages/content/src/module/nitro-config'

// The generated `<buildDir>/content/virtual-*.mjs` modules import authored app files:
// `content.config.ts` and any registered transformer. Nitro's dev server externalizes
// build-dir modules by default, which means Node — not a bundler — loads that TypeScript.
// Node's ESM loader only resolves fully specified relative imports, so a `content.config.ts`
// that imports `./app/site.config` (the way `nuxt.config.ts` legitimately may) crashes every
// request with ERR_MODULE_NOT_FOUND. Inlining the directory keeps the config authoring rules
// the same as the rest of a Nuxt app.

function inlineEntries(nitroConfig: Record<string, any>): string[] {
  // `resolve()` yields backslashes on Windows; Nitro normalizes matcher patterns
  // itself, so compare on the normalized form rather than a POSIX literal.
  return (nitroConfig.externals.inline as unknown[])
    .filter((entry): entry is string => typeof entry === 'string')
    .map(entry => entry.replaceAll('\\', '/'))
}

function createHarness() {
  const hooks = new Map<string, (...arguments_: any[]) => any>()
  const nuxt = {
    options: {
      dev: true,
      rootDir: '/workspace/app',
      srcDir: '/workspace/app',
      buildDir: '/workspace/app/.nuxt',
      ignore: [] as string[]
    },
    hook(name: string, fn: (...arguments_: any[]) => any) {
      hooks.set(name, fn)
    }
  }

  registerContentNitroConfig({
    nuxt: nuxt as any,
    options: { api: { baseURL: '/api/_content' } } as any,
    appContentConfig: {} as any,
    contentContext: { provider: 'filesystem', sources: {}, sitemap: false, cache: false } as any,
    runtimeInlineDependencies: ['comark'],
    buildIntegrity: 123,
    resolvedI18n: { locales: [], defaultLocale: undefined },
    resolveRuntimeModule: (path: string) => `/resolved/runtime/${path}`,
    resolveModuleFile: (path: string) => `/resolved/module/${path}`,
    getResolvedContentContext: () => ({ sitemap: false, provider: 'filesystem' }) as any,
    getSearchRuntime: () => false,
    logger: { warn: vi.fn() }
  })

  const nitroConfig: Record<string, any> = { prerender: { routes: [] } }
  hooks.get('nitro:config')?.(nitroConfig)

  return nitroConfig
}

describe('nitro-config virtual template bundling', () => {
  test('inlines the generated content templates so Node never loads authored TypeScript', () => {
    const nitroConfig = createHarness()

    expect(inlineEntries(nitroConfig).some(entry => entry.endsWith('/.nuxt/content/'))).toBe(true)
  })

  test('keeps the runtime module and inline dependencies alongside it', () => {
    const nitroConfig = createHarness()

    expect(nitroConfig.externals.inline).toContain('/resolved/module/.')
    expect(nitroConfig.externals.inline).toContain('comark')
  })

  test('preserves inline entries the app configured itself', () => {
    const hooks = new Map<string, (...arguments_: any[]) => any>()
    const nuxt = {
      options: {
        dev: true,
        rootDir: '/workspace/app',
        srcDir: '/workspace/app',
        buildDir: '/workspace/app/.nuxt',
        ignore: [] as string[]
      },
      hook(name: string, fn: (...arguments_: any[]) => any) {
        hooks.set(name, fn)
      }
    }

    registerContentNitroConfig({
      nuxt: nuxt as any,
      options: { api: { baseURL: '/api/_content' } } as any,
      appContentConfig: {} as any,
      contentContext: { provider: 'filesystem', sources: {}, sitemap: false, cache: false } as any,
      runtimeInlineDependencies: [],
      buildIntegrity: 123,
      resolvedI18n: { locales: [], defaultLocale: undefined },
      resolveRuntimeModule: (path: string) => `/resolved/runtime/${path}`,
      resolveModuleFile: (path: string) => `/resolved/module/${path}`,
      getResolvedContentContext: () => ({ sitemap: false, provider: 'filesystem' }) as any,
      getSearchRuntime: () => false,
      logger: { warn: vi.fn() }
    })

    const nitroConfig: Record<string, any> = {
      prerender: { routes: [] },
      externals: { inline: ['my-own-package'] }
    }
    hooks.get('nitro:config')?.(nitroConfig)

    expect(nitroConfig.externals.inline).toContain('my-own-package')
    expect(inlineEntries(nitroConfig).some(entry => entry.endsWith('/.nuxt/content/'))).toBe(true)
  })
})
