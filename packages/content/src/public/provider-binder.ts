import type { H3Event } from 'h3'

import type { ContentCacheHintInput } from '../core/cache-hints'
import { withContentCache } from '../core/provider-result'
import type { ContentProviderSearchRequest } from '../types/search'
import { collectJsonPurityViolations } from '../core/json-value'
import { isContentDataSourceError } from '../core/data-source-error'
import {
  ContentRouteRecordValidationError,
  normalizeRawContentRouteRecord,
} from '../core/provider-route-record'
import {
  CONTENT_DATA_SOURCE_LIMITS,
  type BoundedContentProviderQuery,
  type ContentDataSource,
  type ContentDataSourceCacheHint,
  type ContentDataSourceControl,
} from './data-source'
import type {
  ContentProvider,
  ContentProviderSurroundingsOptions,
  ContentRouteRecord,
} from './provider-contract'
import { isContentProviderQueryCapabilities } from './provider-contract'

const contexts = new WeakMap<object, Map<object, Promise<unknown>>>()
class ContentDataSourceControlError extends Error {
  readonly code: 'BACKEND_ABORTED' | 'BACKEND_TIMEOUT'

  constructor(code: 'BACKEND_ABORTED' | 'BACKEND_TIMEOUT', message: string) {
    super(message)
    this.name = 'ContentDataSourceControlError'
    this.code = code
  }
}

type ContentDataSourceValidationErrorCode =
  | 'CACHE_HINT_INVALID'
  | 'RESPONSE_INVALID'
  | 'RESULT_LIMIT_EXCEEDED'
  | 'ROUTE_ENUMERATION_INVALID'

class ContentDataSourceValidationError extends Error {
  readonly code: ContentDataSourceValidationErrorCode

  constructor(code: ContentDataSourceValidationErrorCode, message: string) {
    super(message)
    this.name = 'ContentDataSourceValidationError'
    this.code = code
  }
}

function normalizedBackendError(cause: unknown): Error {
  const surfaced = (code: string, statusCode: number, message: string) => Object.assign(new Error(message), {
    code,
    statusCode,
    statusMessage: code,
    data: { code },
  })
  if (cause instanceof ContentDataSourceControlError) {
    return surfaced(cause.code, cause.code === 'BACKEND_TIMEOUT' ? 504 : 499, cause.message)
  }
  if (isContentDataSourceError(cause)) {
    return surfaced(
      cause.code,
      cause.code === 'QUERY_CURSOR_INVALID' ? 400 : 502,
      cause.code === 'QUERY_CURSOR_INVALID'
        ? 'Content data-source query cursor is invalid.'
        : 'Content data-source operation failed.'
    )
  }
  const validationError = cause instanceof ContentDataSourceValidationError ? cause : null
  const code = validationError?.code ?? 'BACKEND_FAILURE'
  return surfaced(code, 502, validationError?.message ?? 'Content data-source operation failed.')
}

const positiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0

const dataSourceError = (code: ContentDataSourceValidationErrorCode, message: string): Error =>
  new ContentDataSourceValidationError(code, message)

function assertBoundedQuery<Context>(
  source: ContentDataSource<Context>,
  query: Parameters<ContentProvider['query']>[1],
): asserts query is BoundedContentProviderQuery {
  const limit = query.plan.pagination.limit
  if (query.plan.mode === 'count') {
    if (limit !== undefined || query.plan.pagination.mode !== 'slice') {
      throw new TypeError('Count data-source queries cannot carry a limit or paging.')
    }
    return
  }
  if (
    !positiveInteger(limit) ||
    limit > CONTENT_DATA_SOURCE_LIMITS.maxQueryPageSize ||
    limit > source.capabilities.query.maxPageSize
  ) {
    throw new RangeError('Content data-source query limit exceeds the page-size ceiling.')
  }
  if (query.plan.mode === 'first' && limit !== 1) {
    throw new RangeError('First data-source queries require limit 1.')
  }
}

const utf8Bytes = (value: string) => new TextEncoder().encode(value).length
const credentialPattern = /https?:\/\/[^/@\s]+@|[?&](?:access_token|api[_-]?key|token|secret|password)=/i

