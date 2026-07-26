import type { H3Event } from 'h3'
import type { ContentQueryCountResponse, ContentQueryFindOneResponse, ContentQueryFindResponse, ContentQueryResponse } from '../../types/api'
import type { ContentProviderQueryInput, ResolveContentReferenceOptions } from '../../types/query'
import { normalizeContentQueryParams } from '../../core/query/params'
import { lowerQueryPlan } from '../../core/query/lower'
import type { CanonicalQueryPlan } from '../../core/query/plan'
import { containsStandaloneRegexOptions, findUnsupportedPublicQueryOperator, withoutKeys } from '../../core/query/operators'
import {
  resolveRuntimeCollectionI18nConfig,
  resolveRuntimeCollectionLocalePolicy
} from '../../features/localization/config'
import { sortLocalesCanonically } from '../../core/content/locale'
import { normalizeReferenceValue } from '../../core/references/resolve'
import { resolveRuntimeEnvironment } from '../../core/visibility'
import { emitRuntimeDiagnostics, shouldEmitRuntimeDiagnostics } from '../../core/runtime-diagnostics'
import { RouteProjectionError, unmountProviderContentPath } from '../../features/localization/route-projector'
import { DEFAULT_PUBLIC_QUERY_LIMIT } from '../../core/query/limits'
import type { ResolvedCollectionLocalePolicy } from '../../features/localization/locale-policy'
import { buildContentDocumentEnvelope } from '../../features/localization/results'
import {
  isCanonicalCursorFindResponseEnvelope,
  isCanonicalOffsetFindResponseEnvelope
} from '../../features/query/responses'
import { normalizeProviderDocument, type ValidatedProviderDocument, type ProviderDocumentInput } from '../../public/provider-document'
import { getContentRuntimeConfig } from './runtime-config'
import { createContentProviderError } from '../../public/provider-errors'
import { PROVIDER_QUERY_VERSION, type ContentProviderQuery } from '../../public/provider-query'
import {
  toCanonicalQueryPlan,
  toContentProviderQueryPlan
} from '../../features/query/query-plan-boundary'
import { collectMountedPathSelectorMissDiagnostic } from '../../features/query/diagnostics'

const collectionLocalePolicyFor = (
  collection: string | null | undefined,
  config: ReturnType<typeof getContentRuntimeConfig>['content']
): ResolvedCollectionLocalePolicy => {
  if (!collection) {
    throw createContentProviderError(
      'unsupported_query_shape',
      'Route and reference selectors require a configured collection.',
      { field: 'collection' }
    )
  }
  const policy = resolveRuntimeCollectionLocalePolicy(collection, config)
  if (!policy) {
    throw createContentProviderError(
      'unsupported_query_shape',
      'Content collection locale policy is missing from runtime config.',
      { collection, field: 'localePolicy' }
    )
  }
  return policy
}

/**
 * Both compilation phases can fail on collection route policy, so both report
 * the same way. A mount failure is a query-shape problem, not a provider-result
 * problem: translate `RouteProjectionError` here rather than letting it escape
 * the seam bare, matching how `provider-route-facts.ts` handles the same class.
 */
const translateQueryCompileError = (
  cause: unknown,
  normalized: ContentProviderQueryInput
): never => {
  if (cause instanceof RouteProjectionError) {
    throw createContentProviderError(
      'unsupported_query_shape',
      cause.message,
      { ...(normalized.collection ? { collection: normalized.collection } : {}), field: 'resolveVariant' },
      cause
    )
  }
  if (!(cause instanceof TypeError)) throw cause

  const field = normalized.paging && normalized.skip !== undefined
    ? 'skip'
    : normalized.paging && normalized.limit !== undefined
      ? 'limit'
      : undefined
  throw createContentProviderError(
    'unsupported_query_shape',
    cause.message,
    field ? { field } : {},
    cause
  )
}

/**
 * The one params → canonical-plan seam: reject globally-invalid operators and
 * malformed `$options` up front (so callers see a clean typed error rather than
 * a raw lowering `TypeError`), apply the shared content-query normalization
 * (locale injection, `fallback: true` → chain expansion), then lower and close
 * the plan against the collection's resolved locale policy.
 *
 * It deliberately does not inject a draft filter. A third-party provider may
 * not expose a `draft` field or advertise `$ne`, and its authenticated preview
 * policy belongs at that provider's server boundary. The filesystem provider
 * applies Ginko's own visibility policy where its field and operator surface
 * are known.
 */
