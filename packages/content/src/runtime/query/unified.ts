/**
 * Layer 1 of the unified query API (ADR-0016).
 *
 * Context-explicit async functions: `one`, `many`, `resolveOne`, `variants`, `tree`, `neighbors`.
 * Each accepts a typed collection handle (from `defineCollection`) plus an
 * options object. Locale is type-required when the handle declares i18n.
 *
 * Implementation strategy: compile the public `by` / `where` options to an
 * internal `ContentQueryBuilderParams` payload via `compileQueryParams`, then
 * dispatch through the explicit `ContentQueryContext` transport provided by
 * the client or server entrypoint.
 *
 * Documents are post-processed by `localizePageResult` to attach `path`,
 * `locale`, `localePaths`, and `variants` — the route metadata that powers
 * locale switching with zero extra round trips.
 */
import type { ParsedContent } from '../../types/content'
import type {
  ContentCollectionHandle
} from '../../types/config'
import type {
  BacklinkSource,
  BacklinksOptions,
  BacklinksResult,
  ContentSelector,
  ContentTreeItem,
  DocumentFromHandle,
  LocaleFallback,
  ManyOptions,
  LocalizedDoc,
  NeighborsOptions,
  NeighborsResult,
  OneOptions,
  QueryWhere,
  PopulateSpec,
  PopulateFromOptions,
  PopulatedDocument,
  PaginationOptions,
  PaginationResult,
  ResolutionEnvelope,
  ResolveOneOptions,
  ResolveOneResult,
  TreeOptions,
  ContentVariant,
  ContentQueryBuilderParams,
  VariantsOptions
} from '../../types/query'
import type { ContentQueryResponse } from '../../types/api'
import { compileQueryParams } from '../../core/query/filter'
import { decorateLocalePathsWithFallbacks, localizePageResult } from '../../features/localization/results'
import { normalizeRouteMounts } from '../../features/localization/path'
import { normalizeReferenceValue } from '../../core/references/resolve'
import { collectTopLevelReferenceFields, collectTopLevelReferenceFieldsByTarget } from '../../core/references/schema'
import { MAX_PUBLIC_QUERY_LIMIT, MAX_PUBLIC_QUERY_SKIP } from './public-limits'

export interface RuntimeContentConfig {
  locales?: string[]
  defaultLocale?: string
  collections?: Record<string, { i18n?: boolean | { locales?: string[], defaultLocale?: string }, route?: string | Record<string, string>, references?: Record<string, string[]> }>
}

export type ContentQueryEndpoint = 'query' | 'navigation'

export interface ContentQueryContext {
  runtime: RuntimeContentConfig
  transport: <T>(endpoint: ContentQueryEndpoint, params: ContentQueryBuilderParams) => Promise<ContentQueryResponse<T> | T | T[] | null>
}

const NAVIGATION_INTERNAL_FIELDS = [
  '_id',
  '_path',
  '_file',
  '_canonicalKey',
  '_locale',
  '_draft',
  'navigation',
  'title'
] as const

const LOCALIZED_DOC_INTERNAL_FIELDS = [
  '_id',
  '_path',
  '_file',
  '_canonicalKey',
  '_locale',
  '_resolvedLocale',
  '_requestedLocale',
  '_fallback',
  '_availableLocales',
  '_variantPaths',
  '_requestedPath',
  '_requestedRoute',
  '_requestedRef',
  '_extension'
] as const

export const navigationSelectFields = (fields: ReadonlyArray<string> | undefined = []) => [
  ...new Set([...NAVIGATION_INTERNAL_FIELDS, ...fields])
]

const isNotFoundError = (error: unknown) => {
  const statusCode = (error as { statusCode?: number, response?: { status?: number } })?.statusCode
    ?? (error as { response?: { status?: number } })?.response?.status
  return statusCode === 404
}

const isQueryEnvelope = (response: unknown): response is {
  result?: unknown
  total?: unknown
  skip?: unknown
  limit?: unknown
} => Boolean(response && typeof response === 'object' && 'result' in response)

