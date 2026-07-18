/**
 * Closed HTTP validation for the content query wire.
 *
 * The HTTP transport is internal to the client query API but is still an
 * untrusted runtime boundary — parsing JSON is not validation. This module is
 * a PURE validator: it never touches H3, the provider, or the query lowerer.
 * It rejects unknown keys at every closed object level, bounds every
 * resource-safety limit, and validates operator/pagination/selector shape —
 * all BEFORE lowering or provider dispatch ever run (see
 * `runtime/server/api/query.ts` for the thin H3 adapter).
 *
 * The source of truth for accepted operators is `PUBLIC_QUERY_OPERATORS`
 * plus the logical `$and`/`$or` connectives — the exact same list the
 * filesystem provider advertises and the operator-parity test asserts
 *, so `$nin` (and any future operator) cannot drift between
 * the public type, the filesystem executor, and this boundary.
 */
import {
  CONTENT_QUERY_CURSOR_PAGING_KEYS,
  CONTENT_QUERY_INPUT_KEYS,
  CONTENT_QUERY_OFFSET_PAGING_KEYS,
  CONTENT_QUERY_RESOLUTION_KEYS,
  CONTENT_QUERY_TYPE_VALUES,
  CONTENT_QUERY_VARIANT_SELECTOR_KEYS,
  type ContentProviderQueryInput
} from '../../types/query'
import { isValidQueryCollationLocale, isValidQueryFieldPath, LOGICAL_QUERY_OPERATORS, PUBLIC_QUERY_OPERATORS } from '../../core/query/operators'
import { MAX_PUBLIC_QUERY_CURSOR_BYTES, MAX_PUBLIC_QUERY_LIMIT, MAX_PUBLIC_QUERY_SKIP } from '../../core/query/limits'

/** Transport safety limits — NOT provider capabilities. */
export const MAX_QUERY_REQUEST_BYTES = 32_768
export const MAX_FILTER_DEPTH = 8
export const MAX_LOGICAL_GROUP_MEMBERS = 32
export const MAX_SELECTION_ENTRIES = 64
export const MAX_SORT_ENTRIES = 16
export const MAX_STRING_OPERAND_LENGTH = 1_000
export const MAX_ARRAY_OPERAND_LENGTH = 200
export const MAX_FIELD_PATH_LENGTH = 200
export const MAX_COLLECTION_NAME_LENGTH = 200
export const MAX_LOCALE_NAME_LENGTH = 200

const KNOWN_OPERATOR_KEYS = new Set<string>([
  ...PUBLIC_QUERY_OPERATORS,
  ...LOGICAL_QUERY_OPERATORS
])
const QUERY_TYPE_VALUES = new Set<string>(CONTENT_QUERY_TYPE_VALUES)
const ARRAY_OPERATORS = new Set(['$in', '$nin', '$containsAny'])
const STRING_OPERATORS = new Set(['$icontains', '$prefix'])

const SORT_PARAM_KEYS = new Set(['$locale', '$numeric', '$caseFirst', '$sensitivity'])
const CASE_FIRST_VALUES = new Set(['upper', 'lower', 'false'])
const SENSITIVITY_VALUES = new Set(['base', 'accent', 'case', 'variant'])

export interface QueryValidationFailure {
  /** Dotted path to the offending field, e.g. `where[0].title.$regex`. */
  path: string
  reason: string
}

export type QueryValidationResult =
  | { ok: true, value: ContentProviderQueryInput }
  | { ok: false, error: QueryValidationFailure }

const fail = (path: string, reason: string): QueryValidationResult => ({ ok: false, error: { path, reason } })

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value)
  && typeof value === 'object'
  && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)

const isFiniteInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)

const byteLength = (value: string): number => {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).length
  }
  return Buffer.byteLength(value)
}

class ValidationError extends Error {
  path: string
  reason: string
  constructor(path: string, reason: string) {
    super(`${path}: ${reason}`)
    this.path = path
    this.reason = reason
  }
}

const bad = (path: string, reason: string): never => {
  throw new ValidationError(path, reason)
}

const validateFieldPath = (field: string, path: string): void => {
  if (!isValidQueryFieldPath(field)) {
    return bad(path, 'Field paths must use non-empty segments and must not contain __proto__, prototype, or constructor.')
  }
  if (field.length > MAX_FIELD_PATH_LENGTH) {
    return bad(path, `Field path exceeds ${MAX_FIELD_PATH_LENGTH} characters.`)
  }
}

