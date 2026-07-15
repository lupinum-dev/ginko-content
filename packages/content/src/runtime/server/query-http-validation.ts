/**
 * Closed HTTP validation for the content query wire (VNEXT.md 16).
 *
 * The HTTP transport is internal to the client query API but is still an
 * untrusted runtime boundary — parsing JSON is not validation. This module is
 * a PURE validator: it never touches H3, the provider, or the query lowerer.
 * It rejects unknown keys at every closed object level, bounds every
 * resource-safety limit, and validates operator/pagination/selector shape —
 * all BEFORE lowering or provider dispatch ever run (see
 * `runtime/server/api/query.ts` for the thin H3 adapter).
 *
 * The source of truth for accepted operators is `SUPPORTED_QUERY_OPERATORS`
 * plus the logical `$and`/`$or` connectives — the exact same list the
 * filesystem provider advertises and the operator-parity test asserts
 * (VNEXT.md 20.7), so `$nin` (and any future operator) cannot drift between
 * the public type, the filesystem executor, and this boundary.
 */
import type { ContentQueryBuilderParams } from '../../types/query'
import { LOGICAL_QUERY_OPERATORS, SUPPORTED_QUERY_OPERATORS } from '../../core/query/operators'
import { MAX_PUBLIC_QUERY_LIMIT, MAX_PUBLIC_QUERY_SKIP } from '../../features/query/public-limits'

/** Transport safety limits (VNEXT.md 16.2) — NOT provider capabilities. */
export const MAX_QUERY_REQUEST_BYTES = 32_768
export const MAX_FILTER_DEPTH = 8
export const MAX_LOGICAL_GROUP_MEMBERS = 32
export const MAX_SELECTION_ENTRIES = 64
export const MAX_SORT_ENTRIES = 16
export const MAX_STRING_OPERAND_LENGTH = 1_000
export const MAX_ARRAY_OPERAND_LENGTH = 200
export const MAX_CURSOR_BYTES = 4_096
export const MAX_FIELD_PATH_LENGTH = 200
export const MAX_COLLECTION_NAME_LENGTH = 200

const KNOWN_OPERATOR_KEYS = new Set<string>([
  ...SUPPORTED_QUERY_OPERATORS,
  ...LOGICAL_QUERY_OPERATORS
])

const SORT_PARAM_KEYS = new Set(['$locale', '$numeric', '$caseFirst', '$sensitivity'])
const CASE_FIRST_VALUES = new Set(['upper', 'lower', 'false'])
const SENSITIVITY_VALUES = new Set(['base', 'accent', 'case', 'variant'])

export interface QueryValidationFailure {
  /** Dotted path to the offending field, e.g. `where[0].title.$regex`. */
  path: string
  reason: string
}

export type QueryValidationResult =
  | { ok: true, value: ContentQueryBuilderParams }
  | { ok: false, error: QueryValidationFailure }

const fail = (path: string, reason: string): QueryValidationResult => ({ ok: false, error: { path, reason } })

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

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

  const hasRegex = '$regex' in value
  if ('$options' in value && !hasRegex) {
    return bad(`${path}.$options`, 'Operator $options requires $regex.')
  }

  for (const [key, entry] of Object.entries(value)) {
    if (key === '$options') {
      if (typeof entry !== 'string') {
        return bad(`${path}.$options`, '$options must be a string.')
      }
      continue
    }

    if (key.startsWith('$')) {
      if (!KNOWN_OPERATOR_KEYS.has(key) || key === '$and' || key === '$or') {
        return bad(`${path}.${key}`, `Unknown query operator "${key}".`)
      }

      if (key === '$not') {
        if (isPlainObject(entry)) {
          validateFieldValue(entry, `${path}.$not`, depth + 1)
        } else {
          validateOperand(entry, `${path}.$not`, depth)
        }
        continue
      }

      if (key === '$exists') {
        if (typeof entry !== 'boolean') {
          return bad(`${path}.$exists`, '$exists must be a boolean.')
        }
        continue
      }

      if (key === '$type') {
        if (typeof entry !== 'string') {
          return bad(`${path}.$type`, '$type must be a string.')
        }
        continue
      }

      if (key === '$regex') {
        if (typeof entry !== 'string') {
          return bad(`${path}.$regex`, '$regex must be a string; live RegExp objects are not accepted over HTTP.')
        } else if (entry.length > MAX_STRING_OPERAND_LENGTH) {
          return bad(`${path}.$regex`, `$regex exceeds ${MAX_STRING_OPERAND_LENGTH} characters.`)
        }
        continue
      }

      validateOperand(entry, `${path}.${key}`, depth)
      continue
    }

    // Non-`$` key: nested field path — recurse, still bounded by depth.
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

  for (const [key, value] of Object.entries(condition)) {
    if (key === '$and' || key === '$or') {
      if (!Array.isArray(value)) {
        return bad(`${path}.${key}`, `${key} must be an array.`)
      }
      if (value.length > MAX_LOGICAL_GROUP_MEMBERS) {
        return bad(`${path}.${key}`, `${key} exceeds ${MAX_LOGICAL_GROUP_MEMBERS} members.`)
      }
      value.forEach((member, index) => validateWhereCondition(member, `${path}.${key}[${index}]`, depth + 1))
      continue
    }

    if (key === '$not') {
      if (isPlainObject(value)) {
        validateWhereCondition(value, `${path}.$not`, depth + 1)
      } else {
        validateOperand(value, `${path}.$not`, depth)
      }
      continue
    }

    if (key.startsWith('$')) {
      return bad(`${path}.${key}`, `Unknown top-level query key "${key}".`)
    }

    if (key.length > MAX_FIELD_PATH_LENGTH) {
      return bad(`${path}.${key}`, `Field path exceeds ${MAX_FIELD_PATH_LENGTH} characters.`)
    }

    validateOperand(value, `${path}.${key}`, depth + 1)
  }
}