const unwrapResponse = <T>(response: unknown): T | T[] | null => {
  if (!response) return null
  if (isQueryEnvelope(response)) {
    const result = response.result
    return (result ?? null) as T | T[] | null
  }
  return response as T
}

const unwrapFindResponse = <T>(response: unknown): {
  result: T[]
  total: number
  skip: number
  limit: number
  hasTotal: boolean
} => {
  if (!response) {
    return { result: [], total: 0, skip: 0, limit: 0, hasTotal: false }
  }

  if (isQueryEnvelope(response)) {
    const result = Array.isArray(response.result) ? response.result as T[] : response.result ? [response.result as T] : []
    const hasTotal = typeof response.total === 'number'
    return {
      result,
      total: hasTotal ? response.total as number : result.length,
      skip: typeof response.skip === 'number' ? response.skip : 0,
      limit: typeof response.limit === 'number' ? response.limit : result.length,
      hasTotal
    }
  }

  const result = Array.isArray(response) ? response as T[] : [response as T]
  return { result, total: result.length, skip: 0, limit: result.length, hasTotal: false }
}

const unwrapCountResponse = (response: unknown) => {
  if (typeof response === 'number') {
    return response
  }
  if (isQueryEnvelope(response) && typeof response.result === 'number') {
    return response.result
  }
  return null
}

/**
 * Decorate a raw parsed document with route-meta + localePaths.
 *
 * `localizePageResult` already attaches `path`, `canonicalPath`, `locale`,
 * `defaultLocale`, `variants`, and `localePaths`. We additionally fill in
 * non-translated locales using the requested-locale path as fallback so the
 * caller can render a complete language switcher without a second query.
 */
const decorate = <T extends ParsedContent & Record<string, unknown>>(
  doc: T | null,
  collection: string,
  runtime: RuntimeContentConfig | undefined,
  requestedLocale?: string
): LocalizedDoc<T> | null => {
  if (!doc) return null
  // Best-effort locale list: prefer the per-collection i18n config, fall
  // back to the runtime defaults, then to the locales actually present on
  // the document itself.
  const collectionI18n = runtime?.collections?.[collection]?.i18n
  const collectionLocales = collectionI18n && typeof collectionI18n === 'object' ? collectionI18n.locales : undefined
  const collectionDefault = collectionI18n && typeof collectionI18n === 'object' ? collectionI18n.defaultLocale : undefined
  const locales = collectionLocales?.length ? collectionLocales : (runtime?.locales?.length ? runtime.locales : [])
  const defaultLocale = collectionDefault || runtime?.defaultLocale
  const routeMounts = normalizeRouteMounts(runtime?.collections?.[collection]?.route, locales, defaultLocale)
  const hasLocaleConfig = Boolean(locales.length || defaultLocale)
  const page = hasLocaleConfig
    ? doc
    : {
        ...doc,
        _locale: '',
        _resolvedLocale: undefined,
        _requestedLocale: undefined,
        _variantPaths: undefined,
        _availableLocales: []
      }
  const result = localizePageResult(page, hasLocaleConfig ? requestedLocale : undefined, defaultLocale, locales, routeMounts)
  // Backfill non-translated locales (the route resolver already chose a doc
  // for us; we expose every configured locale's path so a switcher can render
  // every language even when a variant is missing in that locale).
  const fallbackLocale = (doc._resolvedLocale || requestedLocale || defaultLocale) as string | undefined
  result.localePaths = decorateLocalePathsWithFallbacks(result.localePaths, locales, fallbackLocale, defaultLocale, routeMounts)
  return result as LocalizedDoc<T>
}

/**
 * Accept either a typed collection handle (preferred — produced by
 * `defineCollection`) or a raw collection-name string. The string form is
 * provided for module-internal use (e.g. the auto-injected `content.vue`
 * fallback page) and for callers that only have a runtime collection name.
 */
