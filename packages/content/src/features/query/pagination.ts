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
import { MAX_PUBLIC_QUERY_LIMIT, MAX_PUBLIC_QUERY_SKIP } from './public-limits'
import { unwrapCountResponse, unwrapCursorFindResponse, unwrapFindResponse } from './responses'
import { isNotFoundError } from './errors'

type OneResolver = <H extends ContentCollectionHandle | string>(
  context: ContentQueryContext,
  handle: H,
  options: OneOptions<H>
) => Promise<LocalizedDoc<ParsedContent> | null>

const normalizePositiveInteger = (value: unknown, fallback: number) => {
  const number = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
  return Math.max(1, number)
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
  // Source compatibility: omitting `mode` always means
  // `mode: 'offset'`, even when `after` happens to be set — new code should
  // write `mode: 'cursor'` explicitly rather than relying on inference.
  const mode = options.mode ?? 'offset'
  const limit = Math.min(normalizePositiveInteger(options.limit, 10), MAX_PUBLIC_QUERY_LIMIT)
  const select = selectWithPopulate(options.select as ReadonlyArray<string> | undefined, options.populate)

  if (mode === 'cursor') {
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

  const requestedPage = normalizePositiveInteger(options.page, 1)
  const skip = Math.min((requestedPage - 1) * limit, MAX_PUBLIC_QUERY_SKIP)
  const page = Math.floor(skip / limit) + 1
  const params = compileQueryParams({
    collection,
    where: options.where as QueryWhere | undefined,
    sort: options.sort,
    limit,
    skip,
    locale: options.locale,
    fallback,
    select
  })
  params.paging = { mode: 'offset', skip, limit }
  const countParams = compileQueryParams({
    collection,
    where: options.where as QueryWhere | undefined,
    locale: options.locale,
    fallback
  })
  countParams.count = true

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
  let total = envelope.total
  if (!envelope.hasTotal) {
    const countResponse = await context.transport('query', countParams)
    total = unwrapCountResponse(countResponse) ?? envelope.total
  }
  const decorated = envelope.result
    .map(doc => decorateLocalizedDocument(doc, collection, runtime, options.locale))
    .filter((doc): doc is LocalizedDoc<ParsedContent> => Boolean(doc))
  const populated = await Promise.all(decorated.map(doc => populateDocument(context, one, doc, options.populate, options.locale, options.fallback)))
  const pageCount = total > 0 ? Math.ceil(total / limit) : 0

  return {
    mode: 'offset',
    data: populated as unknown as Array<LocalizedDoc<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>>>,
    page,
    limit,
    total,
    pageCount,
    hasNext: page < pageCount,
    hasPrevious: page > 1,
    nextPage: page < pageCount ? page + 1 : null,
    previousPage: page > 1 ? page - 1 : null
  } as PaginationResult<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>>
}
