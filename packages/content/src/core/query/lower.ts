/**
 * Lower `ContentProviderQueryInput` (the low-level compiler input)
 * into a `ContentQueryPlan` (the executor's AST — see `./plan.ts`).
 *
 * Lowering is the single place we translate user-level shapes (`$eq`,
 * `$and`, sibling-key-as-`$and`) into the normalized tree the executor
 * expects. Downstream code only touches the plan.
 *
 * The translation is purely syntactic — no graph access, no I/O. It runs
 * once per unified query operation.
 */
import type { ContentProviderQueryInput, ContentProviderQueryWhere, ContentQuerySortOptions } from '../../types/query'
import {
  CONTENT_QUERY_CURSOR_PAGING_KEYS,
  CONTENT_QUERY_INPUT_KEYS,
  CONTENT_QUERY_OFFSET_PAGING_KEYS,
  CONTENT_QUERY_RESOLUTION_KEYS,
  CONTENT_QUERY_VARIANT_SELECTOR_KEYS
} from '../../types/query'
import type { CompareOperator, ContentQueryPlan, FilterExpr, PlanRegex, SortClause } from './plan'
import { assertSupportedQueryOperators, isValidQueryCollationLocale, isValidQueryFieldPath, PROVIDER_QUERY_OPERATORS } from './operators'
import { assertPublicPagingLimit, assertPublicQueryLimit, assertPublicQuerySkip, DEFAULT_PUBLIC_QUERY_LIMIT, MAX_PUBLIC_QUERY_CURSOR_BYTES } from './limits'
import { collectJsonPurityViolations, formatJsonPurityViolations } from '../json-value'

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object'
  && value !== null
  && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)

const SORT_PARAMETER_KEYS = new Set(['$locale', '$numeric', '$caseFirst', '$sensitivity'])
const CASE_FIRST_VALUES = new Set(['upper', 'lower', 'false'])
const SENSITIVITY_VALUES = new Set(['base', 'accent', 'case', 'variant'])

const assertNoUnknownKeys = (value: Record<string, unknown>, allowed: readonly string[], path: string): void => {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new TypeError(`Unknown content query key at ${path}.${key}.`)
    }
  }
}

/**
 * Convert comparison operands into the JSON-pure wire shape. RegExp values are
 * tagged so user data shaped like `{ source, flags }` stays ordinary data; Date
 * values become ISO strings so providers see the same operand after a JSON
 * round trip. Arrays and plain objects are walked because `$in` and object
 * equality can carry nested operands.
 */
const normalizeQueryValue = (value: unknown, path: string, ancestors: WeakSet<object>): unknown => {
  if (value instanceof RegExp) {
    assertSupportedRegexFlags(value.flags)
    return { __ginkoContentQueryValue: 'RegExp', source: value.source, flags: value.flags } satisfies PlanRegex
  }

  if (value instanceof Date) {
    try {
      return value.toISOString()
    }
    catch {
      throw new TypeError(`Invalid content query value at ${path}: Date must be valid.`)
    }
  }

  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      throw new TypeError(`Invalid content query value at ${path}: circular references are not JSON-pure.`)
    }
    ancestors.add(value)
    try {
      return value.map((child, index) => normalizeQueryValue(child, `${path}[${index}]`, ancestors))
    }
    finally {
      ancestors.delete(value)
    }
  }

  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value)
    if (prototype === Object.prototype || prototype === null) {
      if (ancestors.has(value)) {
        throw new TypeError(`Invalid content query value at ${path}: circular references are not JSON-pure.`)
      }
      const enumerableSymbol = Object.getOwnPropertySymbols(value)
        .find(symbol => Object.prototype.propertyIsEnumerable.call(value, symbol))
      if (enumerableSymbol) {
        throw new TypeError(`Invalid content query value at ${path}: symbol-keyed properties are not JSON-pure.`)
      }
      ancestors.add(value)
      try {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>)
          .map(([key, child]) => [key, normalizeQueryValue(child, `${path}.${key}`, ancestors)]))
      }
      finally {
        ancestors.delete(value)
      }
    }
  }

  return value
}

