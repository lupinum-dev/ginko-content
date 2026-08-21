import { type H3Event, createError } from 'h3'
import type { ContentQueryTransportInput } from '../../types/query'
import { decodeQueryParams, encodeQueryParams } from '../../core/query/params'

const safeDecodeQueryParams = (encoded: string) => {
  try {
    return decodeQueryParams(encoded)
  } catch {
    throw createError({ statusCode: 400, message: 'Invalid _params query' })
  }
}

export const getContentQuery = (event: H3Event): ContentQueryTransportInput => {
  const encoded = event.context.params?.params

  if (!encoded) {
    return {}
  }

  const normalized = encoded.replace(/\.json$/, '').replace(/^[^/]+\//, '')
  return safeDecodeQueryParams(normalized)
}
export { decodeQueryParams, encodeQueryParams }
