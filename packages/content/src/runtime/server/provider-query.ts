import { joinURL, withLeadingSlash } from 'ufo'
import type { H3Event } from 'h3'
import type { ContentResolutionCarrier, ParsedContent } from '../../types/content'
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
import { sortLocalesCanonically } from '../../core/content/locale'
import { resolveLocaleChain } from '../../core/content/graph'
import { normalizeRouteMounts } from '../../core/content/path'
import { normalizeReferenceValue } from '../../core/references/resolve'
import { resolveIncludeDrafts, resolveRuntimeEnvironment } from '../../core/visibility'
import { lowerRouteToCandidates } from '../../features/localization/route-projector'
import type { ResolvedCollectionLocalePolicy } from '../../features/localization/locale-policy'
import { getContentRuntimeConfig } from './runtime-config'
import { isPreview } from '../../integrations/nitro/preview'
import { createContentProviderError } from '../../public/provider-errors'
import { toContentProviderQuery, type ContentProviderQuery } from '../../public/provider-query'

export { toContentProviderNavigationQuery as createProviderNavigationQuery } from '../../public/provider-query'

/**
 * Build the `ResolvedCollectionLocalePolicy` the canonical route projector
 * needs from the plain runtime content config already resolved at request
 * time (VNEXT.md 12.1/13.1) — same reshaping pattern as
 * `features/query/routes.ts#getCollectionPath`.
 */
const collectionLocalePolicyFor = (
  collection: string | null | undefined,
  config: ReturnType<typeof getContentRuntimeConfig>['content']
): ResolvedCollectionLocalePolicy => {
  const collectionConfig = collection ? config.collections?.[collection] : undefined
  const collectionI18n = collectionConfig?.i18n && typeof collectionConfig.i18n === 'object' ? collectionConfig.i18n : undefined
  const defaultLocale = collectionI18n?.defaultLocale || config.defaultLocale
  const locales = collectionI18n?.locales?.length ? collectionI18n.locales : []
  const mounts = normalizeRouteMounts(collectionConfig?.route, locales, defaultLocale)

  return {
    localized: locales.length > 0,
    locales,
    defaultLocale,
    fallback: config.localeFallback ?? {},
    translatedSlugs: false,
    routeMounts: mounts ?? {}
  }
}

/**
 * Close a plan's `route`/`ref` variant resolution into the honest provider
 * wire selector (VNEXT.md 13.1): an ordered, exact `{ locale, contentPath }`
 * candidate list for `route` (via the canonical route projector), or the
 * resolved locale fallback chain for `ref`. Leaves the plan untouched when
 * there is no `route`/`ref` selector to close (plain `path` lookups keep
 * their existing in-graph resolution).
 */
const closeProviderVariantSelector = (query: ContentProviderQuery): ContentProviderQuery => {
  const resolveVariant = query.plan.resolveVariant
  if (!resolveVariant || (!resolveVariant.route && !resolveVariant.ref)) {
    return query
  }

  const config = getContentRuntimeConfig().content || {}
  const policy = collectionLocalePolicyFor(query.collection, config)
  const requestedLocale = resolveVariant.locale || policy.defaultLocale || ''

  if (resolveVariant.route) {
    const candidates = resolveVariant.exact
      ? lowerRouteToCandidates(resolveVariant.route, policy, requestedLocale).filter(candidate => candidate.locale === requestedLocale)
      : lowerRouteToCandidates(resolveVariant.route, policy, requestedLocale)

    return {
      ...query,
      plan: {
        ...query.plan,
        resolveVariant,
        variantSelector: {
          by: 'route',
          requestedLocale,
          candidates
        }
      }
    }
  }

  const localeChain = resolveVariant.exact
    ? (requestedLocale ? [requestedLocale] : [])
    : resolveLocaleChain(requestedLocale, policy.defaultLocale, requestedLocale ? { [requestedLocale]: [...(resolveVariant.fallback || policy.fallback[requestedLocale] || [])] } : {})

  return {
    ...query,
    plan: {
      ...query.plan,
      resolveVariant,
      variantSelector: {
        by: 'ref',
        ref: resolveVariant.ref!,
        requestedLocale,
        localeChain
      }
    }
  }
}

