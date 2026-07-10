/**
 * Content cache contracts.
 *
 * Pure interfaces only — no implementation, no framework imports. The default
 * implementation lives in `src/storage/cache.ts`; `integrations/nitro/context.ts`
 * references these types to hold a per-context reference without creating a
 * layering violation against the core → storage → integrations dependency order.
 */

/**
 * Deduplicates concurrent in-flight work by key. If two callers ask for the
 * same key before the first factory resolves, both observe the same promise.
 * The entry is removed as soon as the promise settles, so subsequent reads
 * re-run the factory.
 */
export interface SingleFlightMap<T> {
  run(key: string, factory: () => Promise<T>): Promise<T>
}

/**
 * Request-scoped content cache. Holds the single-flight map that prevents
 * two concurrent parses of the same `(storageId, hash)` inside one request
 * (VNEXT.md 15.7). The complete contents-list load is deduplicated by the
 * caller's own `memoizeRuntimeValue(event, key, ...)` instead of a second,
 * request-scoped list cache/single-flight pair here — that second layer had
 * no invalidation source independent of the memo it duplicated, so it is
 * intentionally not part of this store.
 */
export interface ContentCacheStore<TContent> {
  readonly inflightContents: SingleFlightMap<TContent[]>
}
