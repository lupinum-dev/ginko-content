import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createTestEvent } from '../harness/event'

const mocks = vi.hoisted(() => ({
  getContentCacheAdapter: vi.fn(),
  getContentRuntimeConfig: vi.fn()
}))

vi.mock('../../packages/content/src/runtime/server/cache-adapter', () => ({
  getContentCacheAdapter: mocks.getContentCacheAdapter
}))

vi.mock('../../packages/content/src/runtime/server/runtime-config', () => ({
  getContentRuntimeConfig: mocks.getContentRuntimeConfig
}))

async function hmacSha256Hex(secret: string, value: Uint8Array) {
  const encoder = new TextEncoder()
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await globalThis.crypto.subtle.sign('HMAC', key, value)
  return Array.from(new Uint8Array(signature))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function signedHeaders(body: string | Uint8Array, options?: { token?: string; eventId?: string; timestamp?: number }) {
  const encoder = new TextEncoder()
  const token = options?.token ?? 'secret'
  const eventId = options?.eventId ?? 'event_123'
  const timestamp = String(options?.timestamp ?? Date.now())
  const bodyBytes = typeof body === 'string' ? encoder.encode(body) : body
  const prefix = encoder.encode(`${timestamp}.${eventId}.`)
  const signedBytes = new Uint8Array(prefix.byteLength + bodyBytes.byteLength)
  signedBytes.set(prefix)
  signedBytes.set(bodyBytes, prefix.byteLength)
  const signature = await hmacSha256Hex(token, signedBytes)
  return {
    'content-length': String(bodyBytes.byteLength),
    'content-type': 'application/json',
    'x-ginko-revalidation-event': eventId,
    'x-ginko-signature': `sha256=${signature}`,
    'x-ginko-signature-timestamp': timestamp
  }
}

function unsignedNodeEvent(
  body: string,
  options: { contentLength?: number | false; chunks?: string[]; onRead?: () => void } = {}
) {
  const contentLength = options.contentLength === false ? undefined : options.contentLength ?? new TextEncoder().encode(body).byteLength
  const chunks = options.chunks ?? [body]
  let chunkIndex = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      options.onRead?.()
      const chunk = chunks[chunkIndex++]
      if (chunk === undefined) {
        controller.close()
        return
      }
      controller.enqueue(new TextEncoder().encode(chunk))
    }
  }, { highWaterMark: 0 })
  return {
    ...createTestEvent(),
    method: 'POST',
    node: {
      req: {
        method: 'POST',
        url: '/',
        headers: {
          ...(contentLength === undefined
            ? { 'transfer-encoding': 'chunked' }
            : { 'content-length': String(contentLength) }),
          'content-type': 'application/json',
          'x-ginko-revalidate-token': 'secret'
        }
      }
    },
    web: {
      request: { body: stream }
    }
  } as any
}