const assertNoUnknownKeys = (value: Record<string, unknown>, allowed: ReadonlySet<string>, path: string) => {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      return bad(`${path}.${key}`, `Unknown field "${key}".`)
    }
  }
}

const validateOperand = (value: unknown, path: string, depth: number): void => {
  if (value === null || value === undefined) return
  if (typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      return bad(path, 'Numeric operand must be finite.')
    }
    return
  }
  if (typeof value === 'string') {
    if (value.length > MAX_STRING_OPERAND_LENGTH) {
      return bad(path, `String operand exceeds ${MAX_STRING_OPERAND_LENGTH} characters.`)
    }
    return
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_OPERAND_LENGTH) {
      return bad(path, `Array operand exceeds ${MAX_ARRAY_OPERAND_LENGTH} entries.`)
    }
    for (const [index, entry] of value.entries()) {
      validateOperand(entry, `${path}[${index}]`, depth)
    }
    return
  }
  if (isPlainObject(value)) {
    validateFieldValue(value, path, depth + 1)
    return
  }
  return bad(path, 'Unsupported operand type.')
}

/**
 * Validate a field's value: either a scalar/array (equality operand) or an
 * object. An object's `$`-prefixed keys must be known operators; non-`$` keys
 * are a legitimate nested field path (`{ meta: { published: true } }` →
 * `meta.published`) per `lowerFieldCondition`'s grammar, so they recurse
 * rather than being rejected outright — but depth stays bounded either way.
 */
const validateFieldValue = (value: Record<string, unknown>, path: string, depth: number): void => {
  if (depth > MAX_FILTER_DEPTH) {
    return bad(path, `Filter nesting exceeds maximum depth of ${MAX_FILTER_DEPTH}.`)
  }

  const keys = Object.keys(value)
  if (keys.length === 0) {
    return bad(path, 'Filter objects cannot be empty.')
  }
  const operatorKeys = keys.filter(key => key.startsWith('$'))
  if (operatorKeys.length > 0 && operatorKeys.length !== keys.length) {
    return bad(path, 'Operator objects cannot mix operator and nested-field keys.')
  }

  for (const [key, entry] of Object.entries(value)) {
    if (key.startsWith('$')) {
      if (!KNOWN_OPERATOR_KEYS.has(key) || key === '$and' || key === '$or' || key === '$not') {
        return bad(`${path}.${key}`, `Unknown query operator "${key}".`)
      }

      if (key === '$exists') {
        if (typeof entry !== 'boolean') {
          return bad(`${path}.$exists`, '$exists must be a boolean.')
        }
        continue
      }

      if (key === '$type') {
        if (typeof entry !== 'string' || !QUERY_TYPE_VALUES.has(entry)) {
          return bad(`${path}.$type`, `$type must be one of ${CONTENT_QUERY_TYPE_VALUES.join(', ')}.`)
        }
        continue
      }

      if (ARRAY_OPERATORS.has(key)) {
        if (!Array.isArray(entry)) {
          return bad(`${path}.${key}`, `${key} must be an array.`)
        }
        validateOperand(entry, `${path}.${key}`, depth)
        continue
      }

      if (STRING_OPERATORS.has(key)) {
        if (typeof entry !== 'string') {
          return bad(`${path}.${key}`, `${key} must be a string.`)
        }
        validateOperand(entry, `${path}.${key}`, depth)
        continue
      }

      validateOperand(entry, `${path}.${key}`, depth)
      continue
    }

    // Non-`$` key: nested field path — recurse, still bounded by depth.
    validateFieldPath(key, `${path}.${key}`)
    validateOperand(entry, `${path}.${key}`, depth + 1)
  }
}

