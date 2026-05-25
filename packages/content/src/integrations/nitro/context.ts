/**
 * Nitro request-scoped runtime context.
 *
 * This file defines the single place where mutable, request-scoped state lives.
 * The hard rule is:
 *
 *   Anything request-scoped lives on `ContentRuntimeContext`.
 *   Nowhere else. Not in module-level `let`s, not in cached imports.
 *
 * Why: Nitro reuses the process across requests. Module-level `let` leaks one
 * request's parsed content, graph, or in-flight promises into another — a
 * silent correctness bug that's near-impossible to reproduce locally.
 *
 * The context is attached to `event.context.__contentRuntime` and created
 * lazily on first access. Memoization uses `memoizeRuntimeValue` so the
 * expensive per-request values are shared across helpers within a single
 * request but torn down with the event.
 */
import type { H3Event } from 'h3'
import type { Storage } from 'unstorage'
import type { ParsedContent } from '../../types/content'
import type { ContentContext as RuntimeContentConfig } from '../../types/module'
import type { ContentCacheStore } from '../../core/cache'
import type { ContentCacheHint } from '../../public/provider'
import { getContentRuntimeConfig } from './runtime-config'

/**
 * Per-request runtime state. Everything request-scoped belongs here; nothing
 * request-scoped belongs in module-level singletons.
 *
 * `caches` holds the request-local parsed-content store and single-flight maps.
 * It is populated lazily on first access by
 * `storage/cache.ts#cacheStoreFor()` so this module does not have to reach into
 * the `storage` layer at construction time (that would break the allowed
 * dependency direction `integrations/ → storage/`, never the reverse).
 */
export interface ContentRuntimeContext {
  config: RuntimeContentConfig
  now: () => Date
  storages?: {
    sourceStorage: Storage
    cacheStorage: Storage
    cacheParsedStorage: Storage
  }
  memo: Record<string, unknown | Promise<unknown> | undefined>
  caches?: ContentCacheStore<ParsedContent>
  cacheHint?: ContentCacheHint | false
}

type ContentEventContext = H3Event['context'] & {
  __contentRuntime?: ContentRuntimeContext
}

const createRuntimeContext = (): ContentRuntimeContext => ({
  config: getContentRuntimeConfig().content as RuntimeContentConfig,
  now: () => new Date(),
  memo: {}
})

export const getContentRuntimeContext = (event: H3Event): ContentRuntimeContext => {
  const context = ((event as H3Event & { context?: ContentEventContext }).context ||= {}) as ContentEventContext
  context.__contentRuntime ||= createRuntimeContext()
  return context.__contentRuntime
}

/**
 * Memoize an expensive per-request value.
 *
 * Concurrent callers within a single request that hit the same key all await
 * the one `create()` promise — we do not start a second compute. The cache
 * lives on `runtime.memo` so it is freed when the event is garbage-collected.
 *
 * GOTCHA: `create` runs only on miss. If you need a fresh value mid-request,
 * you cannot use this helper — mutate `runtime.memo[key]` directly. In
 * practice, nothing we build mid-request invalidates the graph.
 */
export const memoizeRuntimeValue = async <T> (
  event: H3Event,
  key: string,
  create: () => Promise<T>
): Promise<T> => {
  const runtime = getContentRuntimeContext(event)
  const cached = runtime.memo[key]
  if (typeof cached !== 'undefined') {
    return cached as T
  }

  const pending = create()
  runtime.memo[key] = pending

  try {
    const value = await pending
    runtime.memo[key] = value
    return value
  } catch (error) {
    runtime.memo[key] = undefined
    throw error
  }
}
