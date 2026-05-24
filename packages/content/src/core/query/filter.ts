/**
 * Query compiler for the unified query API (ADR-0016).
 *
 * `by` selects one document through the graph resolver. `where` filters a
 * result set. Keeping those paths separate is the public contract.
 *
 * Operator names are deliberately close to the internal
 * `ContentQueryBuilderWhere` shape. Public `$prefix` is kept as `$prefix`
 * through the transport instead of being exposed as caller-provided regex.
 */
import type {
  ContentSelector,
  ContentQueryBuilderParams,
  ContentQueryBuilderWhere,
  ContentQuerySortFields,
  LocaleFallback,
  QueryWhere,
  QueryOperators,
  SortSpec
} from '../../types/query'
import { assertSupportedQueryOperators, SUPPORTED_QUERY_OPERATORS } from './operators'
import { normalizeContentPath } from '../content/path'

const FIELD_OPERATOR_KEYS = new Set([...SUPPORTED_QUERY_OPERATORS, '$nin'])

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof RegExp) && !(value instanceof Date)

const isOperatorObject = (value: unknown): value is QueryOperators<unknown> => {
  if (!isPlainObject(value)) return false
  // An operator object has at least one $-prefixed key. A nested filter has
  // non-$ keys (field names). Mixed objects are rejected at validation time.
  for (const key of Object.keys(value)) {
    if (key.startsWith('$') && FIELD_OPERATOR_KEYS.has(key)) return true
  }
  return false
}

/**
 * Translate a single field's operand into the internal `where`-condition shape.
 * The internal shape `{ field: <scalar> }` means equality; `{ field: { $op: ... } }`
 * means an operator. We pass through MongoDB-style operands directly.
 */
const compileFieldOperand = (operand: unknown): ContentQueryBuilderWhere[string] => {
  if (operand === undefined) {
    return undefined
  }

  // Plain scalar / RegExp / Date → equality
  if (!isPlainObject(operand)) {
    return operand as ContentQueryBuilderWhere[string]
  }

  // Operator object — pass through but normalize $nin (not in)
  if (isOperatorObject(operand)) {
    const out: Record<string, unknown> = {}
    for (const [op, value] of Object.entries(operand)) {
      if (op === '$nin') {
        out.$not = { $in: value }
      } else {
        out[op] = value
      }
    }
    return out as ContentQueryBuilderWhere[string]
  }

  // Nested filter on a sub-object (e.g. `{ nested: { level: { $eq: 2 } } }`)
  return compileWhere(operand as QueryWhere) as ContentQueryBuilderWhere[string]
}

/**
 * Compile a public `where` object to the internal `where` clause shape.
 */
export const compileWhere = (where: QueryWhere | undefined): ContentQueryBuilderWhere | undefined => {
  if (!where) return undefined
  assertSupportedQueryOperators(where, ['$nin', '$prefix'])

  const out: ContentQueryBuilderWhere = {}

  for (const [key, value] of Object.entries(where)) {
    if (value === undefined) continue

    if (key === '$and' || key === '$or') {
      const arr = Array.isArray(value) ? value : []
      const compiled = arr
        .map(part => compileWhere(part as QueryWhere))
        .filter((part): part is ContentQueryBuilderWhere => Boolean(part && Object.keys(part).length > 0))
      if (compiled.length) {
        out[key] = compiled
      }
      continue
    }

    if (key === '$not') {
      const compiled = compileWhere(value as QueryWhere)
      if (compiled && Object.keys(compiled).length > 0) {
        out.$not = compiled
      }
      continue
    }

    const targetKey = key === 'path' ? '_path' : key
    const operand = compileFieldOperand(value)
    if (operand !== undefined) {
      ;(out as Record<string, unknown>)[targetKey] = operand
    }
  }

  return Object.keys(out).length ? out : undefined
}

/**
 * Convert `SortSpec` (e.g. `{ date: -1, title: 1 }`) into the array form the
 * transport expects.
 */