const collectionDefaultLocale = (collection: string, runtime: RuntimeContentConfig | undefined) => {
  const collectionI18n = runtime?.collections?.[collection]?.i18n
  const collectionDefault = collectionI18n && typeof collectionI18n === 'object' ? collectionI18n.defaultLocale : undefined
  return collectionDefault || runtime?.defaultLocale
}

const resolveFallback = (
  fallback: LocaleFallback | undefined,
  collection: string,
  runtime: RuntimeContentConfig | undefined
): Exclude<LocaleFallback, 'default'> | undefined => {
  if (fallback !== 'default') return fallback
  return collectionDefaultLocale(collection, runtime)
}

const explainResolution = (
  collection: string,
  requestedBy: ContentSelector,
  normalizedBy: ContentSelector,
  requestedLocale: string | undefined,
  requestedFallback: LocaleFallback | undefined,
  doc: LocalizedDoc<ParsedContent> | null
): ResolutionEnvelope => {
  const resolvedLocale = doc?.resolved?.locale || doc?.locale
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
      ...(doc?.path ? { path: doc.path } : {}),
      ...(doc?.canonicalPath ? { canonicalPath: doc.canonicalPath } : {}),
      ...((doc as unknown as { ref?: string } | null)?.ref ? { ref: (doc as unknown as { ref: string }).ref } : {}),
      ...(resolvedLocale ? { locale: resolvedLocale } : {})
    },
    fallback: {
      used: Boolean(requestedLocale && resolvedLocale && requestedLocale !== resolvedLocale),
      ...(requestedLocale && resolvedLocale && requestedLocale !== resolvedLocale ? { locale: resolvedLocale } : {})
    }
  }
}

