import { createError, defineEventHandler, getHeader, readRawBody } from 'h3'
import type { ContentCacheInvalidateInput } from '../../../public/provider'
import { getContentCacheAdapter } from '../cache-adapter'
import { getContentProvider } from '../providers'
import { getContentRuntimeConfig } from '../runtime-config'

const normalizePath = (path: string) => {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return normalized.replace(/\/{2,}/g, '/')
}

const normalizeStringList = (value: unknown, normalize: (value: string) => string = value => value) =>
  Array.isArray(value)
    ? Array.from(new Set(value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map(entry => normalize(entry.trim()))))
    : undefined

const SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000

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

async function verifySignature(event: Parameters<typeof getHeader>[0], token: string, rawBody: string) {
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

  const expected = `sha256=${await hmacSha256Hex(token, `${timestampHeader}.${eventId}.${rawBody}`)}`
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

function parseJsonBody(bodyText: string) {
  try {
    return JSON.parse(bodyText) as Record<string, unknown> | undefined
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'invalid_revalidation_body',
      message: 'Content revalidation body must be valid JSON.'
    })
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

  const rawBody = await readRawBody(event).catch(() => undefined)
  const bodyText = typeof rawBody === 'string' ? rawBody : rawBody === undefined ? undefined : String(rawBody)
  if (!bodyText) {
    throw createError({
      statusCode: 400,
      statusMessage: 'missing_revalidation_body',
      message: 'Content revalidation requires a JSON body.'
    })
  }

  if (hasSignatureHeaders(event)) {
    await verifySignature(event, token, bodyText)
  } else if (allowUnsigned) {
    verifyUnsignedToken(event, token)
  } else {
    throw createError({
      statusCode: 401,
      statusMessage: 'missing_revalidation_signature',
      message: 'Signed content revalidation requires signature, timestamp, and event headers.'
    })
  }

  const body = parseJsonBody(bodyText)
  const input: ContentCacheInvalidateInput = {
    tags: normalizeStringList(body?.tags),
    paths: normalizeStringList(body?.paths, normalizePath)
  }

  if (!input.tags?.length && !input.paths?.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'missing_revalidation_target',
      message: 'Provide at least one cache tag or path to revalidate.'
    })
  }

  const provider = await getContentProvider(event)
  const adapter = await getContentCacheAdapter()
  let handled = false

  if (typeof provider.invalidate === 'function') {
    await provider.invalidate(event, input)
    handled = true
  }

  if (adapter) {
    await adapter.invalidate(input)
    handled = true
  }

  if (!handled) {
    throw createError({
      statusCode: 501,
      statusMessage: 'revalidation_not_supported',
      message: 'The active content provider/cache adapter does not support revalidation.'
    })
  }


  return {
    ok: true,
    tags: input.tags || [],
    paths: input.paths || []
  }
})
