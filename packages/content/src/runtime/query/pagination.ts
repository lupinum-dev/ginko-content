import type { ParsedContent } from '../../types/content'
import type { ContentCollectionHandle } from '../../types/config'
import type {
  DocumentFromHandle,
  LocalizedDoc,
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
import { unwrapCountResponse, unwrapFindResponse } from './responses'
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
  const requestedPage = normalizePositiveInteger(options.page, 1)
  const limit = Math.min(normalizePositiveInteger(options.limit, 10), MAX_PUBLIC_QUERY_LIMIT)
  const skip = Math.min((requestedPage - 1) * limit, MAX_PUBLIC_QUERY_SKIP)
  const page = Math.floor(skip / limit) + 1
  const fallback = resolveFallback(options.fallback, collection, runtime)
  const params = compileQueryParams({
    collection,
    where: options.where as QueryWhere | undefined,
    sort: options.sort,
    limit,
    skip,
    locale: options.locale,
    fallback,
    select: selectWithPopulate(options.select as ReadonlyArray<string> | undefined, options.populate)
  })
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
      return {
        data: [],
        page,
        limit,
        total: 0,
        pageCount: 0,
        hasNext: false,
        hasPrev: page > 1,
        nextPage: null,
        prevPage: page > 1 ? page - 1 : null
      }
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
    .map(doc => decorateLocalizedDocument(doc as ParsedContent, collection, runtime, options.locale))
    .filter((doc): doc is LocalizedDoc<ParsedContent> => Boolean(doc))
  const populated = await Promise.all(decorated.map(doc => populateDocument(context, one, doc, options.populate, options.locale, options.fallback)))
  const pageCount = total > 0 ? Math.ceil(total / limit) : 0

  return {
    data: populated as Array<LocalizedDoc<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>>>,
    page,
    limit,
    total,
    pageCount,
    hasNext: page < pageCount,
    hasPrev: page > 1,
    nextPage: page < pageCount ? page + 1 : null,
    prevPage: page > 1 ? page - 1 : null
  }
}
