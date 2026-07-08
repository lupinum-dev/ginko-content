/**
 * Server-side content query and reference API.
 *
 * Responsibilities:
 *
 *  - Expose `serverQueryCollection(event, name)` — the Nitro-side public
 *    entry point that drives the query plan.
 *  - Resolve authored references through the request-scoped content graph.
 *
 * Parsed artifact loading lives in `contents.ts`; graph construction lives in
 * `graph.ts`. This file stays focused on query APIs and result shaping.
 */
import { joinURL, withLeadingSlash } from 'ufo'
import type { H3Event } from 'h3'
import type { ContentDocumentResolution, ParsedContent } from '../types/content'
import type { ContentCollectionI18nConfig } from '../types/config'
import type { ContentCollectionMap, ContentLocaleEntry, ContentQueryBuilderParams, ContentQueryFetcher, ContentQueryRequest, CollectionQueryBuilder, ResolveContentReferenceOptions } from '../types/query'
import { createQuery, wrapQueryBuilder } from '../core/query/builder'
import { resolveGraphCanonicalKey, resolveGraphCollectionLocales, resolveGraphVariant } from '../core/content/graph'
import { sortLocalesCanonically } from '../core/content/locale'
import { normalizeReferenceValue } from '../core/references/resolve'
import { executeQueryPlan } from '../core/query/execute'
import { lowerQueryPlan } from '../core/query/lower'
import { normalizeContentQueryParams } from '../core/query/params'
import { normalizeI18nConfig, resolveRuntimeCollectionI18nConfig } from '../features/localization/config'
import { contentConfig } from './driver'
import { withResolvedRefsQueryResponse } from './references'
import { getContentGraph } from './graph'

export const createServerQueryFetch = <T = ParsedContent>(event: H3Event): ContentQueryFetcher<T> => (query: ContentQueryRequest) => {
  const config = contentConfig()
  return getContentGraph(event).then((graph) => {
    const response = executeQueryPlan<T>(graph, lowerQueryPlan(query.params()), {
      defaultLocale: config.defaultLocale,
      localeFallback: config.localeFallback
    })
    return withResolvedRefsQueryResponse(event, response, query.params())
  })
}

/**
 * Resolve an authored content reference value to a concrete document.
 *
 * This understands locale variants, locale fallback, and collection scoping,
 * and it augments the returned document with metadata about how the variant was
 * resolved.
 *
 * @example
 * ```ts
 * const author = await resolveContentReference(event, 'authors/evan', {
 *   collection: 'authors',
 *   locale: 'de',
 *   fallback: true
 * })
 * ```
 */
export const resolveContentReference = async <T = ParsedContent> (
  event: H3Event,
  reference: string,
  options: ResolveContentReferenceOptions = {}
): Promise<(T & { resolved?: ContentDocumentResolution }) | null> => {
  const config = contentConfig()
  const graph = await getContentGraph(event)
  const normalizedReference = normalizeReferenceValue(reference)
  const canonicalId = normalizedReference ? resolveGraphCanonicalKey(graph, normalizedReference, options.collection) : null

  if (!canonicalId) {
    return null
  }

  const variants = Object.values(graph.byCanonical[canonicalId] || {})
    .map(entry => entry.document)
    .filter(document => !options.collection || document.collection === options.collection)

  if (!variants.length) {
    return null
  }

  const resolvedVariant = resolveGraphVariant(graph, canonicalId, options.locale, {
    defaultLocale: config.defaultLocale,
    fallback: Array.isArray(options.fallback)
      ? options.fallback
      : (options.fallback ? config.localeFallback?.[options.locale || ''] || [] : []),
    exact: options.exact,
    localeFallback: config.localeFallback
  })
  const resolved = resolvedVariant ? graph.byId[resolvedVariant.contentId] : undefined
  if (!resolved || !resolvedVariant) {
    return null
  }

  // `variants` is drawn from `byCanonical` in graph-insertion order; canonicalize
  // so `availableLocales` matches every other producer regardless of requested locale.
  const collectionI18n = getServerCollectionI18n(options.collection)
  const availableLocales = sortLocalesCanonically(
    Array.from(new Set(variants.map(document => document.locale).filter(Boolean))) as string[],
    {
      defaultLocale: collectionI18n?.defaultLocale || config.defaultLocale,
      locales: collectionI18n?.locales
    }
  )
  const variantPaths = Object.fromEntries(
    variants
      .filter(document => document.locale && document.path)
      .map(document => [document.locale!, document.path!])
  )

  return {
    ...(resolved as T),
    resolved: {
      ...((resolved as ParsedContent).resolved || {}),
      requestedLocale: resolvedVariant.requestedLocale,
      locale: resolvedVariant.resolvedLocale,
      fallback: resolvedVariant.fallback,
      availableLocales,
      variantPaths
    }
  }
}

const getServerCollectionI18n = (collection?: string): ContentCollectionI18nConfig | undefined => {
  const config = contentConfig()
  return collection
    ? resolveRuntimeCollectionI18nConfig(collection, config)
    : normalizeI18nConfig(config)
}

export const createServerContentQuery = <T = ParsedContent>(event: H3Event, query?: string | ContentQueryBuilderParams, ...pathParts: string[]) => {
  const config = contentConfig()
  const queryBuilder = createQuery<T>(createServerQueryFetch(event), { initialParams: typeof query !== 'string' ? query || {} : {} })
  let path: string

  if (typeof query === 'string') {
    path = withLeadingSlash(joinURL(query, ...pathParts))
  }

  // Server-side normalization wraps the pure builder — no `.params` monkey-patch.
  // The Proxy propagates the transform through any `.where()`/`.locale()` chain.
  return wrapQueryBuilder<T>(queryBuilder, (params) => {
    const collectionI18n = getServerCollectionI18n(params.collection)
    return normalizeContentQueryParams(params, {
      path,
      collectionI18n,
      defaultLocale: config.defaultLocale,
      localeFallback: config.localeFallback,
      activeLocale: collectionI18n?.defaultLocale,
      includeDraftFilter: !import.meta.dev
    })
  })
}

export function serverQueryCollection<K extends keyof ContentCollectionMap & string>(event: H3Event, collection: K): CollectionQueryBuilder<ContentCollectionMap[K]>;
export function serverQueryCollection<T = ParsedContent>(event: H3Event, collection: string): CollectionQueryBuilder<T>;
/**
 * Start a typed collection query from Nitro or other server-only code.
 */
export function serverQueryCollection<T = ParsedContent>(event: H3Event, collection: string): CollectionQueryBuilder<T> {
  return createServerContentQuery<T>(event, { collection }) as CollectionQueryBuilder<T>
}

/**
 * List every locale variant available for a collection entry on the server.
 */
export const queryCollectionLocales = async <K extends keyof ContentCollectionMap & string>(
  event: H3Event,
  collection: K,
  identity: string
): Promise<ContentLocaleEntry[]> => {
  const graph = await getContentGraph(event)

  return resolveGraphCollectionLocales(graph, identity, collection)
}
