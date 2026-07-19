import { createError, defineEventHandler } from 'h3'
import { getContentQuery } from '../../utils/query'
import { getContentProvider } from '../providers'
import {
  assertConfiguredProviderCollection,
  createProviderQuery,
  normalizeProviderQueryResponse
} from '../provider-query'
import { isOversizedQueryRequestBody, validateContentQueryRequestBody } from '../query-http-validation'
import { projectPublicQueryResponse } from '../../../features/query/responses'

/**
 * Typed 400 for a closed-boundary rejection. No internal
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
  // way.
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
  if (!query.collection) {
    throw invalidContentQueryRequest('$.collection', 'collection is required for the public query endpoint.')
  }
  try {
    assertConfiguredProviderCollection(query.collection)
  } catch {
    throw invalidContentQueryRequest('$.collection', 'collection must name a configured content collection.')
  }
  const provider = await getContentProvider(event)
  const response = normalizeProviderQueryResponse(query, await provider.query(event, createProviderQuery(query)), provider.name)
  return projectPublicQueryResponse(response, query.first === true)
})
