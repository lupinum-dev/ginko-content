import { beforeEach, describe, expect, test, vi } from 'vitest'
import { addServerHandler } from '@nuxt/kit'

describe('content server handlers', () => {
  beforeEach(() => {
    vi.mocked(addServerHandler).mockReset()
  })

  test('does not register the revalidation endpoint without an explicit token', async () => {
    const { registerContentServerHandlers } = await import('../../packages/content/src/module/server-handlers')

    registerContentServerHandlers({ options: { dev: false } } as any, {
      api: { baseURL: '/api/_content' },
      sitemap: false,
      navigation: false,
      revalidate: false
    } as any, path => path, 1)

    expect(addServerHandler).not.toHaveBeenCalledWith(expect.objectContaining({
      method: 'post',
      route: '/api/_content/revalidate'
    }))
    expect(addServerHandler).toHaveBeenCalledWith({
      middleware: true,
      handler: './server/middleware/preview.js'
    })
  })

  test('registers the revalidation endpoint when a token is configured', async () => {
    const { registerContentServerHandlers } = await import('../../packages/content/src/module/server-handlers')

    registerContentServerHandlers({ options: { dev: false } } as any, {
      api: { baseURL: '/api/_content' },
      sitemap: false,
      navigation: false,
      revalidate: { token: 'secret' }
    } as any, path => path, 1)

    expect(addServerHandler).toHaveBeenCalledWith(expect.objectContaining({
      method: 'post',
      route: '/api/_content/revalidate'
    }))
  })
})
