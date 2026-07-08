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
 * operands as `{ source, flags }`; the executor reconstructs the `RegExp`
 * immediately before matching (see `reviveRegex` in `./execute.ts`).
 */
export interface PlanRegex {
  source: string
  flags: string
}

/** True when `value` is a JSON-pure regex operand (`{ source, flags }`). */
export const isPlanRegex = (value: unknown): value is PlanRegex => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const record = value as Record<string, unknown>
  return typeof record.source === 'string'
    && typeof record.flags === 'string'
    && Object.keys(record).length === 2
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
}
