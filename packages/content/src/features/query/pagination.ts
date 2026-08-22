import type { ParsedContent } from '../../types/content'
import type { ContentCollectionHandle } from '../../types/config'
import type {
  ContentQueryTransportInput,
  DocumentFromHandle,
  LocalizedDoc,
  PaginationOptions,
  PaginationResult,
  PopulateFromOptions,
  PopulateSpec,
  PopulatedDocument,
  QueryWhere
} from '../../types/query'
import { compileQueryParams } from '../../core/query/filter'
import type { ContentQueryContext } from './context'
import { ensureCollectionName } from './handles'
import { resolveFallback } from './locale-options'
import { selectWithPopulate, serializePopulateSpec, validatePopulateSpec } from './populate'
import {
  assertPublicPagingLimit,
  DEFAULT_PUBLIC_PAGINATION_LIMIT,
  MAX_PUBLIC_QUERY_CURSOR_BYTES,
  MAX_PUBLIC_QUERY_SKIP
} from '../../core/query/limits'
import { unwrapCursorFindResponse, unwrapFindResponse } from './responses'
import { withNotFoundFallback } from './errors'

const resolvePage = (value: unknown): number => {
  if (value === undefined) return 1
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new TypeError('Content pagination page must be a positive finite integer.')
  }
  return value
}

/**
 * Resolve one honest pagination page. Two discriminated
 * modes: `offset` (exact `total`/`pageCount`) and `cursor` (opaque forward
 * cursor, no synthetic total). Omitting `mode` while supplying `page` means
 * `mode: 'offset'` — the source-compatible default.
 */
export async function resolvePagination<
  const H extends ContentCollectionHandle | string,
  O extends PaginationOptions<H, PopulateSpec | undefined>
>(
  context: ContentQueryContext,
  handle: H,
  options: O
): Promise<PaginationResult<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>>> {
  const collection = ensureCollectionName(handle)
  const runtime = context.runtime
  validatePopulateSpec(handle, collection, runtime, options.populate)
  const fallback = resolveFallback(options.fallback, collection, runtime)
  if (options.mode !== undefined && options.mode !== 'offset' && options.mode !== 'cursor') {
    throw new TypeError('Content pagination mode must be "offset" or "cursor".')
  }
  const mode = options.mode ?? 'offset'
  if (mode === 'cursor' && options.page !== undefined) {
    throw new TypeError('Content cursor pagination does not accept an offset page.')
  }
  if (mode === 'offset' && options.after !== undefined) {
    throw new TypeError('Content offset pagination does not accept a cursor.')
  }
  const limit = options.limit ?? DEFAULT_PUBLIC_PAGINATION_LIMIT
  assertPublicPagingLimit(limit)
  const select = selectWithPopulate(options.select as ReadonlyArray<string> | undefined, options.populate)
  const baseParams: ContentQueryTransportInput = {
    ...compileQueryParams({
      collection,
      where: options.where as QueryWhere | undefined,
      sort: options.sort,
      locale: options.locale,
      fallback,
      select
    }),
    ...(options.populate ? { populate: serializePopulateSpec(options.populate) } : {})
  }

  if (mode === 'cursor') {
    if (options.after !== undefined && options.after !== null) {
      if (typeof options.after !== 'string') {
        throw new TypeError('Content pagination cursor must be a string or null.')
      }
      if (new TextEncoder().encode(options.after).length > MAX_PUBLIC_QUERY_CURSOR_BYTES) {
        throw new TypeError(`Content pagination cursor exceeds ${MAX_PUBLIC_QUERY_CURSOR_BYTES} bytes.`)
      }
    }
    const params: ContentQueryTransportInput = {
      ...baseParams,
      paging: { mode: 'cursor', after: options.after ?? null, limit }
    }
    const response = await withNotFoundFallback<unknown>(
      () => context.transport('query', params),
      { mode: 'cursor', result: [], limit, pageInfo: { endCursor: null, hasNext: false } }
    )

    const envelope = unwrapCursorFindResponse<LocalizedDoc<ParsedContent>>(response)
    return {
      mode: 'cursor',
      data: envelope.result as unknown as Array<LocalizedDoc<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>>>,
      limit: envelope.limit,
      endCursor: envelope.endCursor,
      hasNext: envelope.hasNext
    } as PaginationResult<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>>
  }

  const page = resolvePage(options.page)
  const skip = (page - 1) * limit
  if (!Number.isSafeInteger(skip) || skip > MAX_PUBLIC_QUERY_SKIP) {
    throw new TypeError(`Content pagination page exceeds the maximum query skip of ${MAX_PUBLIC_QUERY_SKIP}.`)
  }
  const params: ContentQueryTransportInput = {
    ...baseParams,
    paging: { mode: 'offset', skip, limit }
  }
  const response = await withNotFoundFallback<unknown>(
    () => context.transport('query', params),
    { result: [], skip, limit, total: 0 }
  )

  const envelope = unwrapFindResponse<LocalizedDoc<ParsedContent>>(response)
  const pageCount = envelope.total > 0 ? Math.ceil(envelope.total / limit) : 0

  return {
    mode: 'offset',
    data: envelope.result as unknown as Array<LocalizedDoc<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>>>,
    page,
    limit,
    total: envelope.total,
    pageCount,
    hasNext: page < pageCount,
    hasPrevious: page > 1,
    nextPage: page < pageCount ? page + 1 : null,
    previousPage: page > 1 ? page - 1 : null
  } as PaginationResult<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>>
}
