/**
 * HTTP-only resource bounds for the content query wire.
 *
 * Query grammar and semantics belong to `lowerQueryPlan`; this boundary only
 * rejects transport payloads that are too large or expensive before asking
 * that canonical parser to validate and lower them.
 */
import type { ContentProviderQueryInput, ContentQueryTransportInput } from '../../types/query'
import {
  ContentQueryInputError,
  lowerQueryPlan
} from '../../core/query/lower'
import { MAX_PUBLIC_QUERY_CURSOR_BYTES } from '../../core/query/limits'

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

export interface QueryValidationFailure {
  path: string
  reason: string
}

export type QueryValidationResult =
  | { ok: true, value: ContentQueryTransportInput }
  | { ok: false, error: QueryValidationFailure }

class QueryBudgetError extends Error {
  constructor(
    public readonly path: string,
    public readonly reason: string
  ) {
    super(`${path}: ${reason}`)
  }
}

const bad = (path: string, reason: string): never => {
  throw new QueryBudgetError(path, reason)
}

const fail = (path: string, reason: string): QueryValidationResult => ({
  ok: false,
  error: { path, reason }
})

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value)
  && typeof value === 'object'
  && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)

const byteLength = (value: string): number => {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).length
  }
  return Buffer.byteLength(value)
}

const validateBoundedString = (
  value: unknown,
  path: string,
  maximum: number,
  label: string
): void => {
  if (typeof value === 'string' && value.length > maximum) {
    bad(path, `${label} exceeds ${maximum} characters.`)
  }
}

const validateJsonOperandBudget = (value: unknown, path: string, depth: number): void => {
  if (value === null || value === undefined || typeof value === 'boolean') return

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) bad(path, 'Numeric operand must be finite.')
    return
  }

  if (typeof value === 'string') {
    validateBoundedString(value, path, MAX_STRING_OPERAND_LENGTH, 'String operand')
    return
  }

  if (depth > MAX_FILTER_DEPTH) {
    bad(path, `Filter nesting exceeds maximum depth of ${MAX_FILTER_DEPTH}.`)
  }

  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_OPERAND_LENGTH) {
      bad(path, `Array operand exceeds ${MAX_ARRAY_OPERAND_LENGTH} entries.`)
    }
    value.forEach((entry, index) =>
      validateJsonOperandBudget(entry, `${path}[${index}]`, depth + 1)
    )
    return
  }

  if (!isPlainObject(value)) {
    bad(path, 'HTTP query operands must be JSON values.')
  }
  for (const [key, child] of Object.entries(value)) {
    if (!key.startsWith('$') && key.length > MAX_FIELD_PATH_LENGTH) {
      bad(`${path}.${key}`, `Field path exceeds ${MAX_FIELD_PATH_LENGTH} characters.`)
    }
    if ((key === '$and' || key === '$or') && Array.isArray(child) && child.length > MAX_LOGICAL_GROUP_MEMBERS) {
      bad(`${path}.${key}`, `${key} exceeds ${MAX_LOGICAL_GROUP_MEMBERS} members.`)
    }
    validateJsonOperandBudget(child, `${path}.${key}`, depth + 1)
  }
}

const validateSelectionBudget = (value: unknown, path: string): void => {
  if (!Array.isArray(value)) return
  if (value.length > MAX_SELECTION_ENTRIES) {
    bad(path, `Selection exceeds ${MAX_SELECTION_ENTRIES} entries.`)
  }
  value.forEach((entry, index) =>
    validateBoundedString(entry, `${path}[${index}]`, MAX_FIELD_PATH_LENGTH, 'Field path')
  )
}

const validateSortBudget = (value: unknown): void => {
  if (!Array.isArray(value)) return
  if (value.length > MAX_SORT_ENTRIES) {
    bad('$.sort', `sort exceeds ${MAX_SORT_ENTRIES} entries.`)
  }
  value.forEach((entry, index) => {
    if (!isPlainObject(entry)) return
    for (const [key, child] of Object.entries(entry)) {
      if (key === '$locale') {
        validateBoundedString(child, `$.sort[${index}].$locale`, MAX_LOCALE_NAME_LENGTH, 'Locale')
      }
      else if (!key.startsWith('$') && key.length > MAX_FIELD_PATH_LENGTH) {
        bad(`$.sort[${index}].${key}`, `Field path exceeds ${MAX_FIELD_PATH_LENGTH} characters.`)
      }
    }
  })
}