const validateWhere = (where: unknown, path: string): void => {
  if (where === undefined) return
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
        if (key === '$locale' && typeof value !== 'string') {
          return bad(`${path}[${index}].$locale`, '$locale must be a string.')
        }
        if (key === '$numeric' && typeof value !== 'boolean') {
          return bad(`${path}[${index}].$numeric`, '$numeric must be a boolean.')
        }
        if (key === '$caseFirst' && !CASE_FIRST_VALUES.has(String(value))) {
          return bad(`${path}[${index}].$caseFirst`, '$caseFirst must be one of upper, lower, false.')
        }
        if (key === '$sensitivity' && !SENSITIVITY_VALUES.has(String(value))) {
          return bad(`${path}[${index}].$sensitivity`, '$sensitivity must be one of base, accent, case, variant.')
        }
        continue
      }
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
    if (typeof entry !== 'string' || !entry.length) {
      return bad(`${path}[${index}]`, 'Each selection entry must be a non-empty string.')
    } else if (entry.length > MAX_FIELD_PATH_LENGTH) {
      return bad(`${path}[${index}]`, `Field path exceeds ${MAX_FIELD_PATH_LENGTH} characters.`)
    }
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

const validateSkipLimit = (params: Record<string, unknown>, path: string): void => {
  if (params.skip !== undefined) {
    validatePagingNumber(params.skip, `${path}.skip`, MAX_PUBLIC_QUERY_SKIP)
  }
  if (params.limit !== undefined) {
    validatePagingNumber(params.limit, `${path}.limit`, MAX_PUBLIC_QUERY_LIMIT)
  }
}

/**
 * Offset and cursor paging shapes are mutually exclusive (VNEXT.md 16.3): an
 * offset request may not carry `after`; a cursor request may not carry `page`
 * or `skip`. Structural closure only — whether the requested mode is
 * actually ADVERTISED by the provider is a capability-preflight concern
 * enforced later, before provider dispatch (`providers/index.ts`).
 *
 * This closes `paging.skip`/`paging.page` against cursor mode; the sibling
 * check against the *top-level* `skip` field (offset paging's legacy/flat
 * shorthand) lives in `validateContentQueryRequestBody`, since it spans both
 * `raw.skip` and `raw.paging` and is not local to this object.
 */
const validatePaging = (paging: unknown, path: string): void => {
  if (paging === undefined) return
  if (!isPlainObject(paging)) {
    return bad(path, 'paging must be an object.')
  }

  if (paging.mode === 'offset') {
    assertNoUnknownKeys(paging, new Set(['mode', 'skip', 'limit']), path)
    if ('after' in paging) {
      return bad(`${path}.after`, 'Offset paging must not carry a cursor `after` value.')
    }
    validatePagingNumber(paging.skip, `${path}.skip`, MAX_PUBLIC_QUERY_SKIP)
    validatePagingNumber(paging.limit, `${path}.limit`, MAX_PUBLIC_QUERY_LIMIT)
    return
  }

  if (paging.mode === 'cursor') {
    assertNoUnknownKeys(paging, new Set(['mode', 'after', 'limit']), path)
    if ('skip' in paging || 'page' in paging) {
      return bad(`${path}.skip`, 'Cursor paging must not carry offset `skip`/`page` values.')
    }
    if (paging.after !== undefined && paging.after !== null) {
      if (typeof paging.after !== 'string') {
        return bad(`${path}.after`, 'Cursor `after` must be a string or null.')
      } else if (byteLength(paging.after) > MAX_CURSOR_BYTES) {
        return bad(`${path}.after`, `Cursor exceeds ${MAX_CURSOR_BYTES} bytes.`)
      }
    }
    validatePagingNumber(paging.limit, `${path}.limit`, MAX_PUBLIC_QUERY_LIMIT)
    return
  }

  return bad(`${path}.mode`, 'paging.mode must be "offset" or "cursor".')
}

