import { createError, defineEventHandler } from 'h3'
import { getContentQuery } from '../../utils/query'
import { assertConfiguredProviderCollection } from '../provider-query'
import { isOversizedQueryRequestBody, validateContentQueryRequestBody } from '../query-http-validation'
import { createServerContentQueryContext } from '../query-api'
import { getContentRuntimeConfig } from '../runtime-config'
import { validatePopulateSpec } from '../../../features/query/populate'

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

  // `getContentQuery` already rejects malformed base64/JSON with a 400.
  // This applies HTTP resource bounds, then delegates the accepted language
  // to the canonical query lowerer before provider dispatch.
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
  try {
    validatePopulateSpec(
      query.collection,
      query.collection,
      getContentRuntimeConfig().content || {},
      query.populate
    )
  } catch (error) {
    throw invalidContentQueryRequest(
      '$.populate',
      error instanceof Error
        ? error.message
        : 'populate must use declared reference fields and configured target collections.'
    )
  }
  const context = await createServerContentQueryContext(event)
  return await context.transport('query', query)
})