const ensureCollectionName = <H extends ContentCollectionHandle | string>(handle: H): string => {
  if (typeof handle === 'string') return handle
  if (!handle || typeof handle !== 'object' || typeof (handle as { name?: unknown }).name !== 'string') {
    throw new TypeError('query API: expected a string collection name or a collection handle from defineContentConfig({ collections }). Use useContentPage(\'docs\') or config.collections.docs.')
  }
  return (handle as { name: string }).name
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const populateReferenceValue = async (
  context: ContentQueryContext,
  target: ContentCollectionHandle | string,
  value: unknown,
  locale: string | undefined,
  fallback: LocaleFallback | undefined
) => {
  if (typeof value !== 'string' || !value) {
    return null
  }

  return one(context, target, {
    by: { ref: value },
    ...(locale ? { locale } : {}),
    ...(fallback !== undefined ? { fallback } : {})
  } as OneOptions<ContentCollectionHandle | string>)
}

const wildcardReferenceTarget = '*'

const collectReferenceFieldsByTarget = (
  source: ContentCollectionHandle | string,
  sourceCollection: string,
  runtime: RuntimeContentConfig | undefined
) => {
  if (typeof source !== 'string') {
    return collectTopLevelReferenceFieldsByTarget((source as { schema?: unknown }).schema)
  }

  return runtime?.collections?.[sourceCollection]?.references || {}
}

const invertReferenceFields = (references: Record<string, string[]>) => {
  const fields = new Map<string, string[]>()
  for (const [target, targetFields] of Object.entries(references)) {
    for (const field of targetFields) {
      const targets = fields.get(field) || []
      targets.push(target)
      fields.set(field, targets)
    }
  }
  return fields
}

const createPopulateTargetMismatchError = (
  sourceCollection: string,
  field: string,
  expectedTargets: string[],
  actualTarget: string
) => new Error([
  `Cannot populate "${sourceCollection}.${field}" from "${actualTarget}".`,
  `Reference metadata declares "${sourceCollection}.${field}" points to ${expectedTargets.map(target => `"${target}"`).join(' or ')}.`,
  `Change populate.${field} to the declared target collection, or update ${sourceCollection}.schema relation metadata.`
].join(' '))

const validatePopulateSpec = (
  source: ContentCollectionHandle | string,
  sourceCollection: string,
  runtime: RuntimeContentConfig | undefined,
  populate: PopulateSpec | undefined
) => {
  if (!populate || !isRecord(populate)) {
    return
  }

  const references = collectReferenceFieldsByTarget(source, sourceCollection, runtime)
  const fieldTargets = invertReferenceFields(references)
  if (!fieldTargets.size) {
    return
  }

  for (const [field, target] of Object.entries(populate)) {
    const declaredTargets = fieldTargets.get(field)
    if (!declaredTargets?.length) {
      continue
    }

    const actualTarget = ensureCollectionName(target)
    if (declaredTargets.includes(actualTarget) || declaredTargets.includes(wildcardReferenceTarget)) {
      continue
    }

    throw createPopulateTargetMismatchError(
      sourceCollection,
      field,
      declaredTargets.filter(target => target !== wildcardReferenceTarget),
      actualTarget
    )
  }
}

const populateDocument = async <T extends ParsedContent, P extends PopulateSpec | undefined>(
  context: ContentQueryContext,
  doc: LocalizedDoc<T>,
  populate: P,
  locale: string | undefined,
  fallback: LocaleFallback | undefined
): Promise<LocalizedDoc<PopulatedDocument<T, P>>> => {
  if (!populate || !isRecord(populate)) {
    return doc as LocalizedDoc<PopulatedDocument<T, P>>
  }

  const populated: Record<string, unknown> = { ...doc }
  await Promise.all(Object.entries(populate).map(async ([field, target]) => {
    const value = (doc as Record<string, unknown>)[field]
    if (Array.isArray(value)) {
      const resolved = await Promise.all(value.map(item => populateReferenceValue(context, target, item, locale, fallback)))
      populated[field] = resolved.filter(Boolean)
      return
    }
    populated[field] = await populateReferenceValue(context, target, value, locale, fallback)
  }))

  return populated as LocalizedDoc<PopulatedDocument<T, P>>
}

const selectWithPopulate = (
  select: ReadonlyArray<string> | undefined,
  populate: PopulateSpec | undefined
) => {
  if (!select) {
    return undefined
  }
  return [...new Set([
    ...select,
    ...LOCALIZED_DOC_INTERNAL_FIELDS,
    ...(populate && isRecord(populate) ? Object.keys(populate) : [])
  ])]
}

/* -------------------------------------------------------------------------- */
/* resolveOne / one                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Resolve exactly one document and return an explanation of how it matched.
 */
export async function resolveOne<
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
  const params = compileQueryParams({
    collection,
    by,
    locale: options.locale,
    fallback,
    select: selectWithPopulate(options.select as ReadonlyArray<string> | undefined, options.populate)
  })

  // one/resolveOne always ask for one document — set `first: true` so the server
  // executor unwraps `{ result: doc }` to the doc rather than coercing it to
  // an empty array (which is its `mode: 'all'` fallback for non-array results).
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

  const unwrapped = unwrapResponse<ParsedContent>(response)
  const doc = Array.isArray(unwrapped) ? (unwrapped[0] ?? null) : (unwrapped ?? null)
  const decorated = decorate(doc as ParsedContent, collection, runtime, options.locale)
  const populated = decorated
    ? await populateDocument(context, decorated, options.populate, options.locale, options.fallback)
    : null
  const explain = explainResolution(collection, options.by, by, options.locale, options.fallback, decorated)
  return {
    doc: populated,
    explain
  } as ResolveOneResult<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>>
}

/**
 * Ergonomic doc-only view over `resolveOne`.
 */
export async function one<
  const H extends ContentCollectionHandle | string,
  O extends OneOptions<H, PopulateSpec | undefined>
>(
  context: ContentQueryContext,
  handle: H,
  options: O
): Promise<LocalizedDoc<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>> | null> {
  const result = await resolveOne(context, handle, options)
  return result.doc
}

/* -------------------------------------------------------------------------- */
/* many                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Resolve a list of documents matching the filter. Always returns an array.
 */
