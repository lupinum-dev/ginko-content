import { joinURL, withLeadingSlash } from 'ufo'
import type { H3Event } from 'h3'
import type { ContentCollectionMap } from '@lupinum/ginko-content'
import type { ParsedContent } from '../../types/content'
import type { ContentQueryCountResponse, ContentQueryFindOneResponse, ContentQueryFindResponse, ContentQueryResponse } from '../../types/api'
import type {
  CollectionQueryBuilder,
  ContentQueryBuilderParams,
  ContentQueryRequest,
  ResolveContentReferenceOptions
} from '../../types/query'
import { createQuery, wrapQueryBuilder } from '../../core/query/builder'
import { normalizeContentQueryParams } from '../../core/query/params'
import { normalizeI18nConfig, resolveRuntimeCollectionI18nConfig } from '../../features/localization/config'
import { normalizeReferenceValue } from '../../core/references/resolve'
import { getContentRuntimeConfig } from './runtime-config'

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const isProviderFindResponse = <T>(response: unknown): response is ContentQueryFindResponse<T> =>
  isObject(response) &&
  Array.isArray(response.result) &&
  typeof response.skip === 'number' &&
  typeof response.limit === 'number' &&
  typeof response.total === 'number'

export const normalizeProviderQueryResult = <T>(response: ContentQueryResponse<T> | T[] | T | number | undefined): T[] => {
  if (Array.isArray(response)) {
    return response
  }

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

export const normalizeProviderQueryResponse = <T>(
  params: ContentQueryBuilderParams,
  response: ContentQueryResponse<T> | T[] | T | number | undefined
): ContentQueryResponse<T> => {
  if (params.count) {
    if (isProviderCountResponse(response)) {
      return response
    }
    return { result: typeof response === 'number' ? response : 0 }
  }

  if (params.first) {
    if (isProviderFindOneResponse<T>(response)) {
      return response
    }
    return { result: Array.isArray(response) ? response[0] : response as T | undefined }
  }

  if (isProviderFindResponse<T>(response)) {
    return response
  }

  const result = Array.isArray(response)
    ? response
    : typeof response === 'undefined' || typeof response === 'number'
      ? []
      : [response as T]

  return {
    result,
    skip: params.skip || 0,
    limit: typeof params.limit === 'number' ? params.limit : result.length,
    total: result.length
  }
}

const identityMatchesDocument = (document: ParsedContent, identity: string) => {
  const normalizedIdentity = normalizeReferenceValue(identity)
  if (!normalizedIdentity) {
    return false
  }

  return [document._canonicalKey, document._path, document.ref]
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
    only: ['_path', '_canonicalKey', '_locale', 'ref', 'title', 'description', 'body'],
  }
  const documents = localesToQuery.length
    ? (
        await Promise.all(
          localesToQuery.map(async (locale) =>
            normalizeProviderQueryResult(
              await provider.query<ParsedContent>(event, {
                ...baseQuery,
                resolveLocale: { locale, exact: true },
              }),
            ),
          ),
        )
      ).flat()
    : normalizeProviderQueryResult(await provider.query<ParsedContent>(event, baseQuery))
  const matched = documents.find(document => identityMatchesDocument(document, normalizedReference))
  const canonicalKey = matched?._canonicalKey
  if (!canonicalKey) {
    return null
  }

  const variants = documents.filter(document => document._canonicalKey === canonicalKey)
  if (!variants.length) {
    return null
  }

  const selectByLocale = (locale?: string) =>
    locale ? variants.find(document => document._locale === locale) : undefined
  const selected =
    selectByLocale(options.locale) ||
    (!options.exact ? fallbackLocales.map(selectByLocale).find(Boolean) : undefined) ||
    (!options.exact ? selectByLocale(collectionI18n?.defaultLocale || runtimeContent.defaultLocale) : undefined) ||
    (!options.exact ? variants[0] : undefined)

  if (!selected) {
    return null
  }

  const availableLocales = Array.from(new Set(variants.map(document => document._locale).filter(Boolean))) as string[]
  const variantPaths = Object.fromEntries(
    variants
      .filter(document => document._locale && document._path)
      .map(document => [document._locale!, document._path!]),
  )

  return {
    canonicalKey,
    selected,
    variants,
    availableLocales,
    variantPaths,
    requestedLocale: options.locale,
    resolvedLocale: selected._locale,
    fallback: Boolean(options.locale && selected._locale && selected._locale !== options.locale)
  }
}

export const createServerProviderQueryFetch = <T = ParsedContent>(event: H3Event) => {
  return async (query: ContentQueryRequest) => {
    const { getContentProvider } = await import('./providers')
    const response = await (await getContentProvider(event)).query<T>(event, query.params())
    return normalizeProviderQueryResponse(query.params(), response)
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
): Promise<(T & {
  _requestedLocale?: string
  _resolvedLocale?: string
  _fallback?: boolean
  _availableLocales?: string[]
  _variantPaths?: Record<string, string>
}) | null> => {
  const resolved = await resolveProviderContentVariants(event, reference, options)
  if (!resolved) {
    return null
  }

  return {
    ...(resolved.selected as T),
    _requestedLocale: resolved.requestedLocale,
    _resolvedLocale: resolved.resolvedLocale,
    _fallback: resolved.fallback,
    _availableLocales: resolved.availableLocales,
    _variantPaths: resolved.variantPaths,
  }
}
