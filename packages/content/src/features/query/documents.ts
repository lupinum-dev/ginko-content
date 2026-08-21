import type { ParsedContent } from '../../types/content'
import type { ContentCollectionHandle } from '../../types/config'
import type {
  ContentSelector,
  CountOptions,
  ContentQueryTransportInput,
  DocumentFromHandle,
  LocaleFallback,
  LocalizedDoc,
  ManyOptions,
  OneOptions,
  PopulateFromOptions,
  PopulateSpec,
  PopulatedDocument,
  QueryWhere,
  ResolutionEnvelope,
  ResolveOneOptions,
  ResolveOneResult
} from '../../types/query'
import { compileQueryParams } from '../../core/query/filter'
import type { ContentQueryContext } from './context'
import { isNotFoundError } from './errors'
import { ensureCollectionName } from './handles'
import { resolveFallback } from './locale-options'
import { selectWithPopulate, serializePopulateSpec, validatePopulateSpec } from './populate'
import { unwrapCountResponse, unwrapFindResponse, unwrapOneResponse } from './responses'

const explainResolution = (
  collection: string,
  requestedBy: ContentSelector,
  normalizedBy: ContentSelector,
  requestedLocale: string | undefined,
  requestedFallback: LocaleFallback | undefined,
  doc: LocalizedDoc<ParsedContent> | null
): ResolutionEnvelope => {
  const resolvedLocale = doc?.resolution?.resolved?.locale || doc?.locale
  return {
    requested: {
      collection,
      by: requestedBy,
      ...(requestedLocale ? { locale: requestedLocale } : {}),
      ...(requestedFallback !== undefined ? { fallback: requestedFallback } : {})
    },
    normalized: {
      by: normalizedBy
    },
    matched: {
      found: Boolean(doc),
      collection,
      ...(doc?.route?.resolvedPath ? { path: doc.route.resolvedPath } : {}),
      ...((doc as unknown as { ref?: string } | null)?.ref ? { ref: (doc as unknown as { ref: string }).ref } : {}),
      ...(resolvedLocale ? { locale: resolvedLocale } : {})
    },
    fallback: {
      used: Boolean(requestedLocale && resolvedLocale && requestedLocale !== resolvedLocale),
      ...(requestedLocale && resolvedLocale && requestedLocale !== resolvedLocale ? { locale: resolvedLocale } : {})
    }
  }
}

export async function resolveDocument<
  const H extends ContentCollectionHandle | string,
  O extends ResolveOneOptions<H, PopulateSpec | undefined>
>(
  context: ContentQueryContext,
  handle: H,
  options: O
): Promise<ResolveOneResult<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>>> {
  const collection = ensureCollectionName(handle)
  const runtime = context.runtime
  validatePopulateSpec(handle, collection, runtime, options.populate)
  const by = options.by
  const fallback = resolveFallback(options.fallback, collection, runtime)
  const params: ContentQueryTransportInput = {
    ...compileQueryParams({
      collection,
      by,
      locale: options.locale,
      fallback,
      select: selectWithPopulate(options.select as ReadonlyArray<string> | undefined, options.populate)
    }),
    ...(options.populate ? { populate: serializePopulateSpec(options.populate) } : {})
  }

  params.first = true

  let response: unknown
  try {
    response = await context.transport('query', params)
  } catch (error) {
    if (isNotFoundError(error)) {
      const explain = explainResolution(collection, options.by, by, options.locale, options.fallback, null)
      return { doc: null, explain } as ResolveOneResult<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>>
    }
    throw error
  }

  const doc = unwrapOneResponse<LocalizedDoc<ParsedContent>>(response)
  const explain = explainResolution(collection, options.by, by, options.locale, options.fallback, doc)
  return {
    doc,
    explain
  } as ResolveOneResult<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>>
}

export async function resolveDocumentOnly<
  const H extends ContentCollectionHandle | string,
  O extends OneOptions<H, PopulateSpec | undefined>
>(
  context: ContentQueryContext,
  handle: H,
  options: O
): Promise<LocalizedDoc<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>> | null> {
  const result = await resolveDocument(context, handle, options)
  return result.doc
}

export async function resolveManyDocuments<
  const H extends ContentCollectionHandle | string,
  O extends ManyOptions<H, PopulateSpec | undefined>
>(
  context: ContentQueryContext,
  handle: H,
  options: O = {} as O
): Promise<Array<LocalizedDoc<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>>>> {
  const collection = ensureCollectionName(handle)
  const runtime = context.runtime
  validatePopulateSpec(handle, collection, runtime, options.populate)
  const fallback = resolveFallback(options.fallback, collection, runtime)
  const params: ContentQueryTransportInput = {
    ...compileQueryParams({
      collection,
      where: options.where as QueryWhere | undefined,
      sort: options.sort,
      limit: options.limit,
      skip: options.skip,
      locale: options.locale,
      fallback,
      select: selectWithPopulate(options.select as ReadonlyArray<string> | undefined, options.populate)
    }),
    ...(options.populate ? { populate: serializePopulateSpec(options.populate) } : {})
  }

  let response: unknown
  try {
    response = await context.transport('query', params)
  } catch (error) {
    if (isNotFoundError(error)) return []
    throw error
  }

  const find = unwrapFindResponse<LocalizedDoc<ParsedContent>>(response)
  const docs = find.result
  if (import.meta.dev && options.limit === undefined && find.total > docs.length) {
    console.warn(
      `[ginko-content] many("${collection}") matched ${find.total} documents but returned ${docs.length}. ` +
      'Pass an explicit limit or use paginate() to read the rest.'
    )
  }
  return docs as Array<LocalizedDoc<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>>>
}

export async function resolveCount<
  const H extends ContentCollectionHandle | string,
  O extends CountOptions<H>
>(
  context: ContentQueryContext,
  handle: H,
  options: O = {} as O
): Promise<number> {
  const collection = ensureCollectionName(handle)
  const fallback = resolveFallback(options.fallback, collection, context.runtime)
  const params = compileQueryParams({
    collection,
    where: options.where as QueryWhere | undefined,
    locale: options.locale,
    fallback,
    count: true
  })

  try {
    return unwrapCountResponse(await context.transport('query', params))
  } catch (error) {
    if (isNotFoundError(error)) return 0
    throw error
  }
}