const compileCanonicalQuery = (
  params: ContentProviderQueryInput,
  config: ReturnType<typeof getContentRuntimeConfig>['content'],
  knownPolicy?: ResolvedCollectionLocalePolicy
): {
  plan: CanonicalQueryPlan
  policy: ResolvedCollectionLocalePolicy | undefined
  normalized: ContentProviderQueryInput
} => {
  const unsupported = findUnsupportedPublicQueryOperator(params.where)
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

  const normalized = normalizeContentQueryParams(params, {
    collectionI18n: params.collection ? resolveRuntimeCollectionI18nConfig(params.collection, config) : undefined,
    defaultLocale: config.defaultLocale,
    localeFallback: config.localeFallback
  })
  assertConfiguredProviderQueryLocales(normalized, config)

  try {
    const lowered = lowerQueryPlan(normalized)
    const policy = lowered.variant
      ? knownPolicy ?? collectionLocalePolicyFor(normalized.collection ?? null, config)
      : knownPolicy
    return { plan: toCanonicalQueryPlan(lowered, policy), policy, normalized }
  }
  catch (cause) {
    return translateQueryCompileError(cause, normalized)
  }
}

/**
 * Compile params straight to the mount-agnostic plan the graph executor accepts.
 * In-process callers use this instead of building a provider wire query and
 * immediately converting it back — mounting is a provider-boundary concern.
 */
export const createCanonicalQueryPlan = (
  params: ContentProviderQueryInput,
  config = getContentRuntimeConfig().content || {},
  policy?: ResolvedCollectionLocalePolicy
): CanonicalQueryPlan => compileCanonicalQuery(params, config, policy).plan

/**
 * Build the closed, JSON-pure provider wire query. This is the single
 * params → wire seam before *every* provider's `query()` — filesystem or
 * third-party — and the only place a canonical plan is mounted.
 */
export const createProviderQuery = (
  params: ContentProviderQueryInput,
  config = getContentRuntimeConfig().content || {}
): ContentProviderQuery => {
  const { plan, policy, normalized } = compileCanonicalQuery(params, config)
  try {
    return {
      v: PROVIDER_QUERY_VERSION,
      collection: normalized.collection ?? null,
      plan: toContentProviderQueryPlan(plan, policy)
    }
  }
  catch (cause) {
    return translateQueryCompileError(cause, normalized)
  }
}

export function assertConfiguredProviderQueryLocales (
  params: ContentProviderQueryInput,
  runtimeConfig = getContentRuntimeConfig().content || {}
): void {
  if (!params.collection) return
  const policy = resolveRuntimeCollectionI18nConfig(params.collection, runtimeConfig)
  if (!policy) return

  const candidates: Array<{ locale: string | undefined, field: string }> = [
    { locale: params.resolveLocale?.locale, field: 'resolveLocale.locale' },
    { locale: params.resolveVariant?.locale, field: 'resolveVariant.locale' },
    ...(Array.isArray(params.resolveLocale?.fallback)
      ? params.resolveLocale.fallback.map((locale, index) => ({ locale, field: `resolveLocale.fallback[${index}]` }))
      : []),
    ...(Array.isArray(params.resolveVariant?.fallback)
      ? params.resolveVariant.fallback.map((locale, index) => ({ locale, field: `resolveVariant.fallback[${index}]` }))
      : [])
  ]
  const invalid = candidates.find(candidate => candidate.locale && !policy.locales.includes(candidate.locale))
  if (invalid) {
    throw createContentProviderError(
      'unsupported_query_shape',
      'Content query locale is not configured for the selected collection.',
      { collection: params.collection, field: invalid.field }
    )
  }
}

/**
 * Treat the resolved `content.config` collection map as the provider allowlist.
 * `hasOwnProperty` is intentional: names such as `constructor` must not resolve
 * through `Object.prototype` and reach an external provider as if configured.
 */
export function assertConfiguredProviderCollection (
  collection: string | null | undefined,
  runtimeConfig = getContentRuntimeConfig().content || {}
): asserts collection is string {
  if (
    !collection ||
    !runtimeConfig.collections ||
    !Object.prototype.hasOwnProperty.call(runtimeConfig.collections, collection)
  ) {
    throw createContentProviderError(
      'unknown_collection',
      'Content collection is not configured.',
      { field: 'collection' }
    )
  }
}


