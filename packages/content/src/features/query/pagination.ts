import type { ParsedContent } from '../../types/content'
import type { ContentCollectionHandle } from '../../types/config'
import type {
  CursorPaginationResult,
  DocumentFromHandle,
  LocalizedDoc,
  OffsetPaginationResult,
  OneOptions,
  PaginationOptions,
  PaginationResult,
  PopulateFromOptions,
  PopulateSpec,
  PopulatedDocument,
  QueryWhere
} from '../../types/query'
import { compileQueryParams } from '../../core/query/filter'
import { decorateLocalizedDocument } from './localized-docs'
import type { ContentQueryContext } from './context'
import { ensureCollectionName } from './handles'
import { resolveFallback } from './locale-options'
import { populateDocument, selectWithPopulate, validatePopulateSpec } from './populate'
import {
  assertPublicPagingLimit,
  DEFAULT_PUBLIC_PAGINATION_LIMIT,
  MAX_PUBLIC_QUERY_CURSOR_BYTES,
  MAX_PUBLIC_QUERY_SKIP
} from '../../core/query/limits'
import { unwrapCursorFindResponse, unwrapFindResponse } from './responses'
import { isNotFoundError } from './errors'

type OneResolver = <H extends ContentCollectionHandle | string>(
  context: ContentQueryContext,
  handle: H,
  options: OneOptions<H>
) => Promise<LocalizedDoc<ParsedContent> | null>

const resolvePage = (value: unknown): number => {
  if (value === undefined) return 1
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new TypeError('Content pagination page must be a positive finite integer.')
  }
  return value
}

const emptyOffsetPage = (page: number, limit: number): OffsetPaginationResult<never> => ({
  mode: 'offset',
  data: [],
  page,
  limit,
  total: 0,
  pageCount: 0,
  hasNext: false,
  hasPrevious: page > 1,
  nextPage: null,
  previousPage: page > 1 ? page - 1 : null
})

const emptyCursorPage = (limit: number): CursorPaginationResult<never> => ({
  mode: 'cursor',
  data: [],
  limit,
  endCursor: null,
  hasNext: false
})

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
  one: OneResolver,
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

  if (mode === 'cursor') {
    if (options.after !== undefined && options.after !== null) {
      if (typeof options.after !== 'string') {
        throw new TypeError('Content pagination cursor must be a string or null.')
      }
      if (new TextEncoder().encode(options.after).length > MAX_PUBLIC_QUERY_CURSOR_BYTES) {
        throw new TypeError(`Content pagination cursor exceeds ${MAX_PUBLIC_QUERY_CURSOR_BYTES} bytes.`)
      }
    }
    const params = compileQueryParams({
      collection,
      where: options.where as QueryWhere | undefined,
      sort: options.sort,
      locale: options.locale,
      fallback,
      select
    })
    params.paging = { mode: 'cursor', after: options.after ?? null, limit }

    let response: unknown
    try {
      response = await context.transport('query', params)
    } catch (error) {
      if (isNotFoundError(error)) {
        return emptyCursorPage(limit) as PaginationResult<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>>
      }
      throw error
    }

    const envelope = unwrapCursorFindResponse<ParsedContent>(response)
    const decorated = envelope.result
      .map(doc => decorateLocalizedDocument(doc, collection, runtime, options.locale))
      .filter((doc): doc is LocalizedDoc<ParsedContent> => Boolean(doc))
    const populated = await Promise.all(decorated.map(doc => populateDocument(context, one, doc, options.populate, options.locale, options.fallback)))

    return {
      mode: 'cursor',
      data: populated as unknown as Array<LocalizedDoc<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>>>,
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
  const params = compileQueryParams({
    collection,
    where: options.where as QueryWhere | undefined,
    sort: options.sort,
    locale: options.locale,
    fallback,
    select
  })
  params.paging = { mode: 'offset', skip, limit }
  let response: unknown
  try {
    response = await context.transport('query', params)
  } catch (error) {
    if (isNotFoundError(error)) {
      return emptyOffsetPage(page, limit) as PaginationResult<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>>
    }
    throw error
  }

  const envelope = unwrapFindResponse<ParsedContent>(response)
  const decorated = envelope.result
    .map(doc => decorateLocalizedDocument(doc, collection, runtime, options.locale))
    .filter((doc): doc is LocalizedDoc<ParsedContent> => Boolean(doc))
  const populated = await Promise.all(decorated.map(doc => populateDocument(context, one, doc, options.populate, options.locale, options.fallback)))
  const pageCount = envelope.total > 0 ? Math.ceil(envelope.total / limit) : 0

  return {
    mode: 'offset',
    data: populated as unknown as Array<LocalizedDoc<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>>>,
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