const validateWhereCondition = (condition: unknown, path: string, depth: number): void => {
  if (depth > MAX_FILTER_DEPTH) {
    return bad(path, `Filter nesting exceeds maximum depth of ${MAX_FILTER_DEPTH}.`)
  }
  if (!isPlainObject(condition)) {
    return bad(path, 'Filter condition must be an object.')
  }
  if (Object.keys(condition).length === 0) {
    return bad(path, 'Filter conditions cannot be empty.')
  }

  for (const [key, value] of Object.entries(condition)) {
    if (key === '$and' || key === '$or') {
      if (!Array.isArray(value)) {
        return bad(`${path}.${key}`, `${key} must be an array.`)
      }
      if (value.length === 0) {
        return bad(`${path}.${key}`, `${key} cannot be empty.`)
      }
      if (value.length > MAX_LOGICAL_GROUP_MEMBERS) {
        return bad(`${path}.${key}`, `${key} exceeds ${MAX_LOGICAL_GROUP_MEMBERS} members.`)
      }
      value.forEach((member, index) => validateWhereCondition(member, `${path}.${key}[${index}]`, depth + 1))
      continue
    }

    if (key === '$not') {
      if (!isPlainObject(value)) {
        return bad(`${path}.$not`, '$not must contain a filter condition object.')
      }
      if (Object.keys(value).length === 0) {
        return bad(`${path}.$not`, '$not cannot contain an empty filter condition.')
      }
      validateWhereCondition(value, `${path}.$not`, depth + 1)
      continue
    }

    if (key.startsWith('$')) {
      return bad(`${path}.${key}`, `Unknown top-level query key "${key}".`)
    }

    validateFieldPath(key, `${path}.${key}`)
    validateOperand(value, `${path}.${key}`, depth + 1)
  }
}

const validateWhere = (where: unknown, path: string): void => {
  if (where === undefined) return
  if (Array.isArray(where) && where.length === 0) {
    return bad(path, 'Filter conditions cannot be empty.')
  }
  const conditions = Array.isArray(where) ? where : [where]
  conditions.forEach((condition, index) => validateWhereCondition(condition, `${path}[${index}]`, 1))
}

const validateSort = (sort: unknown, path: string): void => {
  if (sort === undefined) return
  if (!Array.isArray(sort)) {
    return bad(path, 'sort must be an array.')
  }
  if (sort.length > MAX_SORT_ENTRIES) {
    return bad(path, `sort exceeds ${MAX_SORT_ENTRIES} entries.`)
  }
  sort.forEach((entry, index) => {
    if (!isPlainObject(entry)) {
      return bad(`${path}[${index}]`, 'Each sort entry must be an object.')
    }
    for (const [key, value] of Object.entries(entry)) {
      if (key.startsWith('$')) {
        if (!SORT_PARAM_KEYS.has(key)) {
          return bad(`${path}[${index}].${key}`, `Unknown sort parameter "${key}".`)
        }
        if (key === '$locale' && (
          typeof value !== 'string'
          || value.length > MAX_LOCALE_NAME_LENGTH
          || !isValidQueryCollationLocale(value)
        )) {
          return bad(`${path}[${index}].$locale`, `$locale must be a valid locale no longer than ${MAX_LOCALE_NAME_LENGTH} characters.`)
        }
        if (key === '$numeric' && typeof value !== 'boolean') {
          return bad(`${path}[${index}].$numeric`, '$numeric must be a boolean.')
        }
        if (key === '$caseFirst' && (typeof value !== 'string' || !CASE_FIRST_VALUES.has(value))) {
          return bad(`${path}[${index}].$caseFirst`, '$caseFirst must be one of upper, lower, false.')
        }
        if (key === '$sensitivity' && (typeof value !== 'string' || !SENSITIVITY_VALUES.has(value))) {
          return bad(`${path}[${index}].$sensitivity`, '$sensitivity must be one of base, accent, case, variant.')
        }
        continue
      }
      validateFieldPath(key, `${path}[${index}].${key}`)
      if (value !== 1 && value !== -1) {
        return bad(`${path}[${index}].${key}`, 'Sort direction must be 1 or -1.')
      }
    }
  })
}

const validateSelection = (value: unknown, path: string): void => {
  if (value === undefined) return
  if (!Array.isArray(value)) {
    return bad(path, 'Selection must be an array of field paths.')
  }
  if (value.length > MAX_SELECTION_ENTRIES) {
    return bad(path, `Selection exceeds ${MAX_SELECTION_ENTRIES} entries.`)
  }
  value.forEach((entry, index) => {
    if (typeof entry !== 'string') {
      return bad(`${path}[${index}]`, 'Each selection entry must be a non-empty string.')
    }
    validateFieldPath(entry, `${path}[${index}]`)
  })
}

const validatePagingNumber = (value: unknown, path: string, max: number): void => {
  if (!isFiniteInteger(value) || value < 0) {
    return bad(path, 'Must be a non-negative finite integer.')
  }
  if ((value as number) > max) {
    return bad(path, `Exceeds maximum of ${max}.`)
  }
}