const serializeQueryValue = (value: unknown): unknown => {
  const normalized = normalizeQueryValue(value, '$.where', new WeakSet())
  const violations = collectJsonPurityViolations(normalized, '$.where')
  if (violations.length) {
    throw new TypeError(`Invalid content query value: ${formatJsonPurityViolations(violations)}`)
  }
  return normalized
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

const ensureQueryWhereArray = (where?: ContentProviderQueryInput['where']) => {
  return Array.isArray(where) ? [...where] : where ? [where] : []
}

const COMPARISON_OPERATORS = new Set<string>(PROVIDER_QUERY_OPERATORS)

const assertValidFieldPath: (field: unknown) => asserts field is string = (field) => {
  if (!isValidQueryFieldPath(field)) {
    throw new TypeError(`Invalid query field path "${String(field)}". Field paths must use non-empty segments and must not contain __proto__, prototype, or constructor.`)
  }
}

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
  assertValidFieldPath(field)

  if (isPlainObject(value)) {
    const objectValue = value
    const keys = Object.keys(objectValue)
    if (keys.length === 0) {
      throw new TypeError(`Invalid content query filter at ${field}: nested filter objects cannot be empty.`)
    }
    const operatorKeys = keys.filter(key => key.startsWith('$'))
    if (operatorKeys.length > 0 && operatorKeys.length !== keys.length) {
      throw new TypeError(`Invalid content query filter at ${field}: operator objects cannot mix operator and nested-field keys.`)
    }
    if (operatorKeys.includes('$not')) {
      throw new TypeError(`Invalid content query filter at ${field}.$not: $not is a logical operator and must wrap a filter condition.`)
    }
    if ('$options' in objectValue && !('$regex' in objectValue)) {
      throw new TypeError('Query operator $options requires $regex.')
    }
    const clauses: FilterExpr[] = []

    for (const [key, nestedValue] of Object.entries(objectValue)) {
      if (key === '$options') {
        continue
      }

      if (COMPARISON_OPERATORS.has(key)) {
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

const lowerWhereCondition = (condition: ContentProviderQueryWhere): FilterExpr => {
  if (!isPlainObject(condition)) {
    throw new TypeError('Content query filter conditions must be plain objects.')
  }
  if (Object.keys(condition).length === 0) {
    throw new TypeError('Content query filter conditions cannot be empty.')
  }
  const clauses: FilterExpr[] = []

  for (const [key, value] of Object.entries(condition)) {
    if (key === '$and') {
      if (!Array.isArray(value) || value.length === 0) {
        throw new TypeError('Content query logical group $and must be a non-empty array.')
      }
      clauses.push(collapse('and', value.map(member => lowerWhereCondition(member as ContentProviderQueryWhere))))
      continue
    }

    if (key === '$or') {
      if (!Array.isArray(value) || value.length === 0) {
        throw new TypeError('Content query logical group $or must be a non-empty array.')
      }
      clauses.push(collapse('or', value.map(member => lowerWhereCondition(member as ContentProviderQueryWhere))))
      continue
    }

    if (key === '$not') {
      if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof RegExp || value instanceof Date) {
        throw new TypeError('Top-level query operator $not must contain a filter condition object.')
      }
      clauses.push({ type: 'not', clause: lowerWhereCondition(value as ContentProviderQueryWhere) })
      continue
    }

    clauses.push(lowerFieldCondition(key, value))
  }

  return collapse('and', clauses)
}

const lowerSort = (sort: ContentQuerySortOptions[] = []): SortClause[] => {
  if (!Array.isArray(sort)) {
    throw new TypeError('Content query sort must be an array.')
  }
  return sort.flatMap((option) => {
    if (!isPlainObject(option)) {
      throw new TypeError('Each content query sort entry must be a plain object.')
    }
    for (const key of Object.keys(option)) {
      if (key.startsWith('$') && !SORT_PARAMETER_KEYS.has(key)) {
        throw new TypeError(`Unknown content query sort parameter: ${key}`)
      }
    }
    const sortParams = option
    if (sortParams.$locale !== undefined && !isValidQueryCollationLocale(sortParams.$locale)) {
      throw new TypeError(`Invalid content query sort locale: ${String(sortParams.$locale)}`)
    }
    if (sortParams.$numeric !== undefined && typeof sortParams.$numeric !== 'boolean') {
      throw new TypeError('Invalid content query sort $numeric: expected a boolean.')
    }
    if (sortParams.$caseFirst !== undefined && (typeof sortParams.$caseFirst !== 'string' || !CASE_FIRST_VALUES.has(sortParams.$caseFirst))) {
      throw new TypeError('Invalid content query sort $caseFirst: expected upper, lower, or false.')
    }
    if (sortParams.$sensitivity !== undefined && (typeof sortParams.$sensitivity !== 'string' || !SENSITIVITY_VALUES.has(sortParams.$sensitivity))) {
      throw new TypeError('Invalid content query sort $sensitivity: expected base, accent, case, or variant.')
    }
    const fields = Object.entries(option).filter(([key]) => !key.startsWith('$'))
    if (fields.length === 0) {
      throw new TypeError('Content query sort entries must name at least one field.')
    }
    const meta = {
      ...(typeof sortParams.$locale === 'string' ? { locale: sortParams.$locale } : {}),
      ...(typeof sortParams.$numeric === 'boolean' ? { numeric: sortParams.$numeric } : {}),
      ...(typeof sortParams.$caseFirst === 'string' ? { caseFirst: sortParams.$caseFirst as SortClause['caseFirst'] } : {}),
      ...(typeof sortParams.$sensitivity === 'string' ? { sensitivity: sortParams.$sensitivity as SortClause['sensitivity'] } : {})
    }

    return fields
      .map(([field, direction]) => {
        assertValidFieldPath(field)
        if (direction !== 1 && direction !== -1) {
          throw new TypeError(`Invalid content query sort direction for "${field}": expected 1 or -1.`)
        }
        return {
          field,
          direction,
          ...meta
        }
      })
  })
}

const assertLocaleResolution = (value: unknown, field: 'resolveLocale' | 'resolveVariant'): void => {
  if (value === undefined) return
  if (!isPlainObject(value)) {
    throw new TypeError(`Content query ${field} must be a plain object.`)
  }
  assertNoUnknownKeys(
    value,
    field === 'resolveVariant'
      ? [...CONTENT_QUERY_VARIANT_SELECTOR_KEYS, ...CONTENT_QUERY_RESOLUTION_KEYS]
      : CONTENT_QUERY_RESOLUTION_KEYS,
    field
  )
  if (value.locale !== undefined && (typeof value.locale !== 'string' || value.locale.length === 0)) {
    throw new TypeError(`Content query ${field}.locale must be a non-empty string.`)
  }
  if (value.fallback !== undefined && typeof value.fallback !== 'boolean' && !Array.isArray(value.fallback)) {
    throw new TypeError(`Content query ${field}.fallback must be a boolean or an array of locale strings.`)
  }
  if (Array.isArray(value.fallback) && value.fallback.some(locale => typeof locale !== 'string' || locale.length === 0)) {
    throw new TypeError(`Content query ${field}.fallback must contain only non-empty locale strings.`)
  }
  if (value.exact !== undefined && typeof value.exact !== 'boolean') {
    throw new TypeError(`Content query ${field}.exact must be a boolean.`)
  }
  if (field === 'resolveVariant') {
    const selectors = ['path', 'route', 'ref'].filter(selector => value[selector] !== undefined)
    if (selectors.length !== 1) {
      throw new TypeError('Content query resolveVariant must name exactly one of path, route, or ref.')
    }
    const selector = selectors[0]!
    if (typeof value[selector] !== 'string' || value[selector].length === 0) {
      throw new TypeError(`Content query resolveVariant.${selector} must be a non-empty string.`)
    }
  }
}

const assertQueryParamsShape = (params: ContentProviderQueryInput): void => {
  if (!isPlainObject(params)) {
    throw new TypeError('Content query params must be a plain object.')
  }
  assertNoUnknownKeys(params, CONTENT_QUERY_INPUT_KEYS, '$')
  if (params.collection !== undefined && (typeof params.collection !== 'string' || params.collection.length === 0)) {
    throw new TypeError('Content query collection must be a non-empty string.')
  }
  if (params.first !== undefined && typeof params.first !== 'boolean') {
    throw new TypeError('Content query first terminal must be a boolean.')
  }
  if (params.count !== undefined && typeof params.count !== 'boolean') {
    throw new TypeError('Content query count terminal must be a boolean.')
  }
  if (params.first === true && params.count === true) {
    throw new TypeError('Content query cannot request both first and count terminals.')
  }
  if ((params.first === true || params.count === true) && params.paging !== undefined) {
    throw new TypeError('Content query paging is only valid for list terminals.')
  }
  if (params.paging !== undefined && (params.skip !== undefined || params.limit !== undefined)) {
    throw new TypeError('Content query paging must not duplicate top-level skip or limit values.')
  }
  if (params.where !== undefined) {
    const conditions = Array.isArray(params.where) ? params.where : [params.where]
    if (conditions.length === 0) {
      throw new TypeError('Content query filter conditions cannot be empty.')
    }
    if (conditions.some(condition => !isPlainObject(condition))) {
      throw new TypeError('Content query filter conditions must be plain objects.')
    }
  }
  for (const [field, selection] of [['only', params.only], ['without', params.without]] as const) {
    if (selection === undefined) continue
    if (!Array.isArray(selection) || selection.some(entry => typeof entry !== 'string')) {
      throw new TypeError(`Content query ${field} must be an array of field paths.`)
    }
  }
  if (params.paging !== undefined) {
    if (!isPlainObject(params.paging) || (params.paging.mode !== 'offset' && params.paging.mode !== 'cursor')) {
      throw new TypeError('Content query paging mode must be offset or cursor.')
    }
    assertNoUnknownKeys(
      params.paging,
      params.paging.mode === 'offset' ? CONTENT_QUERY_OFFSET_PAGING_KEYS : CONTENT_QUERY_CURSOR_PAGING_KEYS,
      'paging'
    )
    assertPublicPagingLimit(params.paging.limit)
    if (params.paging.mode === 'offset') {
      assertPublicQuerySkip(params.paging.skip)
    }
    else if (params.paging.after !== undefined && params.paging.after !== null && typeof params.paging.after !== 'string') {
      throw new TypeError('Content query cursor must be a string or null.')
    }
    else if (typeof params.paging.after === 'string' && new TextEncoder().encode(params.paging.after).length > MAX_PUBLIC_QUERY_CURSOR_BYTES) {
      throw new TypeError(`Content query cursor exceeds the maximum of ${MAX_PUBLIC_QUERY_CURSOR_BYTES} bytes.`)
    }
  }
  assertLocaleResolution(params.resolveLocale, 'resolveLocale')
  assertLocaleResolution(params.resolveVariant, 'resolveVariant')
}

export const lowerQueryPlan = (params: ContentProviderQueryInput): ContentQueryPlan => {
  assertQueryParamsShape(params)
  // Validate the complete tree before interpreting plain objects as nested
  // field conditions. Otherwise a Map, Set, or class instance with no
  // enumerable keys could silently collapse to a match-all filter.
  if (params.where !== undefined) serializeQueryValue(params.where)
  assertSupportedQueryOperators(params.where)

  for (const field of [...(params.only || []), ...(params.without || [])]) {
    assertValidFieldPath(field)
  }
  if (params.limit !== undefined) assertPublicQueryLimit(params.limit)
  if (params.skip !== undefined) assertPublicQuerySkip(params.skip)

  const paging = params.paging
  if (paging) {
    assertPublicPagingLimit(paging.limit)
    if (paging.mode === 'offset') assertPublicQuerySkip(paging.skip)
  }
  const resolveVariant = params.resolveVariant
  const resolveLocaleExact = params.resolveLocale?.exact === true || params.resolveLocale?.fallback === false
    ? true
    : params.resolveLocale?.exact
  const resolveVariantExact = resolveVariant?.exact === true || resolveVariant?.fallback === false
    ? true
    : resolveVariant?.exact
  const limit = params.count
    ? undefined
    : params.first
      ? 1
      : params.limit ?? paging?.limit ?? DEFAULT_PUBLIC_QUERY_LIMIT
  const normalizedPaging = paging?.mode === 'cursor'
    ? {
        mode: 'cursor' as const,
        ...(paging.after !== undefined ? { after: paging.after } : {}),
        limit: paging.limit
      }
    : paging

  return {
    ...(params.collection !== undefined ? { collection: params.collection } : {}),
    filter: collapse('and', ensureQueryWhereArray(params.where).map(lowerWhereCondition)),
    sort: lowerSort(params.sort),
    projection: {
      only: params.only ? [...params.only] : [],
      without: params.without ? [...params.without] : []
    },
    skip: params.skip ?? 0,
    ...(limit !== undefined ? { limit } : {}),
    mode: params.count ? 'count' : params.first ? 'first' : 'all',
    ...(normalizedPaging ? { paging: normalizedPaging } : {}),
    ...(params.resolveLocale
      ? { resolveLocale: {
          ...(params.resolveLocale.locale !== undefined ? { locale: params.resolveLocale.locale } : {}),
          ...(!resolveLocaleExact && Array.isArray(params.resolveLocale.fallback) ? { fallback: [...params.resolveLocale.fallback] } : {}),
          ...(resolveLocaleExact !== undefined ? { exact: resolveLocaleExact } : {})
        } }
      : {}),
    ...(resolveVariant
      ? { resolveVariant: {
          ...(resolveVariant.path ? { path: resolveVariant.path } : {}),
          ...(resolveVariant.route ? { route: resolveVariant.route } : {}),
          ...(resolveVariant.ref ? { ref: resolveVariant.ref } : {}),
          ...(resolveVariant.locale !== undefined ? { locale: resolveVariant.locale } : {}),
          ...(!resolveVariantExact && Array.isArray(resolveVariant.fallback) ? { fallback: [...resolveVariant.fallback] } : {}),
          ...(resolveVariantExact !== undefined ? { exact: resolveVariantExact } : {})
        } }
      : {})
  }
}