const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const expectedQueryLimit = (params: ContentProviderQueryInput): number =>
  params.first ? 1 : params.limit ?? params.paging?.limit ?? DEFAULT_PUBLIC_QUERY_LIMIT

const expectedQuerySkip = (params: ContentProviderQueryInput): number =>
  params.paging?.mode === 'offset' ? params.paging.skip : params.skip ?? 0

/** Closed, discriminated list response — see `ContentQueryFindResponse`. */
const isProviderFindResponse = <T>(
  response: unknown,
  params: ContentProviderQueryInput
): response is ContentQueryFindResponse<T> =>
  params.paging?.mode === 'cursor'
    ? isCanonicalCursorFindResponseEnvelope<T>(response, { maxLimit: expectedQueryLimit(params) })
    : isCanonicalOffsetFindResponseEnvelope<T>(response, {
        expectedSkip: expectedQuerySkip(params),
        expectedLimit: expectedQueryLimit(params)
      })

const isProviderFindOneResponse = <T>(response: unknown): response is ContentQueryFindOneResponse<T> =>
  isObject(response) &&
  'result' in response &&
  response.result !== null &&
  Object.keys(response).length === 1

const isProviderCountResponse = (response: unknown): response is ContentQueryCountResponse =>
  isObject(response) &&
  isNonNegativeInteger(response.result) &&
  Object.keys(response).length === 1

const hasListEnvelopeKeys = (response: Record<string, unknown>) =>
  ['skip', 'limit', 'total', 'pageInfo', 'mode'].some(key => key in response)

const describeProviderResponse = (response: unknown) => {
  if (Array.isArray(response)) return 'array'
  if (response === null) return 'null'
  return typeof response
}

