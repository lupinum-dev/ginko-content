/**
 * Lower `ContentQueryBuilderParams` (the public builder's serialized form)
 * into a `ContentQueryPlan` (the executor's AST — see `./plan.ts`).
 *
 * Lowering is the single place we translate user-level shapes (`$eq`,
 * `$and`, sibling-key-as-`$and`) into the normalized tree the executor
 * expects. Downstream code only touches the plan.
 *
 * The translation is purely syntactic — no graph access, no I/O. It runs
 * once per `.all()`/`.first()`/`.count()` call.
 */
import type { ContentQueryBuilderParams, ContentQueryBuilderWhere, ContentQuerySortOptions } from '../../types/query'
import type { CompareOperator, ContentQueryPlan, FilterExpr, SortClause } from './plan'
import { assertSupportedQueryOperators, SUPPORTED_QUERY_OPERATORS } from './operators'

const ensureQueryWhereArray = (where?: ContentQueryBuilderParams['where']) => {
  return Array.isArray(where) ? [...where] : where ? [where] : []
}

const COMPARISON_OPERATORS = new Set(SUPPORTED_QUERY_OPERATORS)

/**
 * Flatten redundant wrappers so the plan is minimal and predictable:
 *   - zero non-trivial clauses collapse to `{ type: 'true' }`
 *   - one clause passes through directly (no `{ type: 'and', clauses: [x] }`)
 *
 * Without this the plan is technically correct but annoying to pattern-match.
 */
const collapse = (type: 'and' | 'or', clauses: FilterExpr[]): FilterExpr => {
  const filtered = clauses.filter(clause => clause.type !== 'true')
  if (!filtered.length) {
    return { type: 'true' }
  }

  if (filtered.length === 1) {
    return filtered[0]!
  }

  return { type, clauses: filtered }
}

/**
 * Lower a single `{ field: value }` entry. `value` is either:
 *   - a scalar/RegExp: sugar for `{ $eq: value }`
 *   - an object keyed by comparison operators (`{ $gt: 5 }`)
 *   - a nested object (dotted-path access — `{ meta: { published: true } }`
 *     becomes `meta.published = true`)
 */
const lowerFieldCondition = (field: string, value: unknown): FilterExpr => {
  if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof RegExp)) {
    const objectValue = value as Record<string, unknown>
    if ('$options' in objectValue && !('$regex' in objectValue)) {
      throw new TypeError('Query operator $options requires $regex.')
    }
    const clauses: FilterExpr[] = []

    for (const [key, nestedValue] of Object.entries(objectValue)) {
      if (key === '$options') {
        continue
      }

      if (COMPARISON_OPERATORS.has(key)) {
        if (key === '$not') {
          clauses.push({
            type: 'not',
            clause: lowerFieldCondition(field, nestedValue)
          })
          continue
        }

        clauses.push({
          type: 'compare',
          field,
          // `key` is gated by the `COMPARISON_OPERATORS` set above; after
          // stripping the leading `$` it maps 1:1 to a `CompareOperator`.
          operator: key.slice(1) as CompareOperator,
          value: key === '$regex' && typeof objectValue.$options === 'string' && !(nestedValue instanceof RegExp)
            ? new RegExp(String(nestedValue), objectValue.$options)
            : nestedValue
        })
        continue
      }

      clauses.push(lowerFieldCondition(`${field}.${key}`, nestedValue))
    }

    return collapse('and', clauses)
  }

  return {
    type: 'compare',
    field,
    operator: 'eq',
    value
  }
}

const lowerWhereCondition = (condition: ContentQueryBuilderWhere): FilterExpr => {
  const clauses: FilterExpr[] = []

  for (const [key, value] of Object.entries(condition)) {
    if (key === '$and') {
      clauses.push(collapse('and', ensureQueryWhereArray(value as ContentQueryBuilderParams['where']).map(lowerWhereCondition)))
      continue
    }

    if (key === '$or') {
      clauses.push(collapse('or', ensureQueryWhereArray(value as ContentQueryBuilderParams['where']).map(lowerWhereCondition)))
      continue
    }

    if (key === '$not' && value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof RegExp)) {
      clauses.push({
        type: 'not',
        clause: lowerWhereCondition(value as ContentQueryBuilderWhere)
      })
      continue
    }

    clauses.push(lowerFieldCondition(key, value))
  }

  return collapse('and', clauses)
}

const lowerSort = (sort: ContentQuerySortOptions[] = []): SortClause[] => {
  return sort.flatMap((option) => {
    const meta = {
      locale: option.$locale,
      numeric: option.$numeric,
      caseFirst: option.$caseFirst,
      sensitivity: option.$sensitivity
    }

    return Object.entries(option)
      .filter(([key]) => !key.startsWith('$'))
      .map(([field, direction]) => ({
        field,
        direction: direction as -1 | 1,
        ...meta
      }))
  })
}

export const lowerQueryPlan = (params: ContentQueryBuilderParams): ContentQueryPlan => {
  assertSupportedQueryOperators(params.where)

  const resolveVariant = (params as ContentQueryBuilderParams & {
    resolveVariant?: { path?: string, route?: string, ref?: string, locale?: string, fallback?: string[] | boolean, exact?: boolean }
  }).resolveVariant

  return {
    collection: params.collection,
    filter: collapse('and', ensureQueryWhereArray(params.where).map(lowerWhereCondition)),
    sort: lowerSort(params.sort),
    projection: {
      only: params.only ? [...params.only] : [],
      without: params.without ? [...params.without] : []
    },
    skip: params.skip || 0,
    limit: params.limit,
    mode: params.count ? 'count' : params.first ? 'first' : 'all',
    resolveLocale: params.resolveLocale
      ? {
          locale: params.resolveLocale.locale,
          fallback: Array.isArray(params.resolveLocale.fallback) ? [...params.resolveLocale.fallback] : [],
          exact: params.resolveLocale.exact
        }
      : undefined,
    resolveVariant: resolveVariant
      ? {
          ...(resolveVariant.path ? { path: resolveVariant.path } : {}),
          ...(resolveVariant.route ? { route: resolveVariant.route } : {}),
          ...(resolveVariant.ref ? { ref: resolveVariant.ref } : {}),
          locale: resolveVariant.locale,
          fallback: Array.isArray(resolveVariant.fallback) ? [...resolveVariant.fallback] : [],
          exact: resolveVariant.exact
        }
      : undefined
  }
}