/**
 * Build the provider wire query (CS-5) from builder params: reject
 * globally-invalid operators and malformed `$options` up front (so callers see
 * a clean typed error rather than a raw lowering `TypeError`), apply the shared
 * content-query normalization (default sort, locale injection, `fallback: true`
 * → chain expansion), then lower to a JSON-pure `ContentQueryPlan`.
 *
 * This is the single builder-params → plan seam before *every* provider's
 * `query()` — filesystem or third-party.
 *
 * It deliberately does NOT inject draft/structural visibility filters here:
 * an arbitrary third-party provider may advertise a minimal operator set
 * (conformance only requires it to execute the operators it advertises —
 * VNEXT.md 13.7), so unconditionally adding a `$ne` clause on `draft`, or on
 * a field the provider may not even carry, can make an otherwise-valid query
 * fail with `unsupported_query_operator` for a provider that never claimed to
 * support it. Ginko's own core visibility decision is enforced at the
 * filesystem-only untrusted HTTP boundary (`query-executor.ts`, where the
 * operator surface is known and controlled) and by each trusted internal
 * composable that needs it, not injected blindly into every provider's wire
 * query. See VNEXT.md 13.6/24.2 and the Phase 2D report's provider-fact
 * normalization note for the generic-provider follow-up this implies.
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

  return closeProviderVariantSelector(toContentProviderQuery(normalized))
}


const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const isProviderOffsetFindResponse = (response: Record<string, unknown>): boolean =>
  Array.isArray(response.result) &&
  typeof response.skip === 'number' &&
  typeof response.limit === 'number' &&
  typeof response.total === 'number' &&
  (response.mode === undefined || response.mode === 'offset')

const isProviderCursorFindResponse = (response: Record<string, unknown>): boolean =>
  response.mode === 'cursor' &&
  Array.isArray(response.result) &&
  typeof response.limit === 'number' &&
  isObject(response.pageInfo) &&
  (response.pageInfo.endCursor === null || typeof response.pageInfo.endCursor === 'string') &&
  typeof response.pageInfo.hasNext === 'boolean'

/** Closed, discriminated list response — see `ContentQueryFindResponse` (VNEXT.md 10.2/13.1). */
const isProviderFindResponse = <T>(response: unknown): response is ContentQueryFindResponse<T> =>
  isObject(response) && (isProviderOffsetFindResponse(response) || isProviderCursorFindResponse(response))

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
  ['skip', 'limit', 'total', 'pageInfo', 'mode'].some(key => key in response)

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
    return invalidProviderQueryResult(params, 'Provider list query envelopes must be either { result, skip, limit, total } (offset) or { mode: \'cursor\', result, limit, pageInfo: { endCursor, hasNext } } (cursor).', response, providerName)
  }

  return invalidProviderQueryResult(params, 'Provider list queries must return a list envelope: { result: item[], skip, limit, total } (offset) or { mode: \'cursor\', result, limit, pageInfo } (cursor).', response, providerName)
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

  // The provider path collects variants in `localesToQuery` order
  // (`[requestedLocale, ...fallbacks, ...configLocales]`), which differs per
  // requested locale. Canonicalize so `availableLocales` is identical on every
  // path regardless of which locale was requested.
  const availableLocales = sortLocalesCanonically(
    Array.from(new Set(variants.map(document => document.locale).filter(Boolean))) as string[],
    {
      defaultLocale: collectionI18n?.defaultLocale || runtimeContent.defaultLocale,
      locales: collectionI18n?.locales
    }
  )
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
      includeDraftFilter: !resolveIncludeDrafts({
        environment: resolveRuntimeEnvironment(),
        previewAuthorized: isPreview(event)
      })
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
): Promise<(T & { resolved?: ContentResolutionCarrier }) | null> => {
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