describe('runtime revalidate API boundary', () => {
  beforeEach(() => {
    mocks.getContentCacheAdapter.mockReset()
    mocks.getContentCacheAdapter.mockResolvedValue(undefined)
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
  })

  test('accepts a raw body exactly at the byte limit', async () => {
    const {
      default: handler,
      MAX_REVALIDATION_REQUEST_BYTES
    } = await import('../../packages/content/src/runtime/server/api/revalidate')
    const invalidate = vi.fn()
    mocks.getContentCacheAdapter.mockResolvedValue({
      name: 'test-cache',
      apply: vi.fn(),
      invalidate
    })
    const json = JSON.stringify({ tags: ['entry:docs:a'] })
    const body = json + ' '.repeat(MAX_REVALIDATION_REQUEST_BYTES - new TextEncoder().encode(json).byteLength)

    await expect(handler(unsignedNodeEvent(body))).resolves.toMatchObject({
      ok: true,
      tags: ['entry:docs:a']
    })
    expect(invalidate).toHaveBeenCalledOnce()
  })

  test('rejects an oversized declared body before consuming it', async () => {
    const {
      default: handler,
      MAX_REVALIDATION_REQUEST_BYTES
    } = await import('../../packages/content/src/runtime/server/api/revalidate')
    let consumed = false
    const event = unsignedNodeEvent('', {
      contentLength: MAX_REVALIDATION_REQUEST_BYTES + 1,
      chunks: [''],
      onRead: () => { consumed = true }
    })

    await expect(handler(event)).rejects.toMatchObject({
      statusCode: 413,
      statusMessage: 'revalidation_body_too_large'
    })
    expect(consumed).toBe(false)
    expect(mocks.getContentCacheAdapter).not.toHaveBeenCalled()
  })

  test('stops an oversized chunked body at the raw-byte limit', async () => {
    const {
      default: handler,
      MAX_REVALIDATION_REQUEST_BYTES
    } = await import('../../packages/content/src/runtime/server/api/revalidate')
    let chunksRead = 0
    const firstChunk = 'x'.repeat(MAX_REVALIDATION_REQUEST_BYTES)
    const event = unsignedNodeEvent('', {
      contentLength: false,
      chunks: [firstChunk, 'x', 'unreachable'],
      onRead: () => { chunksRead += 1 }
    })

    await expect(handler(event)).rejects.toMatchObject({
      statusCode: 413,
      statusMessage: 'revalidation_body_too_large'
    })
    expect(chunksRead).toBe(2)
    expect(mocks.getContentCacheAdapter).not.toHaveBeenCalled()
  })

  test('bounds target cardinality before adapter dispatch', async () => {
    const {
      default: handler,
      MAX_REVALIDATION_TARGET_COUNT
    } = await import('../../packages/content/src/runtime/server/api/revalidate')
    const invalidate = vi.fn()
    mocks.getContentCacheAdapter.mockResolvedValue({
      name: 'test-cache',
      apply: vi.fn(),
      invalidate
    })
    const allowed = Array.from({ length: MAX_REVALIDATION_TARGET_COUNT }, (_, index) => `tag:${index}`)

    await expect(handler(unsignedNodeEvent(JSON.stringify({ tags: allowed })))).resolves.toMatchObject({ ok: true })
    await expect(handler(unsignedNodeEvent(JSON.stringify({ tags: [...allowed, 'tag:overflow'] })))).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'invalid_revalidation_body'
    })
    expect(invalidate).toHaveBeenCalledOnce()
  })

  test('requires bounded non-empty string targets', async () => {
    const {
      default: handler,
      MAX_REVALIDATION_TARGET_LENGTH
    } = await import('../../packages/content/src/runtime/server/api/revalidate')
    const invalidate = vi.fn()
    mocks.getContentCacheAdapter.mockResolvedValue({
      name: 'test-cache',
      apply: vi.fn(),
      invalidate
    })
    const maximumTag = 'x'.repeat(MAX_REVALIDATION_TARGET_LENGTH)

    await expect(handler(unsignedNodeEvent(JSON.stringify({ tags: [maximumTag] })))).resolves.toMatchObject({ ok: true })
    for (const body of [
      { tags: ['x'.repeat(MAX_REVALIDATION_TARGET_LENGTH + 1)] },
      { tags: ['valid', 42] },
      { tags: ['valid'], extra: true },
      { paths: '/docs/a' },
      { paths: ['   '] }
    ]) {
      await expect(handler(unsignedNodeEvent(JSON.stringify(body)))).rejects.toMatchObject({
        statusCode: 400,
        statusMessage: 'invalid_revalidation_body'
      })
    }
    expect(invalidate).toHaveBeenCalledOnce()
  })

  test('passes validated tags and paths once to the configured cache adapter', async () => {
    const invalidate = vi.fn()
    mocks.getContentCacheAdapter.mockResolvedValue({
      name: 'test-cache',
      apply: vi.fn(),
      invalidate,
    })
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
    expect(invalidate).toHaveBeenCalledOnce()
    expect(invalidate).toHaveBeenCalledWith({
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
  })

  test('rejects requests without tags or paths', async () => {
    const handler = (await import('../../packages/content/src/runtime/server/api/revalidate')).default
    const body = JSON.stringify({})
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
  })

  test('fails when no cache adapter supports invalidation', async () => {
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

  test('fails when the configured adapter only applies response headers', async () => {
    mocks.getContentCacheAdapter.mockResolvedValue({
      name: 'headers-only',
      apply: vi.fn()
    })
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
  })

  test('propagates cache adapter invalidation failures', async () => {
    const adapterInvalidate = vi.fn(async () => {
      throw new Error('adapter failed')
    })
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
  })

  test('signs the exact request bytes, including a UTF-8 byte-order mark', async () => {
    mocks.getContentRuntimeConfig.mockReturnValue({ content: { revalidate: { token: 'secret' } } })
    const handler = (await import('../../packages/content/src/runtime/server/api/revalidate')).default
    const body = JSON.stringify({ paths: ['/docs/a'] })
    const encoded = new TextEncoder().encode(body)
    const bytes = new Uint8Array(encoded.byteLength + 3)
    bytes.set([0xEF, 0xBB, 0xBF])
    bytes.set(encoded, 3)
    const event = {
      ...createTestEvent(),
      method: 'POST',
      node: {
        req: {
          method: 'POST',
          url: '/',
          headers: await signedHeaders(body),
          rawBody: bytes
        }
      }
    } as any

    await expect(handler(event)).rejects.toMatchObject({
      statusCode: 401,
      statusMessage: 'invalid_revalidation_signature'
    })
  })

  test('rejects malformed UTF-8 after authenticating the exact bytes', async () => {
    mocks.getContentRuntimeConfig.mockReturnValue({ content: { revalidate: { token: 'secret' } } })
    const handler = (await import('../../packages/content/src/runtime/server/api/revalidate')).default
    const bytes = new Uint8Array([0x7B, 0x22, 0x78, 0x22, 0x3A, 0x22, 0xC3, 0x28, 0x22, 0x7D])
    const event = {
      ...createTestEvent(),
      method: 'POST',
      node: {
        req: {
          method: 'POST',
          url: '/',
          headers: await signedHeaders(bytes),
          rawBody: bytes
        }
      }
    } as any

    await expect(handler(event)).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'invalid_revalidation_body'
    })
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
  })

  test('accepts signed revalidation requests without exposing the shared secret as a token header', async () => {
    mocks.getContentRuntimeConfig.mockReturnValue({ content: { revalidate: { token: 'secret' } } })
    const invalidate = vi.fn()
    mocks.getContentCacheAdapter.mockResolvedValue({
      name: 'test-cache',
      apply: vi.fn(),
      invalidate,
    })
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
    expect(invalidate).toHaveBeenCalledOnce()
    expect(invalidate).toHaveBeenCalledWith({
      tags: undefined,
      paths: ['/docs/a']
    })
  })
})