function navigationNodeCount(items: unknown[], limit: number): number {
  let count = 0
  const visit = (nodes: unknown[]) => {
    for (const node of nodes) {
      count += 1
      if (count > limit) return
      if (node && typeof node === 'object') {
        const children = (node as { children?: unknown }).children
        if (Array.isArray(children)) visit(children)
      }
    }
  }
  visit(items)
  return count
}

function cacheHint(hint: ContentDataSourceCacheHint | false): ContentCacheHintInput {
  if (hint === false) return false
  const exactKeys = ['etag', 'lastModified', 'maxAge', 'paths', 'swr', 'tags']
  if (Object.keys(hint).sort().join('\0') !== exactKeys.join('\0')) {
    throw dataSourceError('CACHE_HINT_INVALID', 'Content data-source cache hint has an invalid shape.')
  }
  const validateKeys = (values: string[], maximum: number, label: string) => {
    if (!Array.isArray(values) || values.length > maximum) {
      throw dataSourceError('CACHE_HINT_INVALID', `Content data-source cache ${label} exceed the limit.`)
    }
    for (const value of values) {
      if (
        typeof value !== 'string' ||
        !value ||
        value !== value.normalize('NFC') ||
        utf8Bytes(value) > CONTENT_DATA_SOURCE_LIMITS.maxCacheKeyBytes ||
        (label === 'paths' && !value.startsWith('/'))
      ) {
        throw dataSourceError('CACHE_HINT_INVALID', `Content data-source cache ${label} contain an invalid value.`)
      }
      if (credentialPattern.test(value)) {
        throw dataSourceError('CACHE_HINT_INVALID', `Content data-source cache ${label} contain credentials.`)
      }
    }
  }
  validateKeys(hint.tags, CONTENT_DATA_SOURCE_LIMITS.maxCacheTags, 'tags')
  validateKeys(hint.paths, CONTENT_DATA_SOURCE_LIMITS.maxCachePaths, 'paths')
  for (const value of [hint.maxAge, hint.swr]) {
    if (value !== null && (!Number.isInteger(value) || value < 0 || value > CONTENT_DATA_SOURCE_LIMITS.maxCacheTtlSeconds)) {
      throw dataSourceError('CACHE_HINT_INVALID', 'Content data-source cache TTL exceeds the limit.')
    }
  }
  if (hint.lastModified !== null && (!Number.isSafeInteger(hint.lastModified) || hint.lastModified < 0)) {
    throw dataSourceError('CACHE_HINT_INVALID', 'Content data-source lastModified is invalid.')
  }
  if (hint.etag !== null && (
    typeof hint.etag !== 'string' ||
    !hint.etag ||
    utf8Bytes(hint.etag) > CONTENT_DATA_SOURCE_LIMITS.maxCacheKeyBytes ||
    credentialPattern.test(hint.etag)
  )) {
    throw dataSourceError('CACHE_HINT_INVALID', 'Content data-source ETag is invalid.')
  }
  return {
    tags: [...new Set(hint.tags)],
    paths: [...new Set(hint.paths)],
    ...(hint.maxAge === null ? {} : { maxAge: hint.maxAge }),
    ...(hint.swr === null ? {} : { swr: hint.swr }),
    ...(hint.etag === null ? {} : { etag: hint.etag }),
    ...(hint.lastModified === null ? {} : { lastModified: new Date(hint.lastModified) }),
  }
}

