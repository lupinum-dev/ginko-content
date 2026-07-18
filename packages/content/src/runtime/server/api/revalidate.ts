import { createError, defineEventHandler, getHeader, getRequestWebStream } from 'h3'
import type { H3Event } from 'h3'
import type { ContentCacheInvalidateInput } from '../../../public/provider'
import { getContentCacheAdapter } from '../cache-adapter'
import { getContentRuntimeConfig } from '../runtime-config'

export const MAX_REVALIDATION_REQUEST_BYTES = 32_768
export const MAX_REVALIDATION_TARGET_COUNT = 200
export const MAX_REVALIDATION_TARGET_LENGTH = 1_000

const normalizePath = (path: string) => {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return normalized.replace(/\/{2,}/g, '/')
}

function invalidBody(message: string) {
  return createError({
    statusCode: 400,
    statusMessage: 'invalid_revalidation_body',
    message
  })
}

function bodyTooLarge() {
  return createError({
    statusCode: 413,
    statusMessage: 'revalidation_body_too_large',
    message: `Content revalidation body must not exceed ${MAX_REVALIDATION_REQUEST_BYTES} bytes.`
  })
}

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

function toBytes(value: unknown): Uint8Array {
  if (typeof value === 'string') return encoder.encode(value)
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  throw invalidBody('Content revalidation body must be UTF-8 JSON.')
}

function concatChunks(chunks: Uint8Array[], byteLength: number) {
  const body = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

async function readBoundedStream(source: ReadableStream<unknown>) {
  const reader = source.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = toBytes(value)
      byteLength += chunk.byteLength
      if (byteLength > MAX_REVALIDATION_REQUEST_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw bodyTooLarge()
      }
      chunks.push(chunk)
    }
  } finally {
    reader.releaseLock()
  }
  return concatChunks(chunks, byteLength)
}

async function readBoundedRawBody(event: H3Event) {
  const contentLength = Number(getHeader(event, 'content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_REVALIDATION_REQUEST_BYTES) {
    throw bodyTooLarge()
  }

  const stream = getRequestWebStream(event)
  return stream ? readBoundedStream(stream) : undefined
}

function normalizeStringList(
  value: unknown,
  field: 'tags' | 'paths',
  normalize: (value: string) => string = value => value
) {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw invalidBody(`${field} must be an array of non-empty strings.`)
  return Array.from(new Set(value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      throw invalidBody(`${field}[${index}] must be a non-empty string.`)
    }
    const normalized = normalize(entry.trim())
    if (normalized.length > MAX_REVALIDATION_TARGET_LENGTH) {
      throw invalidBody(`${field}[${index}] must not exceed ${MAX_REVALIDATION_TARGET_LENGTH} characters.`)
    }
    return normalized
  })))
}

const SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000

async function hmacSha256Hex(secret: string, value: Uint8Array) {
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await globalThis.crypto.subtle.sign('HMAC', key, new Uint8Array(value))
  return Array.from(new Uint8Array(signature))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

function constantTimeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left)
  const rightBytes = new TextEncoder().encode(right)
  let difference = leftBytes.length ^ rightBytes.length
  const length = Math.max(leftBytes.length, rightBytes.length)
  for (let index = 0; index < length; index++) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0)
  }
  return difference === 0
}

async function verifySignature(event: Parameters<typeof getHeader>[0], token: string, rawBody: Uint8Array) {
  const timestampHeader = getHeader(event, 'x-ginko-signature-timestamp')
  const signatureHeader = getHeader(event, 'x-ginko-signature')
  const eventId = getHeader(event, 'x-ginko-revalidation-event')
  if (!timestampHeader || !signatureHeader || !eventId) {
    throw createError({
      statusCode: 401,
      statusMessage: 'missing_revalidation_signature',
      message: 'Signed content revalidation requires signature, timestamp, and event headers.'
    })
  }

  const timestamp = Number(timestampHeader)
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > SIGNATURE_TOLERANCE_MS) {
    throw createError({
      statusCode: 401,
      statusMessage: 'stale_revalidation_signature',
      message: 'Content revalidation signature timestamp is outside the accepted window.'
    })
  }

  const prefix = encoder.encode(`${timestampHeader}.${eventId}.`)
  const signedBytes = new Uint8Array(prefix.byteLength + rawBody.byteLength)
  signedBytes.set(prefix)
  signedBytes.set(rawBody, prefix.byteLength)
  const expected = `sha256=${await hmacSha256Hex(token, signedBytes)}`
  if (!constantTimeEqual(signatureHeader, expected)) {
    throw createError({
      statusCode: 401,
      statusMessage: 'invalid_revalidation_signature',
      message: 'Invalid content revalidation signature.'
    })
  }
}

