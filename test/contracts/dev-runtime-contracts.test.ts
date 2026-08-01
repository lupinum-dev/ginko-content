import { describe, expect, test, vi } from 'vitest'

describe('content dev runtime', () => {
  test.each(['serial', 'environment-api'] as const)('invalidates changed content through the client Vite server in %s mode', async (mode) => {
    const { registerContentDevRuntime } = await import('../../packages/content/src/module/dev')

    let nitroInit: ((nitro: any) => Promise<void>) | undefined
    let nitroClose: (() => Promise<void>) | undefined
    let viteServerCreated: ((server: any, environment: { isClient: boolean, isServer: boolean }) => void) | undefined
    let watchHandler: ((event: string, key: string) => Promise<void>) | undefined
    const removeItem = vi.fn(async () => {})
    const unwatch = vi.fn(async () => {})
    const clientViteSend = vi.fn()
    const serverViteSend = vi.fn()

    const nuxt = {
      options: {
        vite: {}
      },
      hook(name: string, handler: (...args: any[]) => void | Promise<void>) {
        if (name === 'nitro:init') {
          nitroInit = handler as typeof nitroInit
        }
        if (name === 'vite:serverCreated') {
          viteServerCreated = handler as typeof viteServerCreated
        }
      }
    }

    const nitro = {
      storage: {
        watch: vi.fn(async (handler: (event: string, key: string) => Promise<void>) => {
          watchHandler = handler
          return unwatch
        }),
        removeItem
      },
      hooks: {
        hook: vi.fn((name: string, handler: () => Promise<void>) => {
          if (name === 'close') {
            nitroClose = handler
          }
        })
      },
      options: {
        runtimeConfig: {
          public: {
            content: {}
          }
        }
      }
    }

    registerContentDevRuntime(
      nuxt as any,
      { watch: true } as any,
      { ignores: [] } as any
    )

    expect(viteServerCreated).toBeTypeOf('function')
    if (mode === 'serial') {
      viteServerCreated?.(
        { ws: { send: clientViteSend } },
        { isClient: true, isServer: false }
      )
      viteServerCreated?.(
        { ws: { send: serverViteSend } },
        { isClient: false, isServer: true }
      )
    } else {
      viteServerCreated?.(
        { ws: { send: clientViteSend } },
        { isClient: true, isServer: true }
      )
    }

    await nitroInit?.(nitro)
    expect(watchHandler).toBeTypeOf('function')
    removeItem.mockClear()

    await watchHandler?.('update', 'content:source:content:en/docs/intro.md')

    expect(removeItem).toHaveBeenCalledTimes(1)
    expect(removeItem).toHaveBeenCalledWith('cache:content:parsed:content:en/docs/intro.md')
    expect(clientViteSend).toHaveBeenCalledWith({
      type: 'custom',
      event: 'ginko-content:update',
      data: {
        event: 'update',
        key: 'content:en/docs/intro.md'
      }
    })
    expect(serverViteSend).not.toHaveBeenCalled()

    expect(nitroClose).toBeTypeOf('function')
    await nitroClose?.()
    expect(unwatch).toHaveBeenCalledTimes(1)
  })

  test('does not invalidate caches for unrelated storage changes', async () => {
    const { registerContentDevRuntime } = await import('../../packages/content/src/module/dev')

    let nitroInit: ((nitro: any) => Promise<void>) | undefined
    let watchHandler: ((event: string, key: string) => Promise<void>) | undefined
    const removeItem = vi.fn(async () => {})

    const nuxt = {
      options: {
        vite: {}
      },
      hook(name: string, handler: (nitro: any) => Promise<void>) {
        if (name === 'nitro:init') {
          nitroInit = handler
        }
      }
    }

    const nitro = {
      storage: {
        watch: vi.fn(async (handler: (event: string, key: string) => Promise<void>) => {
          watchHandler = handler
          return vi.fn(async () => {})
        }),
        removeItem
      },
      hooks: {
        hook: vi.fn()
      },
      options: {
        runtimeConfig: {
          public: {
            content: {}
          }
        }
      }
    }

    registerContentDevRuntime(
      nuxt as any,
      { watch: true } as any,
      { ignores: [] } as any
    )

    await nitroInit?.(nitro)
    removeItem.mockClear()

    await watchHandler?.('update', 'cache:other:item')

    expect(removeItem).not.toHaveBeenCalled()
  })

  test('does not register hot reload channels when watch is disabled', async () => {
    const { registerContentDevRuntime } = await import('../../packages/content/src/module/dev')

    const nuxt = {
      options: {
        vite: {}
      },
      hook: vi.fn()
    }

    registerContentDevRuntime(
      nuxt as any,
      { watch: false } as any,
      { ignores: [] } as any
    )

    expect(nuxt.hook).not.toHaveBeenCalledWith('vite:serverCreated', expect.any(Function))
  })
})