const validateResolveLocale = (value: unknown, path: string): void => {
  if (value === undefined) return
  if (!isPlainObject(value)) {
    return bad(path, 'resolveLocale must be an object.')
  }
  assertNoUnknownKeys(value, new Set(['locale', 'fallback', 'exact']), path)
  if (value.locale !== undefined && typeof value.locale !== 'string') {
    return bad(`${path}.locale`, 'locale must be a string.')
  }
  if (value.fallback !== undefined && typeof value.fallback !== 'boolean' && !Array.isArray(value.fallback)) {
    return bad(`${path}.fallback`, 'fallback must be a boolean or an array of locale strings.')
  }
  if (Array.isArray(value.fallback)) {
    value.fallback.forEach((entry: unknown, index: number) => {
      if (typeof entry !== 'string') {
        return bad(`${path}.fallback[${index}]`, 'Each fallback locale must be a string.')
      }
    })
  }
  if (value.exact !== undefined && typeof value.exact !== 'boolean') {
    return bad(`${path}.exact`, 'exact must be a boolean.')
  }
}

/**
 * `resolveVariant` names exactly one selector — `path` XOR `route` XOR `ref`
 * (VNEXT.md 16.1 "selector XOR shape"). Zero or more than one is malformed.
 */
const validateResolveVariant = (value: unknown, path: string): void => {
  if (value === undefined) return
  if (!isPlainObject(value)) {
    return bad(path, 'resolveVariant must be an object.')
  }
  assertNoUnknownKeys(value, new Set(['path', 'route', 'ref', 'locale', 'fallback', 'exact']), path)

  const selectors = (['path', 'route', 'ref'] as const).filter(key => value[key] !== undefined)
  if (selectors.length !== 1) {
    return bad(path, 'resolveVariant must name exactly one of path, route, or ref.')
  }
  for (const key of selectors) {
    if (typeof value[key] !== 'string' || !(value[key] as string).length) {
      return bad(`${path}.${key}`, `${key} must be a non-empty string.`)
    }
  }
  if (value.locale !== undefined && typeof value.locale !== 'string') {
    return bad(`${path}.locale`, 'locale must be a string.')
  }
  if (value.fallback !== undefined && typeof value.fallback !== 'boolean' && !Array.isArray(value.fallback)) {
    return bad(`${path}.fallback`, 'fallback must be a boolean or an array of locale strings.')
  }
  if (value.exact !== undefined && typeof value.exact !== 'boolean') {
    return bad(`${path}.exact`, 'exact must be a boolean.')
  }
}

const TOP_LEVEL_KEYS = new Set([
  'collection',
  'where',
  'sort',
  'only',
  'without',
  'skip',
  'limit',
  'first',
  'count',
  'resolveLocale',
  'resolveVariant',
  'paging'
])

/**
 * Validate a decoded content-query HTTP request body against the closed
 * `ContentQueryBuilderParams` wire shape (VNEXT.md 16). Pure — never touches
 * H3, the provider, or the lowerer. Returns a discriminated result instead of
 * throwing so the H3 adapter controls the exact 400 response shape.
 */
export const validateContentQueryRequestBody = (raw: unknown): QueryValidationResult => {
  try {
    if (!isPlainObject(raw)) {
      return fail('$', 'Request body must be a JSON object.')
    }

    assertNoUnknownKeys(raw, TOP_LEVEL_KEYS, '$')

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

    if (isPlainObject(raw.paging) && raw.paging.mode === 'cursor' && raw.skip !== undefined) {
      return bad('$.skip', 'Top-level `skip` must not be combined with cursor paging (`paging.mode: "cursor"`).')
    }
    validateResolveLocale(raw.resolveLocale, '$.resolveLocale')
    validateResolveVariant(raw.resolveVariant, '$.resolveVariant')

    if (raw.first !== undefined && typeof raw.first !== 'boolean') {
      return bad('$.first', 'first must be a boolean.')
    }
    if (raw.count !== undefined && typeof raw.count !== 'boolean') {
      return bad('$.count', 'count must be a boolean.')
    }

    return { ok: true, value: raw as unknown as ContentQueryBuilderParams }
  } catch (error) {
    if (error instanceof ValidationError) {
      return fail(error.path, error.reason)
    }
    throw error
  }
}

/** Reject an oversized request body BEFORE it is even JSON-decoded (VNEXT.md 16.2/16.4). */
export const isOversizedQueryRequestBody = (raw: string): boolean => byteLength(raw) > MAX_QUERY_REQUEST_BYTES