const invalidProviderQueryResult = (
  params: ContentProviderQueryInput,
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

const isProviderDocumentInput = (value: unknown): value is ProviderDocumentInput =>
  isObject(value)
  && typeof value.collection === 'string'
  && Boolean(value.collection)
  && typeof value.locale === 'string'
  && Boolean(value.locale)
  && typeof value.contentPath === 'string'
  && typeof value.canonicalKey === 'string'
  && Boolean(value.canonicalKey)
  && 'body' in value

const normalizeProviderResultDocument = (
  value: ProviderDocumentInput,
  params: ContentProviderQueryInput,
  providerName?: string,
  runtimeConfig = getContentRuntimeConfig().content || {}
): ValidatedProviderDocument => {
  if (params.collection && value.collection !== params.collection) {
    throw createContentProviderError(
      'provider_result_invalid',
      `${providerName || 'Content provider'} returned a document outside the requested collection.`,
      { provider: providerName, collection: params.collection, operation: 'query', field: 'result.collection' }
    )
  }
  try {
    const normalized = normalizeProviderDocument(value)
    const policy = resolveRuntimeCollectionLocalePolicy(normalized.collection, runtimeConfig)
    if (!policy) {
      throw new TypeError(`locale policy is missing for collection "${normalized.collection}"`)
    }
    const allowedLocales = new Set(policy.localized ? policy.locales : [policy.defaultLocale])
    const variants = normalized.routeVariants
    const unexpectedLocale = [normalized.locale, ...variants.map(variant => variant.locale)]
      .find(locale => !allowedLocales.has(locale))
    if (unexpectedLocale) {
      throw new TypeError(`locale "${unexpectedLocale}" is not configured for collection "${normalized.collection}"`)
    }
    unmountProviderContentPath(normalized.contentPath, normalized.locale, policy)
    for (const variant of variants) {
      unmountProviderContentPath(variant.contentPath, variant.locale, policy)
    }
    return normalized
  } catch (cause) {
    throw createContentProviderError(
      'provider_result_invalid',
      `${providerName || 'Content provider'} returned an invalid ProviderDocumentInput.`,
      { provider: providerName, collection: params.collection, operation: 'query', field: 'result' },
      cause
    )
  }
}

const normalizeProviderResultDocuments = (
  values: readonly unknown[],
  params: ContentProviderQueryInput,
  providerName?: string,
  runtimeConfig = getContentRuntimeConfig().content || {}
): ValidatedProviderDocument[] => {
  const documents = values.map((value, index) => {
    if (!isProviderDocumentInput(value)) {
      throw createContentProviderError(
        'provider_result_invalid',
        `${providerName || 'Content provider'} returned a document that does not match ProviderDocumentInput.`,
        { provider: providerName, collection: params.collection, operation: 'query', field: `result[${index}]` }
      )
    }
    return normalizeProviderResultDocument(value, params, providerName, runtimeConfig)
  })

  const ids = new Set<string>()
  const identities = new Set<string>()
  const paths = new Set<string>()
  for (const [index, document] of documents.entries()) {
    if (ids.has(document.id)) {
      throw createContentProviderError(
        'provider_result_invalid',
        `${providerName || 'Content provider'} returned duplicate document identity.`,
        { provider: providerName, collection: params.collection, operation: 'query', field: `result[${index}].id` }
      )
    }
    ids.add(document.id)

    const identity = `${document.collection}\0${document.canonicalKey}\0${document.locale}`
    if (identities.has(identity)) {
      throw createContentProviderError(
        'provider_result_invalid',
        `${providerName || 'Content provider'} returned duplicate canonical document identity.`,
        { provider: providerName, collection: params.collection, operation: 'query', field: `result[${index}]` }
      )
    }
    identities.add(identity)

    const path = `${document.collection}\0${document.locale}\0${document.contentPath}`
    if (paths.has(path)) {
      throw createContentProviderError(
        'provider_result_invalid',
        `${providerName || 'Content provider'} returned a document path owned by more than one canonical identity.`,
        { provider: providerName, collection: params.collection, operation: 'query', field: `result[${index}].contentPath` }
      )
    }
    paths.add(path)
  }

  return documents
}

const normalizeRawProviderDocuments = (
  params: ContentProviderQueryInput,
  response: unknown,
  providerName: string
): ValidatedProviderDocument[] => {
  if (!isProviderFindResponse<unknown>(response, params)) {
    return invalidProviderQueryResult(
      params,
      'Provider variant queries must return a list envelope.',
      response,
      providerName
    )
  }
  return normalizeProviderResultDocuments(response.result, params, providerName)
}

const shapeNormalizedProviderQueryDocument = (
  normalized: ValidatedProviderDocument,
  params: ContentProviderQueryInput,
  runtimeConfig = getContentRuntimeConfig().content || {}
): Record<string, unknown> => {
  const config = runtimeConfig
  const localePolicy = resolveRuntimeCollectionLocalePolicy(normalized.collection, config)
  if (!localePolicy) {
    throw createContentProviderError(
      'provider_result_invalid',
      'Content collection locale policy is missing from runtime config.',
      { collection: normalized.collection, provider: 'runtime', operation: 'query', field: 'localePolicy' }
    )
  }
  const normalizedVariants = normalized.routeVariants
  const variants = Object.fromEntries(
    normalizedVariants.map(variant => [
      variant.locale,
      unmountProviderContentPath(variant.contentPath, variant.locale, localePolicy)
    ])
  )
  const requestedLocale = params.resolveVariant?.locale || params.resolveLocale?.locale
  const envelope = buildContentDocumentEnvelope({
    unprefixedPath: unmountProviderContentPath(normalized.contentPath, normalized.locale, localePolicy),
    variantPaths: variants,
    requestedLocale,
    resolvedLocale: normalized.locale,
    localePolicy,
    requestedPath: params.resolveVariant?.path,
    requestedRoute: params.resolveVariant?.route
  })

  const {
    contentPath: _contentPath,
    routeVariants: _routeVariants,
    resolved: _resolved,
    ...document
  } = normalized

  const shaped = {
    ...document,
    locale: envelope.locale,
    route: envelope.route,
    resolution: envelope.resolution
  } satisfies Record<string, unknown>

  const selected = Array.isArray(params.only) ? params.only.map(String) : []
  if (selected.length) {
    const guaranteed = new Set(['id', 'collection', 'canonicalKey', 'locale', 'route', 'resolution'])
    return Object.fromEntries(
      Object.entries(shaped).filter(([key]) => guaranteed.has(key) || selected.includes(key))
    )
  }

  const excluded = Array.isArray(params.without) ? params.without.map(String) : []
  return withoutKeys(excluded)(shaped) ?? shaped
}

const shapeProviderQueryDocument = (
  value: unknown,
  params: ContentProviderQueryInput,
  providerName?: string,
  runtimeConfig = getContentRuntimeConfig().content || {}
): Record<string, unknown> => {
  const normalized = normalizeProviderResultDocuments([value], params, providerName, runtimeConfig)[0]!
  return shapeNormalizedProviderQueryDocument(normalized, params, runtimeConfig)
}

const emitMountedPathSelectorMissDiagnostic = (
  params: ContentProviderQueryInput,
  runtimeConfig: ReturnType<typeof getContentRuntimeConfig>['content']
): void => {
  if (!shouldEmitRuntimeDiagnostics(resolveRuntimeEnvironment(), Boolean(import.meta.prerender))) return
  if (!params.collection) return
  const policy = resolveRuntimeCollectionLocalePolicy(params.collection, runtimeConfig)
  if (!policy) return
  const diagnostic = collectMountedPathSelectorMissDiagnostic(params, policy)
  if (diagnostic) emitRuntimeDiagnostics([diagnostic])
}

export const normalizeProviderQueryResponse = <T>(
  params: ContentProviderQueryInput,
  response: unknown,
  providerName?: string,
  runtimeConfig = getContentRuntimeConfig().content || {}
): ContentQueryResponse<T> => {
  if (params.count) {
    if (isProviderCountResponse(response)) {
      return response
    }
    return invalidProviderQueryResult(params, 'Provider count queries must return a count envelope: { result: number }.', response, providerName)
  }

  if (params.first) {
    if (isProviderFindOneResponse<T>(response)) {
      if (response.result === undefined) {
        emitMountedPathSelectorMissDiagnostic(params, runtimeConfig)
        return { result: response.result }
      }
      return {
        result: shapeProviderQueryDocument(response.result, params, providerName, runtimeConfig) as T
      }
    }
    return invalidProviderQueryResult(params, 'Provider first queries must return a find-one envelope: { result: item | undefined }.', response, providerName)
  }

  if (isProviderFindResponse<T>(response, params)) {
    const documents = normalizeProviderResultDocuments(response.result, params, providerName, runtimeConfig)
    return {
      ...response,
      result: documents.map(document => shapeNormalizedProviderQueryDocument(document, params, runtimeConfig) as T)
    }
  }

  if (isObject(response) && hasListEnvelopeKeys(response)) {
    return invalidProviderQueryResult(params, 'Provider list query envelopes must be either { result, skip, limit, total } (offset) or { mode: \'cursor\', result, limit, pageInfo: { endCursor, hasNext } } (cursor).', response, providerName)
  }

  return invalidProviderQueryResult(params, 'Provider list queries must return a list envelope: { result: item[], skip, limit, total } (offset) or { mode: \'cursor\', result, limit, pageInfo } (cursor).', response, providerName)
}

const identityMatchesDocument = (document: ValidatedProviderDocument, identity: string) => {
  const normalizedIdentity = normalizeReferenceValue(identity)
  if (!normalizedIdentity) {
    return false
  }

  return [document.canonicalKey, document.contentPath, document.ref]
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
  assertConfiguredProviderCollection(options.collection, runtimeContent)
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
  const identityFilter = {
    $or: [
      { canonicalKey: normalizedReference },
      { path: `/${normalizedReference}` },
      { ref: normalizedReference }
    ]
  }
  const baseQuery = {
    collection: options.collection,
    where: [identityFilter],
    only: ['path', 'canonicalKey', 'locale', 'ref', 'title', 'description', 'body'],
  }
  const documents = localesToQuery.length
    ? (
        await Promise.all(
          localesToQuery.map(async (locale) => {
            const localeQuery = { ...baseQuery, resolveLocale: { locale, exact: true } }
            return normalizeRawProviderDocuments(
              localeQuery,
              await provider.query(event, createProviderQuery(localeQuery)),
              provider.name
            )
          }),
        )
      ).flat()
    : normalizeRawProviderDocuments(
        baseQuery,
        await provider.query(event, createProviderQuery(baseQuery)),
        provider.name
      )
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
      .filter(document => document.locale && document.contentPath)
      .map(document => [document.locale, document.contentPath]),
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
