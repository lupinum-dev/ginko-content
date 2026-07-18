/**
 * Query compiler for the unified query API (ADR-0016).
 *
 * `by` selects one document through the graph resolver. `where` filters a
 * result set. Keeping those paths separate is the public contract.
 *
 * Operator names are deliberately close to the internal
 * `ContentProviderQueryWhere` shape. Public `$prefix` is kept as `$prefix`
 * through the transport instead of being exposed as caller-provided regex.
 */
import type {
  ContentSelector,
  ContentProviderQueryInput,
  ContentProviderQueryWhere,
  ContentQuerySortFields,
  LocaleFallback,
  QueryWhere,
  SortSpec
} from '../../types/query'
import { findUnsupportedPublicQueryOperator, isValidQueryFieldPath } from './operators'
import { assertPublicQueryLimit, assertPublicQuerySkip } from './limits'
import { normalizeContentPath } from '../content/path'
import { collectJsonPurityViolations, formatJsonPurityViolations } from '../json-value'

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object'
  && value !== null
  && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)

const assertJsonPureFilter = (value: ContentProviderQueryWhere): void => {
  const violations = collectJsonPurityViolations(value, '$.where')
  if (violations.length) {
    throw new TypeError(`Invalid content query filter: ${formatJsonPurityViolations(violations)}`)
  }
}

/**
 * Translate a single field's operand into the internal `where`-condition shape.
 * The internal shape `{ field: <scalar> }` means equality; `{ field: { $op: ... } }`
 * means an operator. We pass through MongoDB-style operands directly.
 */
const compileFieldOperand = (
  operand: unknown,
  path: string,
  ancestors: WeakSet<object>
): ContentProviderQueryWhere[string] => {
  if (operand === undefined) {
    return undefined
  }

  // Scalars and arrays are equality values. The final JSON-purity assertion
  // rejects values that the HTTP transport would otherwise coerce or drop.
  if (!isPlainObject(operand)) {
    return operand as ContentProviderQueryWhere[string]
  }

  const keys = Object.keys(operand)
  const operatorKeys = keys.filter(key => key.startsWith('$'))
  if (operatorKeys.length) {
    if (operatorKeys.length !== keys.length) {
      throw new TypeError(`Invalid content query filter at ${path}: operator objects cannot mix operator and field keys.`)
    }
    if (operatorKeys.includes('$not')) {
      throw new TypeError(`Invalid content query filter at ${path}.$not: $not is a logical operator and must wrap a filter condition.`)
    }
    // Public operator object — the lowerer owns the one operator-to-plan mapping.
    return operand as ContentProviderQueryWhere[string]
  }

  // Nested filter on a sub-object (e.g. `{ nested: { level: { $eq: 2 } } }`)
  const compiled = compileWhereObject(operand, path, ancestors)
  if (!compiled) {
    throw new TypeError(`Invalid content query filter at ${path}: nested filter objects cannot be empty.`)
  }
  return compiled as ContentProviderQueryWhere[string]
}

const compileWhereObject = (
  where: unknown,
  path: string,
  ancestors: WeakSet<object>
): ContentProviderQueryWhere | undefined => {
  if (!isPlainObject(where)) {
    throw new TypeError(`Invalid content query filter at ${path}: expected a plain object.`)
  }
  if (ancestors.has(where)) {
    throw new TypeError(`Invalid content query filter at ${path}: circular references are not supported.`)
  }

  ancestors.add(where)
  const out: ContentProviderQueryWhere = {}

  try {
    for (const [key, value] of Object.entries(where)) {
      if (value === undefined) continue

      if (key === '$and' || key === '$or') {
        if (!Array.isArray(value)) {
          throw new TypeError(`Invalid content query filter at ${path}.${key}: expected an array of filter objects.`)
        }
        if (value.length === 0) {
          throw new TypeError(`Invalid content query filter at ${path}.${key}: logical groups cannot be empty.`)
        }
        const compiled = value.map((part, index) => {
          const condition = compileWhereObject(part, `${path}.${key}[${index}]`, ancestors)
          if (!condition) {
            throw new TypeError(`Invalid content query filter at ${path}.${key}[${index}]: logical group members cannot be empty.`)
          }
          return condition
        })
        out[key] = compiled
        continue
      }

      if (key === '$not') {
        const compiled = compileWhereObject(value, `${path}.$not`, ancestors)
        if (!compiled) {
          throw new TypeError(`Invalid content query filter at ${path}.$not: negated filters cannot be empty.`)
        }
        out.$not = compiled
        continue
      }

      if (!isValidQueryFieldPath(key)) {
        throw new TypeError(`Invalid query field path "${key}".`)
      }
      const operand = compileFieldOperand(value, `${path}.${key}`, ancestors)
      if (operand !== undefined) {
        ;(out as Record<string, unknown>)[key] = operand
      }
    }
  } finally {
    ancestors.delete(where)
  }

  return Object.keys(out).length ? out : undefined
}

/**
 * Compile a public `where` object to the internal `where` clause shape.
 */
