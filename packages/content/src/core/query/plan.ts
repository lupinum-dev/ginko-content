/**
 * The internal, **immutable**, executor-facing query AST.
 *
 * Pipeline: public query options → params IR → `lowerQueryPlan`
 * (see `./lower.ts`) → `LoweredQueryPlan` → runtime closure →
 * `CanonicalQueryPlan` → `executeQueryPlan`
 * (see `./execute.ts`).
 *
 * The plan is the stable boundary between "how the user wrote the query"
 * and "how we execute it." Downstream code should pattern-match on
 * `FilterExpr.type` rather than reading params IR directly. The plan
 * never carries Nuxt/H3/Vue concerns.
 *
 * The plan stays immutable so compilers, lowerers, and executors can compose
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
 * The plan is the provider wire contract and must survive
 * `JSON.parse(JSON.stringify(plan))` unchanged — a live `RegExp` instance
 * serializes to `{}` and corrupts the wire. Lowering therefore stores regex
 * operands as a tagged object; the executor reconstructs the `RegExp`
 * immediately before matching (see `reviveRegex` in `./execute.ts`). The tag
 * keeps user data shaped like `{ source, flags }` from being mistaken for a
 * regex.
 */
export interface PlanRegex {
  readonly __ginkoContentQueryValue: 'RegExp'
  readonly source: string
  readonly flags: string
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
  | { readonly type: 'true' }
  | { readonly type: 'compare', readonly field: string, readonly operator: CompareOperator, readonly value?: unknown }
  | { readonly type: 'and', readonly clauses: readonly FilterExpr[] }
  | { readonly type: 'or', readonly clauses: readonly FilterExpr[] }
  | { readonly type: 'not', readonly clause: FilterExpr }

/**
 * One sort term. Clauses are applied in order — earlier fields dominate;
 * later fields act as tiebreakers.
 */
export interface SortClause {
  readonly field: string
  readonly direction: -1 | 1
  readonly locale?: string
  readonly numeric?: boolean
  readonly caseFirst?: 'upper' | 'lower' | 'false'
  readonly sensitivity?: 'base' | 'accent' | 'case' | 'variant'
}

/** Projection is applied after filter/sort but before mode. `only` wins over `without` if both are set. */
export interface Projection {
  readonly only: readonly string[]
  readonly without: readonly string[]
}

/** Terminal shape of the query. Set by the unified query operation. */
export type QueryMode = 'all' | 'first' | 'count'

/**
 * Locale resolution parameters. Populated from unified query locale options
 * or when an adapter injects the active request locale.
 * When set, the executor dedupes variants across the fallback chain rather
 * than returning every variant.
 */
export interface LocaleResolution {
  readonly locale?: string
  readonly fallback?: readonly string[]
  readonly exact?: boolean
}

/**
 * Variant resolution for route-backed page lookup. Used by unified `one(...)`
 * route selectors and internal route helpers to resolve a localized route path, then fall
 * back through the locale chain if the requested locale is missing.
 */
interface LoweredVariantResolutionOptions {
  readonly locale?: string
  readonly fallback?: readonly string[]
  readonly exact?: boolean
}

/** Raw selector produced by lowering before application locale policy is applied. */
export type LoweredVariantSelector =
  | ({ readonly by: 'path', readonly path: string } & LoweredVariantResolutionOptions)
  | ({ readonly by: 'route', readonly route: string } & LoweredVariantResolutionOptions)
  | ({ readonly by: 'ref', readonly ref: string } & LoweredVariantResolutionOptions)

/**
 * Provider wire pagination semantics. Exactly one of
 * two honest modes: `offset` guarantees skip + an exact total; `cursor`
 * guarantees an opaque forward cursor with no synthetic total. Present on the
 * explicit provider pagination requested by `paginate()`.
 */
export type ContentProviderPaginationMode = 'offset' | 'cursor'

export type ContentProviderPaging =
  | { readonly mode: 'offset', readonly skip: number, readonly limit: number }
  | { readonly mode: 'cursor', readonly after?: string | null, readonly limit: number }

/** The single normalized pagination state carried by a query plan. */
export type ContentQueryPagination =
  | { readonly mode: 'slice', readonly skip: number, readonly limit?: number }
  | ContentProviderPaging

/**
 * Closed graph-executor selector. Every path is canonical and mount-agnostic;
 * the provider boundary owns the separate mounted wire representation.
 */
export type CanonicalVariantSelector =
  | ({
      readonly by: 'path'
      readonly canonicalPath: string
    } & LoweredVariantResolutionOptions)
  | {
      readonly by: 'route'
      readonly requestedRoute: string
      readonly requestedLocale: string
      readonly candidates: readonly { readonly locale: string, readonly canonicalPath: string }[]
    }
  | {
      readonly by: 'ref'
      readonly requestedRef: string
      readonly requestedLocale: string
      readonly localeChain: readonly string[]
    }

export interface QueryPlanBase {
  readonly collection?: string
  readonly filter: FilterExpr
  readonly sort: readonly SortClause[]
  readonly projection: Projection
  readonly pagination: ContentQueryPagination
  readonly mode: QueryMode
  readonly resolveLocale?: LocaleResolution
}

/** Internal lowering output. Route/ref members still require application policy. */
export interface LoweredQueryPlan extends QueryPlanBase {
  readonly variant?: LoweredVariantSelector
}

/** Closed, mount-agnostic plan accepted only by the in-process graph executor. */
export interface CanonicalQueryPlan extends QueryPlanBase {
  readonly variant?: CanonicalVariantSelector
}