async function mergeDataSourceCacheHints(
  current: ContentDataSourceCacheHint | false | undefined,
  next: ContentDataSourceCacheHint | false,
): Promise<ContentDataSourceCacheHint | false> {
  cacheHint(next)
  if (current === false || next === false) return false
  if (!current) return next
  const tags = [...new Set([...current.tags, ...next.tags])].sort()
  const paths = [...new Set([...current.paths, ...next.paths])].sort()
  if (
    tags.length > CONTENT_DATA_SOURCE_LIMITS.maxCacheTags ||
    paths.length > CONTENT_DATA_SOURCE_LIMITS.maxCachePaths
  ) {
    throw dataSourceError('CACHE_HINT_INVALID', 'Merged Content data-source cache keys exceed the limit.')
  }
  const etags = [...new Set([current.etag, next.etag].filter((value): value is string => value !== null))].sort()
  let etag = etags[0] ?? null
  if (etags.length > 1) {
    const bytes = new TextEncoder().encode(JSON.stringify(etags))
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
    etag = `sha256:${[...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')}`
  }
  const smallest = (left: number | null, right: number | null) =>
    left === null ? right : right === null ? left : Math.min(left, right)
  return {
    tags,
    paths,
    maxAge: smallest(current.maxAge, next.maxAge),
    swr: smallest(current.swr, next.swr),
    etag,
    lastModified:
      current.lastModified === null
        ? next.lastModified
        : next.lastModified === null
          ? current.lastModified
          : Math.max(current.lastModified, next.lastModified),
  }
}

function contextFor<Context>(
  event: H3Event,
  source: ContentDataSource<Context>,
  createContext: (event: H3Event) => Context | Promise<Context>,
): Promise<Context> {
  const eventKey = event as unknown as object
  let bySource = contexts.get(eventKey)
  if (!bySource) {
    bySource = new Map()
    contexts.set(eventKey, bySource)
  }
  let pending = bySource.get(source as unknown as object)
  if (!pending) {
    pending = Promise.resolve(createContext(event)).then((context) => {
      if (context && typeof context === 'object') Object.freeze(context)
      return context
    })
    bySource.set(source as unknown as object, pending)
  }
  return pending as Promise<Context>
}

async function runControlled<T>(
  event: H3Event,
  operation: (control: ContentDataSourceControl) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  const deadlineAt = Date.now() + CONTENT_DATA_SOURCE_LIMITS.maxBackendDurationMs
  const request = event.node?.req as unknown as {
    once?: (name: string, listener: () => void) => void
    off?: (name: string, listener: () => void) => void
  }
  const response = event.node?.res as unknown as {
    once?: (name: string, listener: () => void) => void
    off?: (name: string, listener: () => void) => void
  }
  let rejectAbort!: (reason: Error) => void
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject })
  const abort = (error: ContentDataSourceControlError) => {
    if (controller.signal.aborted) return
    controller.abort(error)
    rejectAbort(error)
  }
  const dispose = () => abort(new ContentDataSourceControlError(
    'BACKEND_ABORTED',
    'Content data-source request was disposed or aborted.',
  ))
  const timeout = () => abort(new ContentDataSourceControlError(
    'BACKEND_TIMEOUT',
    'Content data-source operation exceeded its deadline.',
  ))
  request?.once?.('aborted', dispose)
  response?.once?.('close', dispose)
  const timer = setTimeout(timeout, CONTENT_DATA_SOURCE_LIMITS.maxBackendDurationMs)
  try {
    return await Promise.race([operation({ signal: controller.signal, deadlineAt }), aborted])
  } finally {
    clearTimeout(timer)
    request?.off?.('aborted', dispose)
    response?.off?.('close', dispose)
  }
}

const assertControlActive = (control: ContentDataSourceControl) => {
  if (control.signal.aborted) {
    throw control.signal.reason instanceof Error
      ? control.signal.reason
      : new ContentDataSourceControlError('BACKEND_ABORTED', 'Content data-source request was disposed or aborted.')
  }
  if (Date.now() >= control.deadlineAt) {
    throw new ContentDataSourceControlError('BACKEND_TIMEOUT', 'Content data-source operation exceeded its deadline.')
  }
}

