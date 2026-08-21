import { createError, getMethod, readRawBody } from 'h3'
import type { H3Event } from 'h3'
import type { ContentProviderQueryInput } from '../../types/query'
import { getContentQuery } from '../utils/query'
import { isOversizedQueryRequestBody } from './query-http-validation'

/**
 * Typed 400 for a closed-boundary rejection. No internal
 * stack trace or echo of the full untrusted request — just the offending
 * path and reason.
 */
export const invalidContentQueryRequest = (path: string, reason: string) => createError({
  statusCode: 400,
  statusMessage: 'invalid_content_query_request',
  message: `Invalid content query request at ${path}: ${reason}`,
  data: { code: 'invalid_content_query_request', path, reason }
})

const oversized = () => invalidContentQueryRequest('$', 'Request payload is too large.')

/**
 * Decode the content query request from either transport:
 *
 * - GET carries the base64url-encoded payload in the `**:params` path
 *   segment (cacheable, prerender-seedable).
 * - POST carries the JSON payload in the request body for queries that grow
 *   beyond safe URL length. The body is bounded by the same byte budget as
 *   the encoded path segment.
 */
export const readContentQueryRequest = async (event: H3Event): Promise<ContentProviderQueryInput> => {
  const encoded = event.context.params?.params

  if (typeof encoded === 'string') {
    if (isOversizedQueryRequestBody(encoded)) {
      throw oversized()
    }
    // `getContentQuery` already rejects malformed base64/JSON with a 400.
    return getContentQuery(event)
  }

  if (getMethod(event) === 'GET') {
    return {}
  }

  const raw = await readRawBody(event)
  if (!raw) {
    throw invalidContentQueryRequest('$', 'A POST content query requires a JSON body.')
  }
  if (isOversizedQueryRequestBody(raw)) {
    throw oversized()
  }
  try {
    return JSON.parse(raw) as ContentProviderQueryInput
  } catch {
    throw invalidContentQueryRequest('$', 'Request body must be valid JSON.')
  }
}
