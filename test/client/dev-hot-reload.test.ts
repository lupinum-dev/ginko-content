import { describe, expect, test, vi } from 'vitest'

describe('content dev hot reload client', () => {
  test('uses Vite HMR to refresh Nuxt data', async () => {
    const refreshNuxtData = vi.fn()
    const hot = {
      on: vi.fn()
    }

    const { registerContentHotReload } = await import('../../packages/content/src/runtime/app/plugins/hot-reload')

    registerContentHotReload(hot, true, refreshNuxtData)

    expect(hot.on).toHaveBeenCalledTimes(1)
    expect(hot.on).toHaveBeenCalledWith('ginko-content:update', expect.any(Function))

    const onUpdate = hot.on.mock.calls[0]?.[1] as ((data: unknown) => void) | undefined
    onUpdate?.({ event: 'update', key: 'content:en/docs/intro.md' })
    onUpdate?.(undefined)

    expect(refreshNuxtData).toHaveBeenCalledTimes(1)
  })

  test('does not register without Vite HMR', async () => {
    const { registerContentHotReload } = await import('../../packages/content/src/runtime/app/plugins/hot-reload')

    expect(registerContentHotReload(undefined, true, vi.fn())).toBeUndefined()
  })
})