const validatePositivePagingLimit = (value: unknown, path: string): void => {
  validatePagingNumber(value, path, MAX_PUBLIC_QUERY_LIMIT)
  if (value === 0) {
    return bad(path, 'Paging limit must be a positive integer.')
  }
}

const validateSkipLimit = (params: Record<string, unknown>, path: string): void => {
  if (params.skip !== undefined) {
    validatePagingNumber(params.skip, `${path}.skip`, MAX_PUBLIC_QUERY_SKIP)
  }
  if (params.limit !== undefined) {
    validatePagingNumber(params.limit, `${path}.limit`, MAX_PUBLIC_QUERY_LIMIT)
  }
}

/**
 * Offset and cursor paging shapes are mutually exclusive: an
 * offset request may not carry `after`; a cursor request may not carry `page`
 * or `skip`. Structural closure only — whether the requested mode is
 * actually ADVERTISED by the provider is a capability-preflight concern
 * enforced later, before provider dispatch (`providers/index.ts`).
 *
 * This closes `paging.skip`/`paging.page` against cursor mode. The sibling
 * check against duplicate top-level `skip`/`limit` values lives in
 * `validateContentQueryRequestBody`, since it spans both objects.
 */
const validatePaging = (paging: unknown, path: string): void => {
  if (paging === undefined) return
  if (!isPlainObject(paging)) {
    return bad(path, 'paging must be an object.')
  }

  if (paging.mode === 'offset') {
    assertNoUnknownKeys(paging, new Set(CONTENT_QUERY_OFFSET_PAGING_KEYS), path)
    if ('after' in paging) {
      return bad(`${path}.after`, 'Offset paging must not carry a cursor `after` value.')
    }
    validatePagingNumber(paging.skip, `${path}.skip`, MAX_PUBLIC_QUERY_SKIP)
    validatePositivePagingLimit(paging.limit, `${path}.limit`)
    return
  }

  if (paging.mode === 'cursor') {
    assertNoUnknownKeys(paging, new Set(CONTENT_QUERY_CURSOR_PAGING_KEYS), path)
    if ('skip' in paging || 'page' in paging) {
      return bad(`${path}.skip`, 'Cursor paging must not carry offset `skip`/`page` values.')
    }
    if (paging.after !== undefined && paging.after !== null) {
      if (typeof paging.after !== 'string') {
        return bad(`${path}.after`, 'Cursor `after` must be a string or null.')
      } else if (byteLength(paging.after) > MAX_PUBLIC_QUERY_CURSOR_BYTES) {
        return bad(`${path}.after`, `Cursor exceeds ${MAX_PUBLIC_QUERY_CURSOR_BYTES} bytes.`)
      }
    }
    validatePositivePagingLimit(paging.limit, `${path}.limit`)
    return
  }

  return bad(`${path}.mode`, 'paging.mode must be "offset" or "cursor".')
}

const validateLocaleResolutionOptions = (value: Record<string, unknown>, path: string): void => {
  if (value.locale !== undefined) {
    if (typeof value.locale !== 'string' || !value.locale.length) {
      return bad(`${path}.locale`, 'locale must be a non-empty string.')
    }
    if (value.locale.length > MAX_LOCALE_NAME_LENGTH) {
      return bad(`${path}.locale`, `locale exceeds ${MAX_LOCALE_NAME_LENGTH} characters.`)
    }
  }
  if (value.fallback !== undefined && typeof value.fallback !== 'boolean' && !Array.isArray(value.fallback)) {
    return bad(`${path}.fallback`, 'fallback must be a boolean or an array of locale strings.')
  }
  if (Array.isArray(value.fallback)) {
    if (value.fallback.length > MAX_ARRAY_OPERAND_LENGTH) {
      return bad(`${path}.fallback`, `fallback exceeds ${MAX_ARRAY_OPERAND_LENGTH} entries.`)
    }
    for (const [index, entry] of value.fallback.entries()) {
      if (typeof entry !== 'string' || !entry.length) {
        return bad(`${path}.fallback[${index}]`, 'Each fallback locale must be a non-empty string.')
      }
      if (entry.length > MAX_LOCALE_NAME_LENGTH) {
        return bad(`${path}.fallback[${index}]`, `Locale exceeds ${MAX_LOCALE_NAME_LENGTH} characters.`)
      }
    }
  }
  if (value.exact !== undefined && typeof value.exact !== 'boolean') {
    return bad(`${path}.exact`, 'exact must be a boolean.')
  }
}

