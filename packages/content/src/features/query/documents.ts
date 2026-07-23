import type { ParsedContent } from '../../types/content'
import type { ContentCollectionHandle } from '../../types/config'
import type {
  ContentSelector,
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
import { decorateLocalizedDocument } from './localized-docs'
import { resolveFallback } from './locale-options'
import { populateDocument, populateDocuments, selectWithPopulate, validatePopulateSpec } from './populate'
import { unwrapListResponse, unwrapOneResponse } from './responses'

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
  one: typeof resolveDocumentOnly,
  handle: H,
  options: O
): Promise<ResolveOneResult<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>>> {
  const collection = ensureCollectionName(handle)
  const runtime = context.runtime
  validatePopulateSpec(handle, collection, runtime, options.populate)
  const by = options.by
  const fallback = resolveFallback(options.fallback, collection, runtime)
  const params = compileQueryParams({
    collection,
    by,
    locale: options.locale,
    fallback,
    select: selectWithPopulate(options.select as ReadonlyArray<string> | undefined, options.populate)
  })

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

  const unwrapped = unwrapOneResponse<ParsedContent>(response)
  const doc = unwrapped ?? null
  const decorated = decorateLocalizedDocument(doc as ParsedContent, collection, runtime, options.locale)
  const populated = decorated
    ? await populateDocument(context, one, decorated, options.populate, options.locale, options.fallback)
    : null
  const explain = explainResolution(collection, options.by, by, options.locale, options.fallback, decorated)
  return {
    doc: populated,
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
  const result = await resolveDocument(context, resolveDocumentOnly, handle, options)
  return result.doc
}

export async function resolveManyDocuments<
  const H extends ContentCollectionHandle | string,
  O extends ManyOptions<H, PopulateSpec | undefined>
>(
  context: ContentQueryContext,
  one: typeof resolveDocumentOnly,
  handle: H,
  options: O = {} as O
): Promise<Array<LocalizedDoc<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>>>> {
  const collection = ensureCollectionName(handle)
  const runtime = context.runtime
  validatePopulateSpec(handle, collection, runtime, options.populate)
  const fallback = resolveFallback(options.fallback, collection, runtime)
  const params = compileQueryParams({
    collection,
    where: options.where as QueryWhere | undefined,
    sort: options.sort,
    limit: options.limit,
    skip: options.skip,
    locale: options.locale,
    fallback,
    select: selectWithPopulate(options.select as ReadonlyArray<string> | undefined, options.populate)
  })

  let response: unknown
  try {
    response = await context.transport('query', params)
  } catch (error) {
    if (isNotFoundError(error)) return []
    throw error
  }

  const list = unwrapListResponse<ParsedContent>(response)
  const decorated = list
    .map(doc => decorateLocalizedDocument(doc as ParsedContent, collection, runtime, options.locale))
    .filter((doc): doc is LocalizedDoc<ParsedContent> => Boolean(doc))
  const populated = await populateDocuments(context, one, decorated, options.populate, options.locale, options.fallback)
  return populated as Array<LocalizedDoc<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>>>
}
