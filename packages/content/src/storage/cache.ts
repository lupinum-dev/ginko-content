import type { H3Event } from 'h3'
import type { ParsedContent } from '../types/content'
import type { ContentCacheStore, SingleFlightMap } from '../core/cache'
import { getContentRuntimeContext } from '../integrations/nitro/context'

/**
 * Single-flight primitive. Each factory for a given key resolves exactly once;
 * concurrent callers share the same promise. The entry clears on settle so the
 * next call after resolution re-runs the factory.
 *
 * Intentionally kept as a pure factory — no module-level state — so the store
 * factory below can create per-store instances without cross-store leakage.
 */
export const createSingleFlightMap = <T>(): SingleFlightMap<T> => {
  const pending = new Map<string, Promise<T>>()

  return {
    run(key, factory) {
      if (!pending.has(key)) {
        pending.set(key, Promise.resolve()
          .then(factory)
          .finally(() => {
            pending.delete(key)
          }))
      }

      return pending.get(key)!
    }
  }
}

/**
 * Build a fresh content cache store. Holds only the per-source single-flight
 * map (VNEXT.md 15.7) — no request-scoped "contents list" map lives here,
 * since `storage/contents.ts#getContentsList` already deduplicates the
 * complete-list load through `memoizeRuntimeValue`. Tests should create one
 * store per test to stay isolated.
 */
export const createContentCacheStore = (): ContentCacheStore<ParsedContent> => ({
  inflightContents: createSingleFlightMap<ParsedContent[]>()
})

/**
 * Resolve the cache store for a given request. Each event gets its own store,
 * lazily created on first access and retained only for the request lifetime.
 */
export const cacheStoreFor = (event: H3Event): ContentCacheStore<ParsedContent> => {
  const runtime = getContentRuntimeContext(event)
  runtime.caches ||= createContentCacheStore()
  return runtime.caches
}