export function bindContentProvider<Context>(args: {
  source: ContentDataSource<Context>
  createContext: (event: H3Event) => Context | Promise<Context>
}): ContentProvider {
  const source = args?.source
  const queryCapabilities = source?.capabilities?.query
  if (
    !source ||
    !source.name ||
    source.capabilities?.protocol !== 'ginko-content-data-source/v1' ||
    !queryCapabilities ||
    !isContentProviderQueryCapabilities(queryCapabilities) ||
    !positiveInteger(queryCapabilities.maxPageSize) ||
    queryCapabilities.maxPageSize > CONTENT_DATA_SOURCE_LIMITS.maxQueryPageSize ||
    typeof source.query !== 'function' ||
    typeof args.createContext !== 'function'
  ) {
    throw new TypeError('Invalid Content data-source capabilities.')
  }
  for (const method of ['navigation', 'surroundings', 'search', 'siteData', 'routes'] as const) {
    if (source[method] !== undefined && typeof source[method] !== 'function') {
      throw new TypeError(`Invalid Content data-source method: ${method}.`)
    }
  }
  const execute = async <T>(event: H3Event, operation: (context: Context, control: ContentDataSourceControl) => Promise<{ data: T; cache: ContentDataSourceCacheHint | false }>) => {
    try {
      return await runControlled(event, async (control) => {
        const context = await contextFor(event, source, args.createContext)
        const result = await operation(context, control)
        return withContentCache(result.data, cacheHint(result.cache))
      })
    } catch (cause) {
      throw normalizedBackendError(cause)
    }
  }

  return {
    name: source.name as ContentProvider['name'],
    capabilities: {
      query: {
        operators: source.capabilities.query.operators,
        pagination: source.capabilities.query.pagination,
      },
    },
    query: (async (event, query) => {
      assertBoundedQuery(source, query)
      return await execute(event, async (context, control) => {
        const result = await source.query(context, query, control)
        const data = result.data as { result?: unknown }
        if (
          query.plan.mode !== 'count' &&
          Array.isArray(data.result) &&
          data.result.length > query.plan.pagination.limit
        ) {
          throw dataSourceError('RESULT_LIMIT_EXCEEDED', 'Content data-source query result limit exceeded.')
        }
        return result
      })
    }) as ContentProvider['query'],
    ...(source.navigation
      ? { navigation: async (event, query) => {
          assertBoundedQuery(source, query)
          const limit = Math.min(query.plan.mode === 'count' ? 0 : query.plan.pagination.limit, CONTENT_DATA_SOURCE_LIMITS.maxNavigationNodes)
          if (!positiveInteger(limit)) throw new RangeError('Navigation requires a positive limit.')
          return await execute(event, async (context, control) => {
            const result = await source.navigation!(context, query, { limit }, control)
            if (navigationNodeCount(result.data, limit) > limit) {
              throw dataSourceError('RESULT_LIMIT_EXCEEDED', 'Content data-source navigation result limit exceeded.')
            }
            return result
          })
        } }
      : {}),
    ...(source.surroundings
      ? { surroundings: async (event, collection, contentPath, options: ContentProviderSurroundingsOptions = {}) =>
          await execute(event, async (context, control) => {
            const result = await source.surroundings!(context, collection, contentPath, options, control)
            if (result.data.length > CONTENT_DATA_SOURCE_LIMITS.maxSurroundItems) {
              throw new RangeError('Content data-source surroundings exceed the result limit.')
            }
            return result
          }) }
      : {}),
    ...(source.search
      ? { search: async (event, request: ContentProviderSearchRequest) =>
          await execute(event, async (context, control) => {
            const limit = CONTENT_DATA_SOURCE_LIMITS.maxSearchResults
            const result = await source.search!(context, { ...request, limit }, control)
            if (result.data.length > limit) {
              throw dataSourceError('RESULT_LIMIT_EXCEEDED', 'Content data-source search result limit exceeded.')
            }
            return result
          }) }
      : {}),
    ...(source.siteData
      ? { siteData: async (event, request) =>
          await execute(event, async (context, control) => {
            const result = await source.siteData!(context, request, control)
            const requestedLocale = request.locale ?? null
            if (
              result.data.key !== request.key ||
              result.data.locale !== requestedLocale ||
              (result.data.updatedAt !== null && (
                !Number.isSafeInteger(result.data.updatedAt) || result.data.updatedAt < 0
              ))
            ) {
              throw dataSourceError('RESPONSE_INVALID', 'Content data-source site-data identity or timestamp mismatch.')
            }
            if (collectJsonPurityViolations(result.data.data).length) {
              throw dataSourceError('RESPONSE_INVALID', 'Content data-source site-data is not bounded JSON.')
            }
            const serialized = JSON.stringify(result.data.data)
            if (!serialized || utf8Bytes(serialized) > CONTENT_DATA_SOURCE_LIMITS.maxSiteDataBytes) {
              throw dataSourceError('RESULT_LIMIT_EXCEEDED', 'Content data-source site-data exceeds the byte limit.')
            }
            return {
              ...result,
              data: {
                data: result.data.data,
                ...(result.data.updatedAt === null ? {} : { updatedAt: result.data.updatedAt }),
              },
            }
          }) }
      : {}),
    ...(source.routes
      ? { routes: async (event) =>
          await execute(event, async (context, control) => {
            const items: ContentRouteRecord[] = []
            let totalBytes = 2
            let cursor: string | null = null
            let snapshot: string | null = null
            let cache: ContentDataSourceCacheHint | false | undefined
            const seenCursors = new Set<string>()
            do {
              assertControlActive(control)
              const page = await source.routes!(context, { cursor, limit: CONTENT_DATA_SOURCE_LIMITS.maxRoutePageSize }, control)
              assertControlActive(control)
              if (!page || !page.data || !Array.isArray(page.data.items)) {
                throw dataSourceError('ROUTE_ENUMERATION_INVALID', 'Content data-source returned an invalid route page.')
              }
              if (page.data.items.length > CONTENT_DATA_SOURCE_LIMITS.maxRoutePageSize) {
                throw dataSourceError('RESULT_LIMIT_EXCEEDED', 'Content data-source route page exceeds the result limit.')
              }
              if (
                typeof page.data.snapshot !== 'string' ||
                !page.data.snapshot ||
                utf8Bytes(page.data.snapshot) > CONTENT_DATA_SOURCE_LIMITS.maxCacheKeyBytes
              ) {
                throw dataSourceError('ROUTE_ENUMERATION_INVALID', 'Content data-source route snapshot is invalid.')
              }
              if (snapshot !== null && page.data.snapshot !== snapshot) {
                throw dataSourceError('ROUTE_ENUMERATION_INVALID', 'Content data-source route snapshot changed during enumeration.')
              }
              snapshot = page.data.snapshot
              for (const [index, item] of page.data.items.entries()) {
                try {
                  const normalized = normalizeRawContentRouteRecord(item, `routePage.items[${index}]`)
                  totalBytes += normalized.serializedBytes + (items.length === 0 ? 0 : 1)
                  if (totalBytes > CONTENT_DATA_SOURCE_LIMITS.maxTotalRouteBytes) {
                    throw dataSourceError('RESULT_LIMIT_EXCEEDED', 'Content data-source total routes exceed the aggregate byte limit.')
                  }
                  items.push(normalized.record)
                  if (items.length > CONTENT_DATA_SOURCE_LIMITS.maxTotalRoutes) {
                    throw dataSourceError('RESULT_LIMIT_EXCEEDED', 'Content data-source total routes exceed the configured limit.')
                  }
                } catch (error) {
                  if (error instanceof ContentRouteRecordValidationError) {
                    throw dataSourceError(error.code, `Content data-source route record is invalid at ${error.field}.`)
                  }
                  throw error
                }
              }
              const nextCursor = page.data.nextCursor
              if (nextCursor !== null) {
                if (page.data.items.length === 0) {
                  throw dataSourceError('ROUTE_ENUMERATION_INVALID', 'Content data-source route cursor made no progress.')
                }
                if (
                  typeof nextCursor !== 'string' ||
                  !nextCursor ||
                  utf8Bytes(nextCursor) > CONTENT_DATA_SOURCE_LIMITS.maxCacheKeyBytes ||
                  nextCursor === cursor ||
                  seenCursors.has(nextCursor)
                ) {
                  throw dataSourceError('ROUTE_ENUMERATION_INVALID', 'Content data-source route cursor made no progress.')
                }
                seenCursors.add(nextCursor)
              }
              cursor = nextCursor
              cache = await mergeDataSourceCacheHints(cache, page.cache)
            } while (cursor !== null)
            return { data: items, cache: cache ?? false }
          }) }
      : {}),
  }
}