export async function many<
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

  const unwrapped = unwrapResponse<ParsedContent>(response)
  const list = Array.isArray(unwrapped) ? unwrapped : unwrapped ? [unwrapped] : []
  const decorated = list
    .map(doc => decorate(doc as ParsedContent, collection, runtime, options.locale))
    .filter((doc): doc is LocalizedDoc<ParsedContent> => Boolean(doc))
  const populated = await Promise.all(decorated.map(doc => populateDocument(context, doc, options.populate, options.locale, options.fallback)))
  return populated as Array<LocalizedDoc<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>>>
}

/* -------------------------------------------------------------------------- */
/* paginate                                                                   */
/* -------------------------------------------------------------------------- */

const normalizePositiveInteger = (value: unknown, fallback: number) => {
  const number = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
  return Math.max(1, number)
}

/**
 * Resolve one page of documents and preserve the query envelope metadata.
 */
export async function paginate<
  const H extends ContentCollectionHandle | string,
  O extends PaginationOptions<H, PopulateSpec | undefined>
>(
  context: ContentQueryContext,
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
    .map(doc => decorate(doc as ParsedContent, collection, runtime, options.locale))
    .filter((doc): doc is LocalizedDoc<ParsedContent> => Boolean(doc))
  const populated = await Promise.all(decorated.map(doc => populateDocument(context, doc, options.populate, options.locale, options.fallback)))
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

/* -------------------------------------------------------------------------- */
/* backlinks                                                                  */
/* -------------------------------------------------------------------------- */

const backlinkSources = (value: BacklinkSource | ReadonlyArray<BacklinkSource>): BacklinkSource[] =>
  Array.isArray(value) ? [...value as BacklinkSource[]] : [value as BacklinkSource]

const isBacklinkFieldMap = (value: unknown): value is Record<string, ReadonlyArray<string>> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const resolveExplicitBacklinkFields = (
  fields: BacklinksOptions['fields'],
  sourceName: string
) => {
  if (Array.isArray(fields)) {
    return fields.filter((field): field is string => typeof field === 'string' && field.length > 0)
  }

  if (!isBacklinkFieldMap(fields)) {
    return []
  }

  const sourceFields = fields?.[sourceName]
  return Array.isArray(sourceFields)
    ? sourceFields.filter((field): field is string => typeof field === 'string' && field.length > 0)
    : []
}

const inferBacklinkFields = (
  source: BacklinkSource,
  targetCollection: string,
  runtime: RuntimeContentConfig | undefined
) => {
  if (typeof source === 'string') {
    const references = runtime?.collections?.[source]?.references
    return [
      ...(references?.[targetCollection] || []),
      ...(references?.['*'] || [])
    ]
  }

  return collectTopLevelReferenceFields((source as { schema?: unknown }).schema, targetCollection)
}

const targetReferenceCandidates = (doc: LocalizedDoc<ParsedContent>) => {
  const values = [
    (doc as { ref?: unknown }).ref,
    (doc as { id?: unknown }).id,
    doc._canonicalKey,
    doc._path,
    doc._path ? doc.path : undefined,
    doc._path ? doc.canonicalPath : undefined
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .flatMap(value => [value, normalizeReferenceValue(value)])
    .filter(Boolean)

  return Array.from(new Set(values))
}

const backlinkWhere = (fields: string[], candidates: string[]): QueryWhere | undefined => {
  const clauses = fields.map(field => ({
    [field]: { $in: candidates }
  }))
  return clauses.length ? { $or: clauses } as QueryWhere : undefined
}

const createMissingBacklinkFieldsError = (
  sourceCollection: string,
  targetCollection: string
) => new Error(
  `Cannot infer backlink fields from "${sourceCollection}" to "${targetCollection}". `
  + `Declare fields.relation('${targetCollection}') / fields.relations('${targetCollection}') in ${sourceCollection}.schema, `
  + 'or pass fields explicitly.'
)

/**
 * Resolve documents in source collections that reference one target document.
 */
export async function backlinks<
  const Target extends ContentCollectionHandle | string,
  const Source extends BacklinkSource | ReadonlyArray<BacklinkSource>,
  P extends PopulateSpec | undefined = undefined
>(
  context: ContentQueryContext,
  targetHandle: Target,
  options: BacklinksOptions<Target, Source, P>
): Promise<BacklinksResult<Source, P>> {
  const targetCollection = ensureCollectionName(targetHandle)
  const target = await one(context, targetHandle, {
    by: options.by,
    ...(options.locale ? { locale: options.locale } : {}),
    ...(options.fallback !== undefined ? { fallback: options.fallback } : {})
  } as OneOptions<Target>)

  if (!target) {
    return [] as BacklinksResult<Source, P>
  }

  const candidates = targetReferenceCandidates(target as LocalizedDoc<ParsedContent>)
  if (!candidates.length) {
    return [] as BacklinksResult<Source, P>
  }

  const sources = backlinkSources(options.from)
  const results = await Promise.all(sources.map(async (source) => {
    const sourceName = ensureCollectionName(source)
    const fields = [
      ...new Set([
        ...resolveExplicitBacklinkFields(options.fields, sourceName),
        ...inferBacklinkFields(source, targetCollection, context.runtime)
      ])
    ]
    if (!fields.length) {
      throw createMissingBacklinkFieldsError(sourceName, targetCollection)
    }
    const where = backlinkWhere(fields, candidates)
    if (!where) {
      return []
    }

    return await many(context, source, {
      where,
      sort: options.sort as never,
      limit: options.limit,
      skip: options.skip,
      ...(options.locale ? { locale: options.locale } : {}),
      ...(options.fallback !== undefined ? { fallback: options.fallback } : {}),
      select: options.select as ReadonlyArray<string> | undefined,
      populate: options.populate
    } as ManyOptions<typeof source, P>)
  }))

  return results.flat() as BacklinksResult<Source, P>
}

/* -------------------------------------------------------------------------- */
/* variants                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Enumerate every locale variant of one document. Identifies the document by
 * either its stable `ref:` or its canonical/localized `path`.
 *
 * Each entry carries a `translated: boolean` flag — `true` when that locale
 * has its own variant on disk, `false` when the resolver fell back to another
 * locale's path. `fallback` names the source locale when `translated` is false.
 */
export async function variants<H extends ContentCollectionHandle | string>(
  context: ContentQueryContext,
  handle: H,
  options: VariantsOptions<H>
): Promise<Array<ContentVariant<H extends { __schema: { _output: infer O } } ? O & ParsedContent : ParsedContent>>> {
  const collection = ensureCollectionName(handle)
  const runtime = context.runtime
  const collectionI18n = runtime?.collections?.[collection]?.i18n
  const collectionLocales = collectionI18n && typeof collectionI18n === 'object' ? collectionI18n.locales : undefined
  const collectionDefault = collectionI18n && typeof collectionI18n === 'object' ? collectionI18n.defaultLocale : undefined
  const locales = collectionLocales?.length ? collectionLocales : (runtime?.locales || [])
  const defaultLocale = collectionDefault || runtime?.defaultLocale
  const requestedLocales = options.locales?.length ? options.locales : locales
  if (!requestedLocales.length) {
    return []
  }

  // We resolve the document in its default locale once to fetch the canonical
  // variant map; then each locale's path is derived from `_variantPaths`.
  const seed = await one(context, handle, {
    by: options.by,
    locale: options.locale || defaultLocale,
    fallback: true
  } as unknown as OneOptions<H>)
  if (!seed) return []

  const variantPaths = (seed as unknown as { _variantPaths?: Record<string, string> })._variantPaths || {}
  const sourceLocale = (seed as unknown as { locale?: string }).locale || defaultLocale || ''

  return requestedLocales.map((locale) => {
    const variantPath = variantPaths[locale]
    if (variantPath) {
      return {
        locale,
        path: (seed as unknown as { localePaths?: Record<string, { path: string }> }).localePaths?.[locale]?.path || variantPath,
        translated: true
      } as ContentVariant
    }
    // No variant for this locale → fall back to the source locale's URL.
    return {
      locale,
      path: (seed as unknown as { path: string }).path,
      translated: false,
      fallback: sourceLocale
    } as ContentVariant
  }) as Array<ContentVariant<H extends { __schema: { _output: infer O } } ? O & ParsedContent : ParsedContent>>
}

/* -------------------------------------------------------------------------- */
/* tree                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Resolve the navigation tree for a collection. The shape mirrors
 * the provider navigation query but is a thin builder over the same transport.
 *
 * Locale fallback is on-by-default: every doc appears in the tree even when
 * it has no variant in the requested locale (the resolver substitutes the
 * fallback locale's path). This matches legacy navigation semantics —
 * sidebars are inherently lossy when filtered too strictly.
 */
export async function tree<
  H extends ContentCollectionHandle | string,
  Fields extends ReadonlyArray<string> | undefined = undefined
>(
  context: ContentQueryContext,
  handle: H,
  options: Omit<TreeOptions<H>, 'fields'> & { fields?: Fields } = {} as Omit<TreeOptions<H>, 'fields'> & { fields?: Fields }
): Promise<ContentTreeItem<H extends { __schema: { _output: infer O } } ? O & ParsedContent : ParsedContent, Fields>[]> {
  const collection = ensureCollectionName(handle)
  const runtime = context.runtime
  const fallback = resolveFallback(options.fallback, collection, runtime)
  const params = compileQueryParams({
    collection,
    where: options.where as QueryWhere | undefined,
    sort: options.sort,
    locale: options.locale,
    fallback,
    select: navigationSelectFields(options.fields as ReadonlyArray<string> | undefined),
    exact: options.fallback === undefined ? false : undefined
  })

  // Reuse the navigation endpoint — the existing handler already merges
  // navigation metadata with optional page fields and applies locale.
  const response = await context.transport('navigation', params)
  const list = Array.isArray(response)
    ? response
    : Array.isArray((response as { result?: unknown })?.result)
      ? (response as { result: unknown[] }).result
      : []
  return list as ContentTreeItem<H extends { __schema: { _output: infer O } } ? O & ParsedContent : ParsedContent, Fields>[]
}

/* -------------------------------------------------------------------------- */
/* neighbors                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Return the previous/next navigation entries surrounding a document.
 */
export async function neighbors<H extends ContentCollectionHandle | string>(
  context: ContentQueryContext,
  handle: H,
  options: NeighborsOptions<H>
): Promise<NeighborsResult<H extends { __schema: { _output: infer O } } ? O & ParsedContent : ParsedContent>> {
  // Resolve the document first so we can identify its path within the nav tree.
  const seed = await one(context, handle, {
    by: options.by,
    locale: options.locale,
    fallback: options.fallback ?? true
  } as unknown as OneOptions<H>)

  if (!seed) return { prev: null, next: null }

  const fullTree = await tree(context, handle, {
    locale: options.locale,
    fallback: options.fallback,
    fields: options.fields
  } as TreeOptions<H>)

  // Walk the tree depth-first into a flat list ordered by document.
  const flat: Array<{ path: string, item: unknown }> = []
  const walk = (nodes: unknown[]) => {
    for (const node of nodes) {
      const n = node as { path?: string, _path?: string, children?: unknown[] }
      if (n.path || n._path) {
        flat.push({ path: n.path || n._path || '', item: node })
      }
      if (Array.isArray(n.children)) walk(n.children)
    }
  }
  walk(fullTree)

  const targetPath = (seed as unknown as { path: string }).path
  const idx = flat.findIndex(entry => entry.path === targetPath)
  if (idx === -1) return { prev: null, next: null }
  return {
    prev: (flat[idx - 1]?.item as unknown as ContentTreeItem<ParsedContent>) ?? null,
    next: (flat[idx + 1]?.item as unknown as ContentTreeItem<ParsedContent>) ?? null
  } as NeighborsResult<H extends { __schema: { _output: infer O } } ? O & ParsedContent : ParsedContent>
}
