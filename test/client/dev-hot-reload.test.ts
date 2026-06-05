import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

describe('content dev hot reload client', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete (globalThis as Record<string, unknown>).__nuxtRefreshNuxtData
  })

  test('uses Vite HMR to refresh Nuxt data', async () => {
    const refreshNuxtData = vi.fn()
    ;(globalThis as Record<string, unknown>).__nuxtRefreshNuxtData = refreshNuxtData

    const hot = {
      on: vi.fn()
    }

    const { registerContentHotReload } = await import('../../packages/content/src/runtime/app/composables/hot-reload')

    registerContentHotReload(hot, true)

    expect(hot.on).toHaveBeenCalledTimes(1)
    expect(hot.on).toHaveBeenCalledWith('ginko-content:update', expect.any(Function))

    const onUpdate = hot.on.mock.calls[0]?.[1] as ((data: unknown) => void) | undefined
    onUpdate?.({ event: 'update', key: 'content:en/docs/intro.md' })
    onUpdate?.(undefined)

    expect(refreshNuxtData).toHaveBeenCalledTimes(1)
  })

  test('does not register without Vite HMR', async () => {
    const { registerContentHotReload } = await import('../../packages/content/src/runtime/app/composables/hot-reload')

    expect(registerContentHotReload(undefined, true)).toBeUndefined()
  })
})
