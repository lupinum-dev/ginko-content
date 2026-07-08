import { joinURL, withLeadingSlash } from 'ufo'
import type { H3Event } from 'h3'
import type { ContentDocumentResolution, ParsedContent } from '../../types/content'
import type { ContentQueryCountResponse, ContentQueryFindOneResponse, ContentQueryFindResponse, ContentQueryResponse } from '../../types/api'
import type {
  CollectionQueryBuilder,
  ContentCollectionMap,
  ContentQueryBuilderParams,
  ContentQueryRequest,
  ResolveContentReferenceOptions
} from '../../types/query'
import { createQuery, wrapQueryBuilder } from '../../core/query/builder'
import { normalizeContentQueryParams } from '../../core/query/params'
import { containsStandaloneRegexOptions, findUnsupportedQueryOperator } from '../../core/query/operators'
import { normalizeI18nConfig, resolveRuntimeCollectionI18nConfig } from '../../features/localization/config'
import { normalizeReferenceValue } from '../../core/references/resolve'
import { getContentRuntimeConfig } from './runtime-config'
import { createContentProviderError } from '../../public/provider-errors'
import { toContentProviderNavigationQuery, toContentProviderQuery, type ContentProviderQuery } from '../../public/provider-query'

export { toContentProviderNavigationQuery as createProviderNavigationQuery } from '../../public/provider-query'

/**
 * Build the provider wire query (CS-5) from builder params: reject
 * globally-invalid operators and malformed `$options` up front (so callers see
 * a clean typed error rather than a raw lowering `TypeError`), apply the shared
 * content-query normalization (default sort, locale injection, `fallback: true`
 * → chain expansion), then lower to a JSON-pure `ContentQueryPlan`.
 *
 * This is the single builder-params → plan seam before the provider boundary.
 * Provider-specific policy (draft hiding, limit clamps, regex rejection) lives
 * inside each provider, applied to the plan it receives.
 */
export const createProviderQuery = (params: ContentQueryBuilderParams): ContentProviderQuery => {
  const unsupported = findUnsupportedQueryOperator(params.where)
  if (unsupported) {
    throw createContentProviderError('unsupported_query_operator', `Unsupported query operator: ${unsupported}`, {
      operator: unsupported
    })
  }

  if (containsStandaloneRegexOptions(params.where)) {
    throw createContentProviderError('unsupported_query_shape', 'Query operator $options requires $regex.', {
      operator: '$options'
    })
  }

  const config = getContentRuntimeConfig().content || {}
  const normalized = normalizeContentQueryParams(params, {
    collectionI18n: params.collection ? config.collections?.[params.collection]?.i18n : undefined,
    defaultLocale: config.defaultLocale,
    localeFallback: config.localeFallback,
    includeDraftFilter: false
  })

  return toContentProviderQuery(normalized)
}


const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const isProviderFindResponse = <T>(response: unknown): response is ContentQueryFindResponse<T> =>
  isObject(response) &&
  Array.isArray(response.result) &&
  typeof response.skip === 'number' &&
  typeof response.limit === 'number' &&
  typeof response.total === 'number'

export const normalizeProviderQueryResult = <T>(response: ContentQueryResponse<T>): T[] => {
  if (isProviderFindResponse<T>(response)) {
    return response.result
  }

  return []
}

const isProviderFindOneResponse = <T>(response: unknown): response is ContentQueryFindOneResponse<T> =>
  isObject(response) &&
  'result' in response &&
  Object.keys(response).length === 1

const isProviderCountResponse = (response: unknown): response is ContentQueryCountResponse =>
  isObject(response) &&
  typeof response.result === 'number' &&
  Object.keys(response).length === 1

const hasListEnvelopeKeys = (response: Record<string, unknown>) =>
  ['skip', 'limit', 'total'].some(key => key in response)

const describeProviderResponse = (response: unknown) => {
  if (Array.isArray(response)) return 'array'
  if (response === null) return 'null'
  return typeof response
}

const invalidProviderQueryResult = (
  params: ContentQueryBuilderParams,
  message: string,
  response: unknown,
  providerName?: string
): never => {
  throw createContentProviderError('provider_result_invalid', message, {
    collection: params.collection,
    provider: providerName,
    mode: params.count ? 'count' : params.first ? 'first' : 'many',
    responseType: describeProviderResponse(response)
  })
}

export const normalizeProviderQueryResponse = <T>(
  params: ContentQueryBuilderParams,
  response: unknown,
  providerName?: string
): ContentQueryResponse<T> => {
  if (params.count) {
    if (isProviderCountResponse(response)) {
      return response
    }
    return invalidProviderQueryResult(params, 'Provider count queries must return a count envelope: { result: number }.', response, providerName)
  }

  if (params.first) {
    if (isProviderFindOneResponse<T>(response)) {
      return response
    }
    return invalidProviderQueryResult(params, 'Provider first queries must return a find-one envelope: { result: item | undefined }.', response, providerName)
  }

  if (isProviderFindResponse<T>(response)) {
    return response
  }

  if (isObject(response) && hasListEnvelopeKeys(response)) {
    return invalidProviderQueryResult(params, 'Provider list query envelopes must include array result, skip, limit, and total.', response, providerName)
  }

  return invalidProviderQueryResult(params, 'Provider list queries must return a list envelope: { result: item[], skip, limit, total }.', response, providerName)
}

const identityMatchesDocument = (document: ParsedContent, identity: string) => {
  const normalizedIdentity = normalizeReferenceValue(identity)
  if (!normalizedIdentity) {
    return false
  }

  return [document.canonicalKey, document.path, document.ref]
    .filter((value): value is string => typeof value === 'string')
    .some(value => normalizeReferenceValue(value) === normalizedIdentity)
}