export const compileSort = (sort: SortSpec | undefined): ContentQuerySortFields[] | undefined => {
  if (!sort) return undefined
  const fields = Object.entries(sort)
    .map(([field, value]) => {
      const direction = value === 'asc' ? 1 : value === 'desc' ? -1 : value
      return [field, direction] as const
    })
    .filter(([, v]) => v === 1 || v === -1)
  if (!fields.length) return undefined
  return fields.map(([field, direction]) => ({ [field]: direction as 1 | -1 }))
}

/**
 * Normalize `fallback` (string / array / boolean) into the transport shape.
 * Boolean `true` means "use configured fallbacks"; an explicit string or array
 * overrides the chain for this query.
 */
export const compileFallback = (
  fallback: LocaleFallback | undefined
): boolean | string[] | undefined => {
  if (fallback === undefined) return undefined
  if (typeof fallback === 'boolean') return fallback
  if (fallback === 'default') return ['default']
  return Array.isArray(fallback) ? fallback : [fallback]
}

/**
 * Top-level compile: build the params payload sent to the transport. This is
 * the shared pipeline used by every Layer-1 verb.
 */
export const compileQueryParams = (input: {
  collection: string
  by?: ContentSelector
  where?: QueryWhere
  sort?: SortSpec
  limit?: number
  skip?: number
  select?: ReadonlyArray<string | number | symbol>
  locale?: string
  fallback?: LocaleFallback
  exact?: boolean
}): ContentQueryBuilderParams => {
  const path = input.by && 'path' in input.by ? normalizeContentPath(input.by.path) : undefined
  const route = input.by && 'route' in input.by ? normalizeContentPath(input.by.route) : undefined
  const ref = input.by && 'ref' in input.by ? input.by.ref : undefined
  const where = compileWhere(input.where)
  const sort = compileSort(input.sort)
  const fallback = compileFallback(input.fallback)
  const select = input.select ? input.select.map(String) : undefined

  const params: ContentQueryBuilderParams = {
    collection: input.collection,
    ...(where ? { where: [where] } : {}),
    ...(sort ? { sort } : {}),
    ...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
    ...(typeof input.skip === 'number' ? { skip: input.skip } : {}),
    ...(select ? { only: select } : {})
  }

  if (input.locale || path || route || ref || fallback !== undefined) {
    // When `locale` is set without `fallback`, default to `exact: true` so
    // the server returns only documents in that exact locale. Falling back
    // to a wider locale chain has to be opt-in via `fallback: true` (or an
    // explicit chain) — anything else lets the wrong-locale variant leak in.
    //
    // Tree callers can pass exact:false explicitly to keep navigation complete
    // when a requested locale is missing.
    const exact = input.exact ?? (input.locale ? fallback === undefined || fallback === false : false)
    params.resolveLocale = {
      ...(input.locale ? { locale: input.locale } : {}),
      ...(fallback !== undefined ? { fallback } : {}),
      ...(exact ? { exact: true } : {})
    }
  }

  // `by` selectors → graph-based variant resolver, but only when the caller
  // signals they care about locale resolution (locale or fallback).
  // For plain non-i18n queries we treat `path` as a `_path` field equality so
  // the query still works against collections that have no i18n config.
  // `ref` always uses the graph (refs are inherently a graph concept).
  const useVariantResolver = route || ref || (path && (input.locale !== undefined || fallback !== undefined))

  if (useVariantResolver) {
    ;(params as { resolveVariant?: { path?: string, route?: string, ref?: string, locale?: string, fallback?: boolean | string[], exact?: boolean } }).resolveVariant = {
      ...(path ? { path } : {}),
      ...(route ? { route } : {}),
      ...(ref ? { ref } : {}),
      ...(input.locale ? { locale: input.locale } : {}),
      ...(fallback !== undefined ? { fallback } : {}),
      ...(params.resolveLocale?.exact ? { exact: true } : {})
    }
  } else if (path) {
    // Plain path lookup — push `_path` equality into where so the standard
    // executor handles it without any variant logic.
    const pathClause: ContentQueryBuilderWhere = { _path: path }
    const existing = Array.isArray(params.where) ? params.where : params.where ? [params.where] : []
    params.where = [...existing, pathClause]
  }

  return params
}
