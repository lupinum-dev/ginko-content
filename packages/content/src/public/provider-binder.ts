import type { H3Event } from 'h3'

import type { ContentCacheHintInput } from '../core/cache-hints'
import type { ContentProviderSearchRequest } from '../types/search'
import {
  CONTENT_DATA_SOURCE_LIMITS,
  type BoundedContentProviderQuery,
  type ContentDataSource,
  type ContentDataSourceCacheHint,
  type ContentDataSourceControl,
} from './data-source'
import {
  withContentCache,
  type ContentProvider,
  type ContentProviderNavigationOptions,
  type ContentProviderSurroundingsOptions,
} from './provider'

const contexts = new WeakMap<object, Map<object, Promise<unknown>>>()
const safeErrorKeys = new Set(['code', 'field', 'path', 'collection', 'locale', 'operation'])

function normalizedBackendError(cause: unknown): Error {
  if (cause instanceof Error && /disposed|aborted|deadline|timeout/i.test(cause.message)) return cause
  const record = cause && typeof cause === 'object' ? cause as Record<string, unknown> : {}
  const rawCode = typeof record.code === 'string' ? record.code : 'BACKEND_FAILURE'
  const code = /token|secret|password|cookie|authorization/i.test(rawCode)
    ? 'BACKEND_FAILURE'
    : rawCode.slice(0, 128)
  const rawDetails = record.details && typeof record.details === 'object'
    ? record.details as Record<string, unknown>
    : {}
  const details = Object.fromEntries(
    Object.entries(rawDetails)
      .filter(([key, value]) => safeErrorKeys.has(key) && typeof value === 'string')
      .map(([key, value]) => [key, String(value).slice(0, 512)]),
  )
  return Object.assign(new Error('Content data-source operation failed.'), {
    code,
    data: { code, details },
  })
}

const positiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0