export const resolveProviderContentVariants = async (
  event: H3Event,
  identity: string,
  options: ResolveContentReferenceOptions
) => {
  if (!options.collection) {
    return null
  }

  const normalizedReference = normalizeReferenceValue(identity)
  if (!normalizedReference) {
    return null
  }

  const runtimeContent = getContentRuntimeConfig().content || {}
  const collectionI18n = resolveRuntimeCollectionI18nConfig(options.collection, runtimeContent)
  const fallbackLocales = Array.isArray(options.fallback)
    ? options.fallback
    : options.fallback && options.locale
      ? runtimeContent.localeFallback?.[options.locale] || []
      : []
  const localesToQuery = Array.from(new Set([
    ...(options.locale ? [options.locale] : []),
    ...fallbackLocales,
    ...(collectionI18n?.locales || []),
  ]))
  const { getContentProvider } = await import('./providers')
  const provider = await getContentProvider(event)
  const baseQuery = {
    collection: options.collection,
    only: ['path', 'canonicalKey', 'locale', 'ref', 'title', 'description', 'body'],
  }
  const documents = localesToQuery.length
    ? (
        await Promise.all(
          localesToQuery.map(async (locale) => {
            const localeQuery = { ...baseQuery, resolveLocale: { locale, exact: true } }
            return normalizeProviderQueryResult(
              normalizeProviderQueryResponse<ParsedContent>(
                localeQuery,
                await provider.query<ParsedContent>(event, createProviderQuery(localeQuery)),
                provider.name,
              ),
            )
          }),
        )
      ).flat()
    : normalizeProviderQueryResult(normalizeProviderQueryResponse<ParsedContent>(baseQuery, await provider.query<ParsedContent>(event, createProviderQuery(baseQuery)), provider.name))
  const matched = documents.find(document => identityMatchesDocument(document, normalizedReference))
  const canonicalKey = matched?.canonicalKey
  if (!canonicalKey) {
    return null
  }

  const variants = documents.filter(document => document.canonicalKey === canonicalKey)
  if (!variants.length) {
    return null
  }

  const selectByLocale = (locale?: string) =>
    locale ? variants.find(document => document.locale === locale) : undefined
  const selected =
    selectByLocale(options.locale) ||
    (!options.exact ? fallbackLocales.map(selectByLocale).find(Boolean) : undefined) ||
    (!options.exact ? selectByLocale(collectionI18n?.defaultLocale || runtimeContent.defaultLocale) : undefined) ||
    (!options.exact ? variants[0] : undefined)

  if (!selected) {
    return null
  }

  const availableLocales = Array.from(new Set(variants.map(document => document.locale).filter(Boolean))) as string[]
  const variantPaths = Object.fromEntries(
    variants
      .filter(document => document.locale && document.path)
      .map(document => [document.locale!, document.path!]),
  )

  return {
    canonicalKey,
    selected,
    variants,
    availableLocales,
    variantPaths,
    requestedLocale: options.locale,
    resolvedLocale: selected.locale,
    fallback: Boolean(options.locale && selected.locale && selected.locale !== options.locale)
  }
}

export const createServerProviderQueryFetch = <T = ParsedContent>(event: H3Event) => {
  return async (query: ContentQueryRequest) => {
    const { getContentProvider } = await import('./providers')
    const provider = await getContentProvider(event)
    const params = query.params()
    const response = await provider.query<T>(event, createProviderQuery(params))
    return normalizeProviderQueryResponse<T>(params, response, provider.name)
  }
}

const getServerCollectionI18n = (collection?: string) => {
  const config = getContentRuntimeConfig().content
  return collection
    ? resolveRuntimeCollectionI18nConfig(collection, config)
    : normalizeI18nConfig(config)
}

export const createServerContentQuery = <T = ParsedContent>(
  event: H3Event,
  query?: string | ContentQueryBuilderParams,
  ...pathParts: string[]
) => {
  const config = getContentRuntimeConfig().content
  const queryBuilder = createQuery<T>(createServerProviderQueryFetch(event), {
    initialParams: typeof query !== 'string' ? query || {} : {}
  })
  let path: string | undefined

  if (typeof query === 'string') {
    path = withLeadingSlash(joinURL(query, ...pathParts))
  }

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

export function serverQueryCollection<K extends keyof ContentCollectionMap & string>(
  event: H3Event,
  collection: K
): CollectionQueryBuilder<ContentCollectionMap[K]>
export function serverQueryCollection<T = ParsedContent>(
  event: H3Event,
  collection: string
): CollectionQueryBuilder<T>
export function serverQueryCollection<T = ParsedContent>(
  event: H3Event,
  collection: string
): CollectionQueryBuilder<T> {
  return createServerContentQuery<T>(event, { collection }) as CollectionQueryBuilder<T>
}

export const resolveContentReference = async <T = ParsedContent>(
  event: H3Event,
  reference: string,
  options: ResolveContentReferenceOptions = {}
): Promise<(T & { resolved?: ContentDocumentResolution }) | null> => {
  const resolved = await resolveProviderContentVariants(event, reference, options)
  if (!resolved) {
    return null
  }

  return {
    ...(resolved.selected as T),
    resolved: {
      ...((resolved.selected as ParsedContent).resolved || {}),
      requestedLocale: resolved.requestedLocale,
      locale: resolved.resolvedLocale,
      fallback: resolved.fallback,
      availableLocales: resolved.availableLocales,
      variantPaths: resolved.variantPaths,
    }
  }
}
