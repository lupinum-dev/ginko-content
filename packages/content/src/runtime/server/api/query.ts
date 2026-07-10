import { createError, defineEventHandler } from 'h3'
import { getContentQuery } from '../../utils/query'
import { getContentProvider } from '../providers'
import { createProviderQuery, normalizeProviderQueryResponse } from '../provider-query'
import { isOversizedQueryRequestBody, validateContentQueryRequestBody } from '../query-http-validation'

/**
 * Typed 400 for a closed-boundary rejection (VNEXT.md 16.4). No internal
 * stack trace or echo of the full untrusted request — just the offending
 * path and reason.
 */
const invalidContentQueryRequest = (path: string, reason: string) => createError({
  statusCode: 400,
  statusMessage: 'invalid_content_query_request',
  message: `Invalid content query request at ${path}: ${reason}`,
  data: { code: 'invalid_content_query_request', path, reason }
})

export default defineEventHandler(async (event) => {
  // This endpoint is GET with the payload embedded in the URL path segment
  // (there is no request body to measure) — the encoded segment is the
  // transport-safety equivalent of a request body and is bounded the same
  // way (VNEXT.md 16.2).
  const encoded = event.context.params?.params
  if (typeof encoded === 'string' && isOversizedQueryRequestBody(encoded)) {
    throw invalidContentQueryRequest('$', 'Request payload is too large.')
  }

  // `getContentQuery` already rejects malformed base64/JSON with a 400
  // (parsing JSON is not validation); this closes the untrusted shape itself —
  // unknown keys, filter depth/operator/pagination shape, selection/sort
  // bounds — BEFORE lowering or provider dispatch ever run.
  const decoded = getContentQuery(event)
  const validated = validateContentQueryRequestBody(decoded)
  if (!validated.ok) {
    throw invalidContentQueryRequest(validated.error.path, validated.error.reason)
  }

  const query = validated.value
  const provider = await getContentProvider(event)
  return normalizeProviderQueryResponse(query, await provider.query(event, createProviderQuery(query)), provider.name)
})