function assertBoundedQuery<Context>(
  source: ContentDataSource<Context>,
  query: Parameters<ContentProvider['query']>[1],
): asserts query is BoundedContentProviderQuery {
  const limit = query.plan.limit
  if (query.plan.mode === 'count') {
    if (limit !== undefined || query.plan.paging !== undefined) {
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
  if (query.plan.mode === 'all' && query.plan.paging && query.plan.paging.limit !== limit) {
    throw new RangeError('Paging limit must equal the data-source query limit.')
  }
}

const utf8Bytes = (value: string) => new TextEncoder().encode(value.normalize('NFC')).length

function cacheHint(hint: ContentDataSourceCacheHint | false): ContentCacheHintInput {
  if (hint === false) return false
  const exactKeys = ['etag', 'lastModified', 'maxAge', 'paths', 'swr', 'tags']
  if (Object.keys(hint).sort().join('\0') !== exactKeys.join('\0')) {
    throw new TypeError('Content data-source cache hint has an invalid shape.')
  }
  const validateKeys = (values: string[], maximum: number, label: string) => {
    if (!Array.isArray(values) || values.length > maximum) {
      throw new RangeError(`Content data-source cache ${label} exceed the limit.`)
    }
    for (const value of values) {
      if (typeof value !== 'string' || !value || utf8Bytes(value) > CONTENT_DATA_SOURCE_LIMITS.maxCacheKeyBytes) {
        throw new TypeError(`Content data-source cache ${label} contain an invalid value.`)
      }
    }
  }
  validateKeys(hint.tags, CONTENT_DATA_SOURCE_LIMITS.maxCacheTags, 'tags')
  validateKeys(hint.paths, CONTENT_DATA_SOURCE_LIMITS.maxCachePaths, 'paths')
  for (const value of [hint.maxAge, hint.swr]) {
    if (value !== null && (!Number.isInteger(value) || value < 0 || value > CONTENT_DATA_SOURCE_LIMITS.maxCacheTtlSeconds)) {
      throw new RangeError('Content data-source cache TTL exceeds the limit.')
    }
  }
  if (hint.lastModified !== null && (!Number.isSafeInteger(hint.lastModified) || hint.lastModified < 0)) {
    throw new TypeError('Content data-source lastModified is invalid.')
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
  let rejectAbort!: (reason: Error) => void
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject })
  const dispose = () => {
    controller.abort()
    rejectAbort(new Error('Content data-source request was disposed or aborted.'))
  }
  request?.once?.('close', dispose)
  const timer = setTimeout(dispose, CONTENT_DATA_SOURCE_LIMITS.maxBackendDurationMs)
  try {
    return await Promise.race([operation({ signal: controller.signal, deadlineAt }), aborted])
  } finally {
    clearTimeout(timer)
    request?.off?.('close', dispose)
  }
}

export function bindContentProvider<Context>(args: {
  source: ContentDataSource<Context>
  createContext: (event: H3Event) => Context | Promise<Context>
}): ContentProvider {
  const { source } = args
  if (
    !source.name ||
    source.capabilities.protocol !== 'ginko-content-data-source/v1' ||
    !positiveInteger(source.capabilities.query.maxPageSize) ||
    source.capabilities.query.maxPageSize > CONTENT_DATA_SOURCE_LIMITS.maxQueryPageSize
  ) {
    throw new TypeError('Invalid Content data-source capabilities.')
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
      return await execute(event, (context, control) => source.query(context, query, control))
    }) as ContentProvider['query'],
    navigation: source.navigation
      ? async (event, query, options: ContentProviderNavigationOptions = {}) => {
          assertBoundedQuery(source, query)
          const limit = Math.min(query.plan.mode === 'count' ? 0 : query.plan.limit, CONTENT_DATA_SOURCE_LIMITS.maxNavigationNodes)
          if (!positiveInteger(limit)) throw new RangeError('Navigation requires a positive limit.')
          return await execute(event, (context, control) =>
            source.navigation!(context, query, { ...options, limit }, control),
          )
        }
      : undefined,
    surroundings: source.surroundings
      ? async (event, collection, contentPath, options: ContentProviderSurroundingsOptions = {}) =>
          await execute(event, async (context, control) => {
            const result = await source.surroundings!(context, collection, contentPath, options, control)
            if (result.data.length > CONTENT_DATA_SOURCE_LIMITS.maxSurroundItems) {
              throw new RangeError('Content data-source surroundings exceed the result limit.')
            }
            return result
          })
      : undefined,
    search: source.search
      ? async (event, request: ContentProviderSearchRequest) =>
          await execute(event, (context, control) =>
            source.search!(context, { ...request, limit: CONTENT_DATA_SOURCE_LIMITS.maxSearchResults }, control),
          )
      : undefined,
    siteData: (source.siteData
      ? async (event, request) =>
          await execute(event, async (context, control) => {
            const result = await source.siteData!(context, request, control)
            if (result.data.key !== request.key) throw new TypeError('Content data-source site-data key mismatch.')
            return result
          })
      : undefined) as ContentProvider['siteData'],
    routes: source.routes
      ? async (event) =>
          await execute(event, async (context, control) => {
            const items = []
            let cursor: string | null = null
            let snapshot: string | null = null
            let cache: ContentDataSourceCacheHint | false = false
            do {
              const page = await source.routes!(context, { cursor, limit: CONTENT_DATA_SOURCE_LIMITS.maxRoutePageSize }, control)
              if (page.data.items.length > CONTENT_DATA_SOURCE_LIMITS.maxRoutePageSize) {
                throw new RangeError('Content data-source route page exceeds the result limit.')
              }
              if (snapshot !== null && page.data.snapshot !== snapshot) {
                throw new TypeError('Content data-source route snapshot changed during enumeration.')
              }
              snapshot = page.data.snapshot
              items.push(...page.data.items)
              if (items.length > CONTENT_DATA_SOURCE_LIMITS.maxTotalRoutes) {
                throw new RangeError('Content data-source total routes exceed the configured limit.')
              }
              cursor = page.data.nextCursor
              cache = page.cache
            } while (cursor !== null)
            return { data: items, cache }
          })
      : undefined,
  }
}