const validateResolveLocale = (value: unknown, path: string): void => {
  if (value === undefined) return
  if (!isPlainObject(value)) {
    return bad(path, 'resolveLocale must be an object.')
  }
  assertNoUnknownKeys(value, new Set(CONTENT_QUERY_RESOLUTION_KEYS), path)
  validateLocaleResolutionOptions(value, path)
}

/**
 * `resolveVariant` names exactly one selector — `path` XOR `route` XOR `ref`
 *. Zero or more than one is malformed.
 */
const validateResolveVariant = (value: unknown, path: string): void => {
  if (value === undefined) return
  if (!isPlainObject(value)) {
    return bad(path, 'resolveVariant must be an object.')
  }
  assertNoUnknownKeys(value, new Set([
    ...CONTENT_QUERY_VARIANT_SELECTOR_KEYS,
    ...CONTENT_QUERY_RESOLUTION_KEYS
  ]), path)

  const selectors = (['path', 'route', 'ref'] as const).filter(key => value[key] !== undefined)
  if (selectors.length !== 1) {
    return bad(path, 'resolveVariant must name exactly one of path, route, or ref.')
  }
  for (const key of selectors) {
    if (typeof value[key] !== 'string' || !(value[key] as string).length) {
      return bad(`${path}.${key}`, `${key} must be a non-empty string.`)
    }
  }
  validateLocaleResolutionOptions(value, path)
}

/**
 * Validate a decoded content-query HTTP request body against the closed
 * `ContentProviderQueryInput` wire shape. Pure — never touches
 * H3, the provider, or the lowerer. Returns a discriminated result instead of
 * throwing so the H3 adapter controls the exact 400 response shape.
 */
export const validateContentQueryRequestBody = (raw: unknown): QueryValidationResult => {
  try {
    if (!isPlainObject(raw)) {
      return fail('$', 'Request body must be a JSON object.')
    }

    assertNoUnknownKeys(raw, new Set(CONTENT_QUERY_INPUT_KEYS), '$')

    if (raw.collection !== undefined) {
      if (typeof raw.collection !== 'string' || !raw.collection.length) {
        return bad('$.collection', 'collection must be a non-empty string.')
      }
      if ((raw.collection as string).length > MAX_COLLECTION_NAME_LENGTH) {
        return bad('$.collection', `collection exceeds ${MAX_COLLECTION_NAME_LENGTH} characters.`)
      }
    }

    validateWhere(raw.where, '$.where')
    validateSort(raw.sort, '$.sort')
    validateSelection(raw.only, '$.only')
    validateSelection(raw.without, '$.without')
    validateSkipLimit(raw, '$')
    validatePaging(raw.paging, '$.paging')

    if (raw.paging !== undefined && (raw.skip !== undefined || raw.limit !== undefined)) {
      const field = raw.skip !== undefined ? 'skip' : 'limit'
      return bad(`$.${field}`, `Top-level \`${field}\` must not be combined with \`paging\`.`)
    }
    validateResolveLocale(raw.resolveLocale, '$.resolveLocale')
    validateResolveVariant(raw.resolveVariant, '$.resolveVariant')

    if (raw.first !== undefined && typeof raw.first !== 'boolean') {
      return bad('$.first', 'first must be a boolean.')
    }
    if (raw.count !== undefined && typeof raw.count !== 'boolean') {
      return bad('$.count', 'count must be a boolean.')
    }
    if (raw.first === true && raw.count === true) {
      return bad('$.first', 'first and count are mutually exclusive terminals.')
    }
    if ((raw.first === true || raw.count === true) && raw.paging !== undefined) {
      return bad('$.paging', 'paging is only valid for list queries.')
    }

    return { ok: true, value: raw as unknown as ContentProviderQueryInput }
  } catch (error) {
    if (error instanceof ValidationError) {
      return fail(error.path, error.reason)
    }
    throw error
  }
}

/** Reject an oversized request body BEFORE it is even JSON-decoded. */
export const isOversizedQueryRequestBody = (raw: string): boolean => byteLength(raw) > MAX_QUERY_REQUEST_BYTES
