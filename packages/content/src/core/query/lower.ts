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
import type { CompareOperator, ContentQueryPlan, FilterExpr, PlanRegex, SortClause } from './plan'
import { assertSupportedQueryOperators, SUPPORTED_QUERY_OPERATORS } from './operators'

/**
 * Convert comparison operands into the JSON-pure wire shape. RegExp values are
 * tagged so user data shaped like `{ source, flags }` stays ordinary data; Date
 * values become ISO strings so providers see the same operand after a JSON
 * round trip. Arrays and plain objects are walked because `$in` and object
 * equality can carry nested operands.
 */
const serializeQueryValue = (value: unknown): unknown => {
  if (value instanceof RegExp) {
    assertSupportedRegexFlags(value.flags)
    return { __ginkoContentQueryValue: 'RegExp', source: value.source, flags: value.flags } satisfies PlanRegex
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (Array.isArray(value)) {
    return value.map(serializeQueryValue)
  }

  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([key, child]) => [key, serializeQueryValue(child)]))
  }

  return value
}

const SUPPORTED_REGEX_FLAGS = /^[imsu]*$/

const assertSupportedRegexFlags = (flags: string): void => {
  if (!SUPPORTED_REGEX_FLAGS.test(flags)) {
    throw new TypeError(`Unsupported RegExp flags "${flags}". Content queries support only i, m, s, and u.`)
  }
  try {
    new RegExp('', flags)
  }
  catch {
    throw new TypeError(`Invalid RegExp flags "${flags}".`)
  }
}

// A `$regex` operand supplied as a slash-delimited string (`/foo/i`) carries its
// flags in the trailing group, and those flags are only interpreted downstream
// (execute/json revive them). Validate them here so the string form honors the
// same [imsu] whitelist as RegExp literals instead of silently accepting g/y/d.
// The pattern mirrors the downstream parse so we gate exactly the flags that
// would otherwise take effect.
const STRING_REGEX_WITH_FLAGS = /\/(.*)\/([dgimsuy]+)$/

const assertSupportedRegexStringFlags = (value: string): void => {
  const matched = value.match(STRING_REGEX_WITH_FLAGS)
  if (matched) {
    assertSupportedRegexFlags(matched[2]!)
  }
}

const ensureQueryWhereArray = (where?: ContentQueryBuilderParams['where']) => {
  return Array.isArray(where) ? [...where] : where ? [where] : []
}

/**
 * Envelope fields removed by the Phase-3 cutover, mapped to their replacement.
 * A `where`/`sort`/`select` still naming an old underscore field silently
 * matches nothing (the field no longer exists), so in dev we point the author
 * at the new name instead of leaving them to debug a mysterious empty result.
 */
const REMOVED_ENVELOPE_FIELDS: Record<string, string> = {
  _id: 'id',
  _path: 'path',
  _locale: 'locale',
  _collection: 'collection',
  _canonicalKey: 'canonicalKey',
  _type: 'type',
  _extension: 'file.extension',
  _navigation: 'navigationFile',
  _partial: 'partial',
  _draft: 'draft'
}

const collectWhereFields = (condition: ContentQueryBuilderWhere, out: Set<string>): void => {
  for (const [key, value] of Object.entries(condition)) {
    if ((key === '$and' || key === '$or') && value) {
      for (const clause of ensureQueryWhereArray(value as ContentQueryBuilderParams['where'])) collectWhereFields(clause, out)
    }
    else if (key === '$not' && value && typeof value === 'object' && !Array.isArray(value)) {
      collectWhereFields(value as ContentQueryBuilderWhere, out)
    }
    else if (!key.startsWith('$')) {
      out.add(key)
    }
  }
}

const warnOnRemovedEnvelopeFields = (params: ContentQueryBuilderParams): void => {
  if (!import.meta.dev) return
  const fields = new Set<string>()
  for (const condition of ensureQueryWhereArray(params.where)) collectWhereFields(condition, fields)
  for (const option of params.sort || []) for (const key of Object.keys(option)) if (!key.startsWith('$')) fields.add(key)
  for (const field of [...(params.only || []), ...(params.without || [])]) fields.add(field)
  for (const field of fields) {
    const replacement = REMOVED_ENVELOPE_FIELDS[field.split('.')[0]!]
    if (replacement) console.warn(`[ginko-content] Query references removed envelope field "${field.split('.')[0]}" — use "${replacement}" instead; the old field no longer exists, so this clause has no effect.`)
  }
}

const COMPARISON_OPERATORS = new Set<string>(SUPPORTED_QUERY_OPERATORS)

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
  if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof RegExp) && !(value instanceof Date)) {
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

        // Without explicit `$options`, a string `$regex` passes through to the
        // executor which parses trailing `/…/flags`; enforce the flag whitelist
        // here so the string form matches the RegExp-literal restriction.
        if (key === '$regex' && typeof nestedValue === 'string' && typeof objectValue.$options !== 'string') {
          assertSupportedRegexStringFlags(nestedValue)
        }

        clauses.push({
          type: 'compare',
          field,
          // `key` is gated by the `COMPARISON_OPERATORS` set above; after
          // stripping the leading `$` it maps 1:1 to a `CompareOperator`.
          operator: key.slice(1) as CompareOperator,
          value: key === '$regex' && typeof objectValue.$options === 'string' && !(nestedValue instanceof RegExp)
            ? serializeQueryValue(regexValue(String(nestedValue), objectValue.$options))
            : serializeQueryValue(nestedValue)
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
    value: serializeQueryValue(value)
  }
}

const regexValue = (source: string, flags: string): PlanRegex => {
  assertSupportedRegexFlags(flags)
  return { __ginkoContentQueryValue: 'RegExp', source, flags }
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
    const sortParams = option as {
      $locale?: string
      $numeric?: boolean
      $caseFirst?: 'upper' | 'lower' | 'false'
      $sensitivity?: 'base' | 'accent' | 'case' | 'variant'
    }
    const meta = {
      locale: sortParams.$locale,
      numeric: sortParams.$numeric,
      caseFirst: sortParams.$caseFirst,
      sensitivity: sortParams.$sensitivity
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
  warnOnRemovedEnvelopeFields(params)

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