const validateLocaleBudget = (value: unknown, path: string): void => {
  if (!isPlainObject(value)) return
  validateBoundedString(value.locale, `${path}.locale`, MAX_LOCALE_NAME_LENGTH, 'Locale')
  for (const selector of ['path', 'route', 'ref'] as const) {
    validateBoundedString(value[selector], `${path}.${selector}`, MAX_STRING_OPERAND_LENGTH, 'Selector')
  }
  if (Array.isArray(value.fallback)) {
    if (value.fallback.length > MAX_ARRAY_OPERAND_LENGTH) {
      bad(`${path}.fallback`, `fallback exceeds ${MAX_ARRAY_OPERAND_LENGTH} entries.`)
    }
    value.fallback.forEach((locale, index) =>
      validateBoundedString(locale, `${path}.fallback[${index}]`, MAX_LOCALE_NAME_LENGTH, 'Locale')
    )
  }
}

const validateRequestBudget = (raw: unknown): ContentQueryTransportInput => {
  if (!isPlainObject(raw)) {
    bad('$', 'Request body must be a JSON object.')
  }
  const record = raw as Record<string, unknown>

  validateBoundedString(record.collection, '$.collection', MAX_COLLECTION_NAME_LENGTH, 'collection')
  if (record.where !== undefined) {
    validateJsonOperandBudget(record.where, '$.where', 1)
  }
  validateSelectionBudget(record.only, '$.only')
  validateSelectionBudget(record.without, '$.without')
  validateSortBudget(record.sort)
  validateLocaleBudget(record.resolveLocale, '$.resolveLocale')
  validateLocaleBudget(record.resolveVariant, '$.resolveVariant')
  if (record.populate !== undefined) {
    if (record.count === true) bad('$.populate', 'count queries cannot populate references.')
    if (!isPlainObject(record.populate)) bad('$.populate', 'populate must be an object keyed by reference field.')
    const entries = Object.entries(record.populate as Record<string, unknown>)
    if (entries.length > MAX_SELECTION_ENTRIES) bad('$.populate', `populate exceeds ${MAX_SELECTION_ENTRIES} entries.`)
    for (const [field, target] of entries) {
      validateBoundedString(field, `$.populate.${field}`, MAX_FIELD_PATH_LENGTH, 'Reference field')
      if (!field || typeof target !== 'string' || !target) {
        bad(`$.populate.${field}`, 'populate targets must be non-empty collection names.')
      }
      validateBoundedString(target, `$.populate.${field}`, MAX_COLLECTION_NAME_LENGTH, 'Collection name')
    }
  }

  const paging = record.paging
  if (
    isPlainObject(paging)
    && typeof paging.after === 'string'
    && byteLength(paging.after) > MAX_PUBLIC_QUERY_CURSOR_BYTES
  ) {
    bad('$.paging.after', `Cursor exceeds ${MAX_PUBLIC_QUERY_CURSOR_BYTES} bytes.`)
  }
  return record as unknown as ContentQueryTransportInput
}

/**
 * Validate a decoded HTTP request. Resource limits are enforced here; the
 * canonical lowerer owns the accepted query language.
 */
export const validateContentQueryRequestBody = (raw: unknown): QueryValidationResult => {
  try {
    const query = validateRequestBudget(raw)
    const { populate: _populate, ...providerQuery } = query
    lowerQueryPlan(providerQuery as ContentProviderQueryInput, { publicOperatorsOnly: true })
    return { ok: true, value: query }
  }
  catch (error) {
    if (error instanceof QueryBudgetError || error instanceof ContentQueryInputError) {
      return fail(error.path, error instanceof QueryBudgetError ? error.reason : error.message)
    }
    if (error instanceof TypeError) {
      return fail('$', error.message)
    }
    throw error
  }
}

/** Reject an oversized request payload before JSON decoding. */
export const isOversizedQueryRequestBody = (raw: string): boolean =>
  byteLength(raw) > MAX_QUERY_REQUEST_BYTES
