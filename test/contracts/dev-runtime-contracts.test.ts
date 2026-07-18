import { describe, expect, test, vi } from 'vitest'

describe('content dev runtime', () => {
  test('invalidates the parsed cache for changed source content', async () => {
    const { registerContentDevRuntime } = await import('../../packages/content/src/module/dev')

    let nitroInit: ((nitro: any) => Promise<void>) | undefined
    let watchHandler: ((event: string, key: string) => Promise<void>) | undefined
    const removeItem = vi.fn(async () => {})
    const viteSend = vi.fn()

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
    ;(nuxt.options.vite as any).plugins[0].configureServer({ ws: { send: viteSend } })

    await nitroInit?.(nitro)
    removeItem.mockClear()

    await watchHandler?.('update', 'content:source:content:en/docs/intro.md')

    expect(removeItem).toHaveBeenCalledTimes(1)
    expect(removeItem).toHaveBeenCalledWith('cache:content:parsed:content:en/docs/intro.md')
    expect(viteSend).toHaveBeenCalledWith({
      type: 'custom',
      event: 'ginko-content:update',
      data: {
        event: 'update',
        key: 'content:en/docs/intro.md'
      }
    })
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

    expect((nuxt.options.vite as any).plugins).toBeUndefined()
  })
})
