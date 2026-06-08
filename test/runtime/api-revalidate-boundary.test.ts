import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createTestEvent } from '../harness/event'

const mocks = vi.hoisted(() => ({
  clearSearchRecordsCache: vi.fn(),
  getContentCacheAdapter: vi.fn(),
  getContentProvider: vi.fn(),
  getContentRuntimeConfig: vi.fn()
}))

vi.mock('../../packages/content/src/runtime/server/cache-adapter', () => ({
  getContentCacheAdapter: mocks.getContentCacheAdapter
}))

vi.mock('../../packages/content/src/runtime/server/providers', () => ({
  getContentProvider: mocks.getContentProvider
}))

vi.mock('../../packages/content/src/runtime/server/runtime-config', () => ({
  getContentRuntimeConfig: mocks.getContentRuntimeConfig
}))

vi.mock('../../packages/content/src/runtime/server/search', () => ({
  clearSearchRecordsCache: mocks.clearSearchRecordsCache
}))

async function hmacSha256Hex(secret: string, value: string) {
  const encoder = new TextEncoder()
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await globalThis.crypto.subtle.sign('HMAC', key, encoder.encode(value))
  return Array.from(new Uint8Array(signature))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function signedHeaders(body: string, options?: { token?: string; eventId?: string; timestamp?: number }) {
  const token = options?.token ?? 'secret'
  const eventId = options?.eventId ?? 'event_123'
  const timestamp = String(options?.timestamp ?? Date.now())
  const signature = await hmacSha256Hex(token, `${timestamp}.${eventId}.${body}`)
  return {
    'content-length': String(body.length),
    'content-type': 'application/json',
    'x-ginko-revalidation-event': eventId,
    'x-ginko-signature': `sha256=${signature}`,
    'x-ginko-signature-timestamp': timestamp
  }
}

describe('runtime revalidate API boundary', () => {
  beforeEach(() => {
    mocks.getContentCacheAdapter.mockReset()
    mocks.getContentCacheAdapter.mockResolvedValue(undefined)
    mocks.clearSearchRecordsCache.mockReset()
    mocks.getContentProvider.mockReset()
    mocks.getContentRuntimeConfig.mockReset()
    mocks.getContentRuntimeConfig.mockReturnValue({
      content: { revalidate: { token: 'secret', allowUnsigned: true } }
    })
  })

  test('rejects requests with an invalid revalidation token', async () => {
    const handler = (await import('../../packages/content/src/runtime/server/api/revalidate')).default
    const event = {
      ...createTestEvent(),
      method: 'POST',
      node: {
        req: {
          method: 'POST',
          url: '/',
          headers: {
            'content-type': 'application/json',
            'x-ginko-revalidate-token': 'wrong'
          }
        }
      },
      web: {
        request: new Request('http://content.local/', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-ginko-revalidate-token': 'wrong'
          },
          body: JSON.stringify({ paths: ['/docs/a'] })
        })
      }
    } as any

    await expect(handler(event)).rejects.toMatchObject({
      statusCode: 401,
      statusMessage: 'invalid_revalidation_token'
    })
    expect(mocks.getContentProvider).not.toHaveBeenCalled()
  })

  test('rejects invalid JSON with a typed boundary error', async () => {
    const handler = (await import('../../packages/content/src/runtime/server/api/revalidate')).default
    const body = '{"paths": ['
    const event = {
      ...createTestEvent(),
      method: 'POST',
      node: {
        req: {
          method: 'POST',
          url: '/',
          headers: {
            'content-length': String(body.length),
            'content-type': 'application/json',
            'x-ginko-revalidate-token': 'secret'
          },
          rawBody: body,
          [Symbol.asyncIterator]: async function * () {
            yield Buffer.from(body)
          }
        }
      }
    } as any

    await expect(handler(event)).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'invalid_revalidation_body'
    })
    expect(mocks.getContentProvider).not.toHaveBeenCalled()
  })

  test('passes validated tags and paths to provider invalidation', async () => {
    const invalidate = vi.fn()
    mocks.getContentProvider.mockResolvedValue({ invalidate })
    const handler = (await import('../../packages/content/src/runtime/server/api/revalidate')).default
    const body = JSON.stringify({
      tags: ['entry:docs:a', 'entry:docs:a'],
      paths: ['docs/a', '/docs/a']
    })
    const event = {
      ...createTestEvent(),
      method: 'POST',
      node: {
        req: {
          method: 'POST',
          url: '/',
          headers: {
            'content-length': String(body.length),
            'content-type': 'application/json',
            'x-ginko-revalidate-token': 'secret'
          },
          rawBody: body,
          [Symbol.asyncIterator]: async function * () {
            yield Buffer.from(body)
          }
        }
      },
      web: {
        request: new Request('http://content.local/', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-ginko-revalidate-token': 'secret'
          },
          body
        })
      }
    } as any

    await expect(handler(event)).resolves.toEqual({
      ok: true,
      tags: ['entry:docs:a'],
      paths: ['/docs/a']
    })
    expect(invalidate).toHaveBeenCalledWith(event, {
      tags: ['entry:docs:a'],
      paths: ['/docs/a']
    })
  })

  test('rejects when revalidation is disabled', async () => {
    mocks.getContentRuntimeConfig.mockReturnValue({ content: { revalidate: false } })
    const handler = (await import('../../packages/content/src/runtime/server/api/revalidate')).default
    const event = {
      ...createTestEvent(),
      method: 'POST',
      node: {
        req: {
          method: 'POST',
          url: '/',
          headers: {
            'content-type': 'application/json'
          }
        }
      }
    } as any

    await expect(handler(event)).rejects.toMatchObject({
      statusCode: 404,
      statusMessage: 'revalidation_disabled'
    })
    expect(mocks.getContentProvider).not.toHaveBeenCalled()
  })

  test('rejects when no revalidation token is configured', async () => {
    mocks.getContentRuntimeConfig.mockReturnValue({ content: { revalidate: {} } })
    const handler = (await import('../../packages/content/src/runtime/server/api/revalidate')).default
    const event = {
      ...createTestEvent(),
      method: 'POST',
      node: {
        req: {
          method: 'POST',
          url: '/',
          headers: {
            'content-type': 'application/json',
            'x-ginko-revalidate-token': 'secret'
          }
        }
      }
    } as any

    await expect(handler(event)).rejects.toMatchObject({
      statusCode: 404,
      statusMessage: 'revalidation_disabled'
    })
    expect(mocks.getContentProvider).not.toHaveBeenCalled()
  })

  test('rejects requests without tags or paths', async () => {
    const handler = (await import('../../packages/content/src/runtime/server/api/revalidate')).default
    const body = JSON.stringify({ reason: 'publish' })
    const event = {
      ...createTestEvent(),
      method: 'POST',
      node: {
        req: {
          method: 'POST',
          url: '/',
          headers: {
            'content-length': String(body.length),
            'content-type': 'application/json',
            'x-ginko-revalidate-token': 'secret'
          },
          rawBody: body,
          [Symbol.asyncIterator]: async function * () {
            yield Buffer.from(body)
          }
        }
      }
    } as any

    await expect(handler(event)).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'missing_revalidation_target'
    })
    expect(mocks.getContentProvider).not.toHaveBeenCalled()
  })

  test('fails when no provider or adapter supports invalidation', async () => {
    mocks.getContentProvider.mockResolvedValue({})
    const handler = (await import('../../packages/content/src/runtime/server/api/revalidate')).default
    const body = JSON.stringify({ paths: ['/docs/a'] })
    const event = {
      ...createTestEvent(),
      method: 'POST',
      node: {
        req: {
          method: 'POST',
          url: '/',
          headers: {
            'content-length': String(body.length),
            'content-type': 'application/json',
            'x-ginko-revalidate-token': 'secret'
          },
          rawBody: body,
          [Symbol.asyncIterator]: async function * () {
            yield Buffer.from(body)
          }
        }
      }
    } as any

    await expect(handler(event)).rejects.toMatchObject({
      statusCode: 501,
      statusMessage: 'revalidation_not_supported'
    })
  })

  test('passes invalidation to the configured cache adapter', async () => {
    const adapterInvalidate = vi.fn()
    mocks.getContentProvider.mockResolvedValue({})
    mocks.getContentCacheAdapter.mockResolvedValue({
      name: 'test-cache',
      apply: vi.fn(),
      invalidate: adapterInvalidate
    })
    const handler = (await import('../../packages/content/src/runtime/server/api/revalidate')).default
    const body = JSON.stringify({ paths: ['docs/a'] })
    const event = {
      ...createTestEvent(),
      method: 'POST',
      node: {
        req: {
          method: 'POST',
          url: '/',
          headers: {
            'content-length': String(body.length),
            'content-type': 'application/json',
            'x-ginko-revalidate-token': 'secret'
          },
          rawBody: body,
          [Symbol.asyncIterator]: async function * () {
            yield Buffer.from(body)
          }
        }
      }
    } as any

    await expect(handler(event)).resolves.toMatchObject({ ok: true, paths: ['/docs/a'] })
    expect(adapterInvalidate).toHaveBeenCalledWith({ paths: ['/docs/a'], tags: undefined })
    expect(mocks.clearSearchRecordsCache).toHaveBeenCalledTimes(1)
  })

  test('propagates cache adapter invalidation failures without clearing search cache', async () => {
    const adapterInvalidate = vi.fn(async () => {
      throw new Error('adapter failed')
    })
    mocks.getContentProvider.mockResolvedValue({})
    mocks.getContentCacheAdapter.mockResolvedValue({
      name: 'test-cache',
      apply: vi.fn(),
      invalidate: adapterInvalidate
    })
    const handler = (await import('../../packages/content/src/runtime/server/api/revalidate')).default
    const body = JSON.stringify({ tags: ['entry:docs:a'] })
    const event = {
      ...createTestEvent(),
      method: 'POST',
      node: {
        req: {
          method: 'POST',
          url: '/',
          headers: {
            'content-length': String(body.length),
            'content-type': 'application/json',
            'x-ginko-revalidate-token': 'secret'
          },
          rawBody: body,
          [Symbol.asyncIterator]: async function * () {
            yield Buffer.from(body)
          }
        }
      }
    } as any

    await expect(handler(event)).rejects.toThrow('adapter failed')
    expect(adapterInvalidate).toHaveBeenCalledWith({ tags: ['entry:docs:a'], paths: undefined })
    expect(mocks.clearSearchRecordsCache).not.toHaveBeenCalled()
  })

  test('rejects unsigned revalidation when signed delivery is required', async () => {
    mocks.getContentRuntimeConfig.mockReturnValue({ content: { revalidate: { token: 'secret' } } })
    const handler = (await import('../../packages/content/src/runtime/server/api/revalidate')).default
    const body = JSON.stringify({ paths: ['/docs/a'] })
    const event = {
      ...createTestEvent(),
      method: 'POST',
      node: {
        req: {
          method: 'POST',
          url: '/',
          headers: {
            'content-length': String(body.length),
            'content-type': 'application/json',
            'x-ginko-revalidate-token': 'secret'
          },
          rawBody: body,
          [Symbol.asyncIterator]: async function * () {
            yield Buffer.from(body)
          }
        }
      }
    } as any

    await expect(handler(event)).rejects.toMatchObject({
      statusCode: 401,
      statusMessage: 'missing_revalidation_signature'
    })
    expect(mocks.getContentProvider).not.toHaveBeenCalled()
  })

  test('rejects tampered signed revalidation bodies', async () => {
    mocks.getContentRuntimeConfig.mockReturnValue({ content: { revalidate: { token: 'secret' } } })
    const handler = (await import('../../packages/content/src/runtime/server/api/revalidate')).default
    const signedBody = JSON.stringify({ paths: ['/docs/a'] })
    const body = JSON.stringify({ paths: ['/docs/b'] })
    const event = {
      ...createTestEvent(),
      method: 'POST',
      node: {
        req: {
          method: 'POST',
          url: '/',
          headers: await signedHeaders(signedBody),
          rawBody: body,
          [Symbol.asyncIterator]: async function * () {
            yield Buffer.from(body)
          }
        }
      }
    } as any

    await expect(handler(event)).rejects.toMatchObject({
      statusCode: 401,
      statusMessage: 'invalid_revalidation_signature'
    })
    expect(mocks.getContentProvider).not.toHaveBeenCalled()
  })

  test('rejects stale signed revalidation requests', async () => {
    mocks.getContentRuntimeConfig.mockReturnValue({ content: { revalidate: { token: 'secret' } } })
    const handler = (await import('../../packages/content/src/runtime/server/api/revalidate')).default
    const body = JSON.stringify({ paths: ['/docs/a'] })
    const event = {
      ...createTestEvent(),
      method: 'POST',
      node: {
        req: {
          method: 'POST',
          url: '/',
          headers: await signedHeaders(body, { timestamp: Date.now() - 10 * 60 * 1000 }),
          rawBody: body,
          [Symbol.asyncIterator]: async function * () {
            yield Buffer.from(body)
          }
        }
      }
    } as any

    await expect(handler(event)).rejects.toMatchObject({
      statusCode: 401,
      statusMessage: 'stale_revalidation_signature'
    })
    expect(mocks.getContentProvider).not.toHaveBeenCalled()
  })

  test('accepts signed revalidation requests without exposing the shared secret as a token header', async () => {
    mocks.getContentRuntimeConfig.mockReturnValue({ content: { revalidate: { token: 'secret' } } })
    const invalidate = vi.fn()
    mocks.getContentProvider.mockResolvedValue({ invalidate })
    const handler = (await import('../../packages/content/src/runtime/server/api/revalidate')).default
    const body = JSON.stringify({ paths: ['/docs/a'] })
    const event = {
      ...createTestEvent(),
      method: 'POST',
      node: {
        req: {
          method: 'POST',
          url: '/',
          headers: await signedHeaders(body),
          rawBody: body,
          [Symbol.asyncIterator]: async function * () {
            yield Buffer.from(body)
          }
        }
      }
    } as any

    await expect(handler(event)).resolves.toEqual({
      ok: true,
      tags: [],
      paths: ['/docs/a']
    })
    expect(invalidate).toHaveBeenCalledWith(event, {
      tags: undefined,
      paths: ['/docs/a']
    })
  })
})
