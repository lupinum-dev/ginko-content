/**
 * The internal, **immutable**, executor-facing query AST.
 *
 * Pipeline: public `ContentQueryBuilder` → `params` object → `lowerQueryPlan`
 * (see `./lower.ts`) → `ContentQueryPlan` → `executeQueryPlan`
 * (see `./execute.ts`).
 *
 * The plan is the stable boundary between "how the user wrote the query"
 * and "how we execute it." Downstream code should pattern-match on
 * `FilterExpr.type` rather than reading builder params directly. The plan
 * never carries Nuxt/H3/Vue concerns.
 *
 * The plan stays immutable so builders, lowerers, and executors can compose
 * without hidden shared state.
 */

/** Discriminator for a `{ type: 'compare' }` filter node. */
export type CompareOperator =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'nin'
  | 'contains'
  | 'containsAny'
  | 'icontains'
  | 'exists'
  | 'type'
  | 'regex'
  | 'prefix'

/**
 * JSON-pure representation of a regular expression on a compare node's value.
 *
 * The plan is the provider wire contract (CS-5) and must survive
 * `JSON.parse(JSON.stringify(plan))` unchanged — a live `RegExp` instance
 * serializes to `{}` and corrupts the wire. Lowering therefore stores regex
 * operands as a tagged object; the executor reconstructs the `RegExp`
 * immediately before matching (see `reviveRegex` in `./execute.ts`). The tag
 * keeps user data shaped like `{ source, flags }` from being mistaken for a
 * regex.
 */
export interface PlanRegex {
  __ginkoContentQueryValue: 'RegExp'
  source: string
  flags: string
}

/** True when `value` is a JSON-pure regex operand. */
export const isPlanRegex = (value: unknown): value is PlanRegex => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const record = value as Record<string, unknown>
  return record.__ginkoContentQueryValue === 'RegExp'
    && typeof record.source === 'string'
    && typeof record.flags === 'string'
    && Object.keys(record).length === 3
}

/**
 * Normalized where-clause AST. `{ type: 'true' }` is the identity node used
 * when the user did not pass any predicate; this keeps downstream code free
 * of `if (!filter)` branches.
 */
export type FilterExpr =
  | { type: 'true' }
  | { type: 'compare', field: string, operator: CompareOperator, value?: unknown }
  | { type: 'and', clauses: FilterExpr[] }
  | { type: 'or', clauses: FilterExpr[] }
  | { type: 'not', clause: FilterExpr }

/**
 * One sort term. Clauses are applied in order — earlier fields dominate;
 * later fields act as tiebreakers.
 */
export interface SortClause {
  field: string
  direction: -1 | 1
  locale?: string
  numeric?: boolean
  caseFirst?: 'upper' | 'lower' | 'false'
  sensitivity?: 'base' | 'accent' | 'case' | 'variant'
}

/** Projection is applied after filter/sort but before mode. `only` wins over `without` if both are set. */
export interface Projection {
  only: string[]
  without: string[]
}

/** Terminal shape of the query. Set by `.all()`, `.first()`, or `.count()` on the builder. */
export type QueryMode = 'all' | 'first' | 'count'

/**
 * Locale resolution parameters. Populated when a caller uses `.locale(...)`
 * on the builder or when the adapter injects the active request locale.
 * When set, the executor dedupes variants across the fallback chain rather
 * than returning every variant.
 */
export interface LocaleResolution {
  locale?: string
  fallback?: string[]
  exact?: boolean
}

/**
 * Variant resolution for route-backed page lookup. Used by unified `one(...)`
 * route selectors and internal route helpers to resolve a localized route path, then fall
 * back through the locale chain if the requested locale is missing.
 */
export interface VariantResolution {
  /**
   * Localized or canonical route path to look up via `byRoute` + locale chain.
   * Mutually exclusive with `route` and `ref`.
   */
  path?: string
  /**
   * Public app route to resolve through collection route mounts before looking
   * up the locale variant. Mutually exclusive with `path` and `ref`.
   */
  route?: string
  /**
   * Stable authored alias resolved through `byRef`/`referenceTargets` to a
   * canonical key, then to the locale-correct variant. Mutually exclusive
   * with `path` and `route`.
   */
  ref?: string
  locale?: string
  fallback?: string[]
  exact?: boolean
}

/**
 * Provider wire pagination semantics (CS-5 v2, VNEXT.md 13.1). Exactly one of
 * two honest modes: `offset` guarantees skip + an exact total; `cursor`
 * guarantees an opaque forward cursor with no synthetic total. Present on the
 * plan only when the caller made an explicit paging choice (`paginate()`, or
 * `many({ skip })` needing offset semantics) — a plain unbounded/limited
 * `many()` carries no `paging` and keeps its existing skip/limit slicing
 * untouched, so this is additive rather than a restructuring of every list
 * query.
 */
export type ContentProviderPaginationMode = 'offset' | 'cursor'

export type ContentProviderPaging =
  | { mode: 'offset', skip: number, limit: number }
  | { mode: 'cursor', after?: string | null, limit: number }

/**
 * Closed provider-wire route/ref selector (VNEXT.md 13.1). Core resolves a
 * public `by.route` through locale prefix and collection mounts (via the
 * canonical route projector, `lowerRouteToCandidates`) before dispatch, and
 * hands the provider an ordered, exact `{ locale, contentPath }` candidate
 * list instead of a raw route the provider would otherwise have to guess a
 * mount for. Ref lookups carry the resolved locale fallback chain instead of
 * a raw `locale`/`fallback` pair for the same reason.
 */
export type ContentProviderVariantSelector =
  | { by: 'route', requestedLocale: string, candidates: readonly { locale: string, contentPath: string }[] }
  | { by: 'ref', ref: string, requestedLocale: string, localeChain: readonly string[] }

/**
 * Complete executor-facing plan. Construct via `lowerQueryPlan(params)`;
 * execute via `executeQueryPlan(graph, plan, options)`. Do not mutate.
 */
export interface ContentQueryPlan {
  collection?: string
  filter: FilterExpr
  sort: SortClause[]
  projection: Projection
  skip: number
  limit?: number
  mode: QueryMode
  resolveLocale?: LocaleResolution
  resolveVariant?: VariantResolution
  /** Explicit wire pagination-mode request for `mode: 'all'` plans (see `ContentProviderPaging`). */
  paging?: ContentProviderPaging
  /**
   * Closed route/ref wire selector, computed by the provider-query lowering
   * step (`runtime/server/provider-query.ts`) from `resolveVariant` using the
   * resolved collection locale policy. Populated only when `resolveVariant`
   * names a `route` or `ref` selector.
   */
  variantSelector?: ContentProviderVariantSelector
}
