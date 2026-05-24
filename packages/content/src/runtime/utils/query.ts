import { type H3Event, createError } from 'h3'
import type { ContentQueryBuilderParams } from '../../types/query'
import { decodeQueryParams, encodeQueryParams, ensureQueryWhereArray, findQueryWhere, collectQueryWhere, normalizeContentQueryParams } from '../../core/query/params'

const safeDecodeQueryParams = (encoded: string) => {
  try {
    return decodeQueryParams(encoded)
  } catch {
    throw createError({ statusCode: 400, message: 'Invalid _params query' })
  }
}

export const getContentQuery = (event: H3Event): ContentQueryBuilderParams => {
  const encoded = event.context.params?.params

  if (!encoded) {
    return {}
  }

  const normalized = encoded.replace(/\.json$/, '').replace(/^[^/]+\//, '')
  return safeDecodeQueryParams(normalized)
}
export { collectQueryWhere, decodeQueryParams, encodeQueryParams, ensureQueryWhereArray, findQueryWhere, normalizeContentQueryParams }