export const compileWhere = (where: QueryWhere | undefined): ContentProviderQueryWhere | undefined => {
  if (where === undefined) return undefined
  const compiled = compileWhereObject(where, '$.where', new WeakSet())
  if (!compiled) return undefined

  const unsupported = findUnsupportedPublicQueryOperator(compiled)
  if (unsupported) {
    throw new TypeError(`Unsupported content query operator: ${unsupported}`)
  }
  assertJsonPureFilter(compiled)
  return compiled
}

/**
 * Convert `SortSpec` (e.g. `{ date: 'desc', title: 'asc' }`) into the array form the
 * transport expects.
 */
export const compileSort = (sort: SortSpec | undefined): ContentQuerySortFields[] | undefined => {
  if (sort === undefined) return undefined
  if (!isPlainObject(sort)) {
    throw new TypeError('Invalid content query sort: expected a plain object.')
  }
  const fields = Object.entries(sort)
    .flatMap(([field, value]) => {
      if (!isValidQueryFieldPath(field)) {
        throw new TypeError(`Invalid query field path "${field}".`)
      }
      if (value === undefined) return []
      const direction = value === 'asc' ? 1 : value === 'desc' ? -1 : undefined
      if (direction === undefined) {
        throw new TypeError(`Invalid content query sort direction for "${field}": expected "asc" or "desc".`)
      }
      return [[field, direction] as const]
    })
  if (!fields.length) return undefined
  return fields.map(([field, direction]) => ({ [field]: direction }))
}

/**
 * Normalize public fallback intent into the transport shape. Boolean `true`
 * means "use configured fallbacks"; an explicit array overrides the chain.
 */
export const compileFallback = (
  fallback: LocaleFallback | undefined
): boolean | string[] | undefined => {
  if (fallback === undefined) return undefined
  if (typeof fallback === 'boolean') return fallback
  if (fallback === 'default') return ['default']
  if (!Array.isArray(fallback) || fallback.some(locale => typeof locale !== 'string' || locale.length === 0)) {
    throw new TypeError('Invalid content query fallback: expected "default", an array of non-empty locale strings, or a boolean.')
  }
  return [...fallback]
}

const compileSelector = (selector: ContentSelector | undefined): ContentSelector | undefined => {
  if (selector === undefined) return undefined
  if (!isPlainObject(selector)) {
    throw new TypeError('Invalid content query selector: expected a plain object.')
  }

  const keys = Object.keys(selector)
  const selectorKeys = keys.filter(key => key === 'path' || key === 'route' || key === 'ref')
  if (keys.length !== 1 || selectorKeys.length !== 1) {
    throw new TypeError('Invalid content query selector: expected exactly one of path, route, or ref.')
  }

  const key = selectorKeys[0] as 'path' | 'route' | 'ref'
  const value = selector[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`Invalid content query selector: ${key} must be a non-empty string.`)
  }

  if (key === 'path') return { path: normalizeContentPath(value) }
  if (key === 'route') return { route: normalizeContentPath(value) }
  return { ref: value }
}

const compileSelection = (selection: ReadonlyArray<string> | undefined): string[] | undefined => {
  if (selection === undefined) return undefined
  if (!Array.isArray(selection)) {
    throw new TypeError('Invalid content query selection: expected an array of field paths.')
  }
  for (const field of selection) {
    if (typeof field !== 'string' || !isValidQueryFieldPath(field)) {
      throw new TypeError(`Invalid content query selection field "${String(field)}".`)
    }
  }
  return [...selection]
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
  select?: ReadonlyArray<string>
  locale?: string
  fallback?: LocaleFallback
  exact?: boolean
}): ContentProviderQueryInput => {
  if (typeof input.collection !== 'string' || input.collection.length === 0) {
    throw new TypeError('Invalid content query collection: expected a non-empty string.')
  }
  if (input.limit !== undefined) assertPublicQueryLimit(input.limit)
  if (input.skip !== undefined) assertPublicQuerySkip(input.skip)
  if (input.locale !== undefined && (typeof input.locale !== 'string' || input.locale.length === 0)) {
    throw new TypeError('Invalid content query locale: expected a non-empty string.')
  }
  if (input.exact !== undefined && typeof input.exact !== 'boolean') {
    throw new TypeError('Invalid content query exact option: expected a boolean.')
  }

  const selector = compileSelector(input.by)
  const path = selector && 'path' in selector ? selector.path : undefined
  const route = selector && 'route' in selector ? selector.route : undefined
  const ref = selector && 'ref' in selector ? selector.ref : undefined
  const where = compileWhere(input.where)
  const sort = compileSort(input.sort)
  const fallback = compileFallback(input.fallback)
  const select = compileSelection(input.select)

  const params: ContentProviderQueryInput = {
    collection: input.collection,
    ...(where ? { where: [where] } : {}),
    ...(sort ? { sort } : {}),
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
    ...(input.skip !== undefined ? { skip: input.skip } : {}),
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
  // For plain non-i18n queries we treat `path` as a `path` field equality so
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
    // Plain path lookup — push `path` equality into where so the standard
    // executor handles it without any variant logic.
    const pathClause: ContentProviderQueryWhere = { path: path }
    const existing = Array.isArray(params.where) ? params.where : params.where ? [params.where] : []
    params.where = [...existing, pathClause]
  }

  return params
}
