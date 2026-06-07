import { createError, type H3Event } from 'h3'
import type { ContentQueryBuilderParams } from '../../types/query'
import { lowerQueryPlan } from '../../core/query/lower'
import { executeQueryPlan } from '../../core/query/execute'
import { ContentError, type ContentErrorCode } from '../../core/errors'
import { normalizeContentQueryParams } from '../../core/query/params'
import { compileWhere } from '../../core/query/filter'
import { containsStandaloneRegexOptions, findUnsupportedQueryOperator } from '../../core/query/operators'
import { withResolvedRefs, withResolvedRefsList } from '../../storage/references'
import { getContentGraph } from '../../storage/graph'
import { getContentRuntimeConfig } from './runtime-config'
import { isPreview } from '../../integrations/nitro/preview'
import { createContentProviderError } from '../../public/provider-errors'
import { MAX_PUBLIC_QUERY_LIMIT, MAX_PUBLIC_QUERY_SKIP } from '../query/public-limits'

const notFound = (query: ContentQueryBuilderParams, description = 'Could not find document for the given query.') => {
  throw createError({
    statusMessage: 'Document not found!',
    statusCode: 404,
    data: {
      description,
      query
    }
  })
}

/**
 * HTTP-boundary mapping for typed content errors.
 *
 * Content-shape failures are author-visible (500-class: the build is broken),
 * not request-visible (4xx). `INVALID_REF_VALUE` is the exception: it's a
 * single malformed frontmatter value we surface as a 422 so CI can isolate
 * the offending file without a stack trace.
 */
const statusForContentError: Partial<Record<ContentErrorCode, number>> = {
  INVALID_REF_VALUE: 422
}

const toHttpError = (error: ContentError, query: ContentQueryBuilderParams) => createError({
  statusCode: statusForContentError[error.code] ?? 500,
  statusMessage: error.code,
  message: error.message,
  data: { code: error.code, context: error.context, query }
})

const badQuery = (message: string) => {
  throw createError({
    statusCode: 400,
    statusMessage: 'Invalid content query',
    message
  })
}

const containsPublicRegex = (value: unknown): boolean => {
  if (value instanceof RegExp) {
    return true
  }

  if (!value || typeof value !== 'object') {
    return false
  }

  if (Array.isArray(value)) {
    return value.some(containsPublicRegex)
  }

  const record = value as Record<string, unknown>
  return Object.entries(record).some(([key, child]) => key === '$regex' || containsPublicRegex(child))
}

const normalizePublicQuery = (
  event: H3Event,
  query: ContentQueryBuilderParams,
  config: ReturnType<typeof getContentRuntimeConfig>['content']
) => {
  if (!query.collection) {
    badQuery('Public content queries must target a collection.')
  }

  if (containsPublicRegex(query.where)) {
    badQuery('Public content queries do not accept RegExp filters.')
  }

  if (containsStandaloneRegexOptions(query.where)) {
    badQuery('Query operator $options requires $regex.')
  }

  const enforceProductionVisibility = !import.meta.dev && !isPreview(event)
  const normalized = normalizeContentQueryParams({
    ...query,
    limit: typeof query.limit === 'number' ? Math.max(0, Math.min(query.limit, MAX_PUBLIC_QUERY_LIMIT)) : query.limit,
    skip: typeof query.skip === 'number' ? Math.max(0, Math.min(query.skip, MAX_PUBLIC_QUERY_SKIP)) : query.skip
  }, {
    collectionI18n: query.collection ? config.collections?.[query.collection]?.i18n : undefined,
    defaultLocale: config.defaultLocale,
    localeFallback: config.localeFallback,
    includeDraftFilter: false
  })

  if (enforceProductionVisibility) {
    const where = Array.isArray(normalized.where)
      ? normalized.where
      : normalized.where
        ? [normalized.where]
        : []
    normalized.where = [
      ...where,
      { _draft: { $ne: true } },
      { _partial: { $ne: true } }
    ]
  }

  const normalizedWhere = Array.isArray(normalized.where)
    ? normalized.where
    : normalized.where
      ? [normalized.where]
      : []
  normalized.where = normalizedWhere
    .map(condition => compileWhere(condition as never))
    .filter((condition): condition is NonNullable<ReturnType<typeof compileWhere>> => Boolean(condition))

  const unsupported = findUnsupportedQueryOperator(normalized.where)
  if (unsupported) {
    throw createContentProviderError('unsupported_query_operator', `Unsupported query operator: ${unsupported}`, {
      operator: unsupported
    })
  }

  return normalized
}

export const executeFilesystemContentQuery = async <T = unknown>(event: H3Event, inputQuery: ContentQueryBuilderParams) => {
  const config = getContentRuntimeConfig().content || {}
  const query = normalizePublicQuery(event, inputQuery, config)
  let graph
  try {
    graph = await getContentGraph(event)
  } catch (cause) {
    if (cause instanceof ContentError) {
      throw toHttpError(cause, query)
    }
    throw cause
  }
  const plan = lowerQueryPlan(query)
  const response = executeQueryPlan(graph, plan, {
    defaultLocale: config.defaultLocale,
    localeFallback: config.localeFallback,
    collections: config.collections
  })

  if (plan.mode === 'count') {
    return response.result as T
  }

  const requestedLocale = plan.resolveVariant?.locale || plan.resolveLocale?.locale

  if (plan.mode === 'first') {
    const content = response.result
    if (!content) {
      notFound(query, plan.resolveVariant ? 'Could not find document for the given route variant.' : undefined)
    }

    return await withResolvedRefs(event, content, requestedLocale) as T
  }

  return await withResolvedRefsList(event, Array.isArray(response.result) ? response.result : [], requestedLocale) as T[]
}

export const executeContentQuery = executeFilesystemContentQuery