function hasSignatureHeaders(event: Parameters<typeof getHeader>[0]) {
  return Boolean(
    getHeader(event, 'x-ginko-signature-timestamp') ||
    getHeader(event, 'x-ginko-signature') ||
    getHeader(event, 'x-ginko-revalidation-event')
  )
}

function verifyUnsignedToken(event: Parameters<typeof getHeader>[0], token: string) {
  const headerToken = getHeader(event, 'x-ginko-revalidate-token')
  const bearerToken = getHeader(event, 'authorization')?.replace(/^Bearer\s+/i, '')
  if (headerToken !== token && bearerToken !== token) {
    throw createError({
      statusCode: 401,
      statusMessage: 'invalid_revalidation_token',
      message: 'Invalid content revalidation token.'
    })
  }
}

function parseJsonBody(bodyBytes: Uint8Array) {
  try {
    const bodyText = decoder.decode(bodyBytes)
    const body = JSON.parse(bodyText) as unknown
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw invalidBody('Content revalidation body must be a JSON object.')
    }
    return body as Record<string, unknown>
  } catch {
    throw invalidBody('Content revalidation body must be a valid JSON object.')
  }
}

export default defineEventHandler(async (event) => {
  const revalidateConfig = getContentRuntimeConfig().content?.revalidate
  const token = revalidateConfig && revalidateConfig !== false ? revalidateConfig.token : undefined
  const allowUnsigned = revalidateConfig && revalidateConfig !== false ? revalidateConfig.allowUnsigned === true : false
  if (!token) {
    throw createError({
      statusCode: 404,
      statusMessage: 'revalidation_disabled',
      message: 'Content revalidation is disabled.'
    })
  }

  const bodyBytes = await readBoundedRawBody(event)
  if (!bodyBytes?.byteLength) {
    throw createError({
      statusCode: 400,
      statusMessage: 'missing_revalidation_body',
      message: 'Content revalidation requires a JSON body.'
    })
  }

  if (hasSignatureHeaders(event)) {
    await verifySignature(event, token, bodyBytes)
  } else if (allowUnsigned) {
    verifyUnsignedToken(event, token)
  } else {
    throw createError({
      statusCode: 401,
      statusMessage: 'missing_revalidation_signature',
      message: 'Signed content revalidation requires signature, timestamp, and event headers.'
    })
  }

  const body = parseJsonBody(bodyBytes)
  if (Object.keys(body).some(key => key !== 'tags' && key !== 'paths')) {
    throw invalidBody('Content revalidation body may only contain tags and paths.')
  }
  const targetCount = (Array.isArray(body.tags) ? body.tags.length : 0) + (Array.isArray(body.paths) ? body.paths.length : 0)
  if (targetCount > MAX_REVALIDATION_TARGET_COUNT) {
    throw invalidBody(`Content revalidation accepts at most ${MAX_REVALIDATION_TARGET_COUNT} tag and path entries per request.`)
  }
  const input: ContentCacheInvalidateInput = {
    tags: normalizeStringList(body.tags, 'tags'),
    paths: normalizeStringList(body.paths, 'paths', normalizePath)
  }

  if (!input.tags?.length && !input.paths?.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'missing_revalidation_target',
      message: 'Provide at least one cache tag or path to revalidate.'
    })
  }

  const adapter = await getContentCacheAdapter()
  if (!adapter) {
    throw createError({
      statusCode: 501,
      statusMessage: 'revalidation_not_supported',
      message: 'The configured Content cache adapter does not support revalidation.'
    })
  }
  await adapter.invalidate(input)
  return {
    ok: true,
    tags: input.tags || [],
    paths: input.paths || []
  }
})
