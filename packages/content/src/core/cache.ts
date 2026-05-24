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
 * Request-scoped content cache. Holds parsed-content lists keyed by a config
 * digest, plus two single-flight maps that prevent duplicate parse/load work
 * inside a single request.
 */
export interface ContentCacheStore<TContent> {
  getContents(key: string): TContent[] | undefined
  setContents(key: string, value: TContent[]): void
  clearContents(): void
  readonly inflightContents: SingleFlightMap<TContent[]>
  readonly inflightContentsList: SingleFlightMap<TContent[]>
}
