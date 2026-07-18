const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const expected = new Set(keys)
  return Object.keys(value).length === expected.size && Object.keys(value).every(key => expected.has(key))
}

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const isDenseArray = (value: unknown[]): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    if (!(index in value)) return false
  }
  return true
}

export interface OffsetFindResponseEnvelope<T = unknown> {
  mode?: 'offset'
  result: T[]
  total: number
  skip: number
  limit: number
}

export interface OffsetFindResponseConstraints {
  expectedSkip?: number
  expectedLimit?: number
}

export const isCanonicalOffsetFindResponseEnvelope = <T = unknown>(
  response: unknown,
  constraints: OffsetFindResponseConstraints = {}
): response is OffsetFindResponseEnvelope<T> => isObject(response) &&
  Array.isArray(response.result) &&
  isDenseArray(response.result) &&
  isNonNegativeInteger(response.total) &&
  isNonNegativeInteger(response.skip) &&
  isNonNegativeInteger(response.limit) &&
  (constraints.expectedSkip === undefined || response.skip === constraints.expectedSkip) &&
  (constraints.expectedLimit === undefined || response.limit === constraints.expectedLimit) &&
  response.total >= response.result.length &&
  (response.result.length === 0 || response.total >= response.skip + response.result.length) &&
  response.result.length <= response.limit &&
  (response.mode === undefined
    ? hasExactKeys(response, ['result', 'skip', 'limit', 'total'])
    : response.mode === 'offset' && hasExactKeys(response, ['mode', 'result', 'skip', 'limit', 'total']))

const isResultOnlyEnvelope = (response: unknown): response is { result?: unknown } =>
  isObject(response) &&
  'result' in response &&
  hasExactKeys(response, ['result'])

export const unwrapOneResponse = <T>(response: unknown): T | null => {
  // The HTTP adapter uses top-level null because JSON cannot preserve an
  // object property whose value is undefined. The provider boundary itself
  // remains the canonical `{ result: T | undefined }` envelope.
  if (response === null) return null
  if (isResultOnlyEnvelope(response) && response.result === undefined) return null
  if (isResultOnlyEnvelope(response) && response.result !== null && !Array.isArray(response.result)) return response.result as T
  throw new TypeError('Invalid content query response: expected a single-result envelope or null.')
}

export const unwrapListResponse = <T>(response: unknown): T[] => {
  if (isCanonicalOffsetFindResponseEnvelope<T>(response)) return response.result
  throw new TypeError('Invalid content query response: expected an offset-list envelope.')
}

export const unwrapFindResponse = <T>(response: unknown): {
  result: T[]
  total: number
  skip: number
  limit: number
} => {
  if (isCanonicalOffsetFindResponseEnvelope<T>(response)) {
    return {
      result: response.result as T[],
      total: response.total,
      skip: response.skip,
      limit: response.limit
    }
  }
  throw new TypeError('Invalid content query response: expected an offset-list envelope.')
}

export interface CursorFindResponseEnvelope<T = unknown> {
  mode: 'cursor'
  result: T[]
  limit: number
  pageInfo: { endCursor: string | null, hasNext: boolean }
}

export const isCanonicalCursorFindResponseEnvelope = <T = unknown>(
  response: unknown,
  constraints: { maxLimit?: number } = {}
): response is CursorFindResponseEnvelope<T> => isObject(response) &&
  response.mode === 'cursor' &&
  Array.isArray(response.result) &&
  isDenseArray(response.result) &&
  isNonNegativeInteger(response.limit) &&
  (constraints.maxLimit === undefined || response.limit <= constraints.maxLimit) &&
  response.result.length <= response.limit &&
  isObject(response.pageInfo) &&
  (response.pageInfo.endCursor === null || typeof response.pageInfo.endCursor === 'string') &&
  typeof response.pageInfo.hasNext === 'boolean' &&
  (!response.pageInfo.hasNext || (typeof response.pageInfo.endCursor === 'string' && response.pageInfo.endCursor.length > 0)) &&
  hasExactKeys(response.pageInfo, ['endCursor', 'hasNext']) &&
  hasExactKeys(response, ['mode', 'result', 'limit', 'pageInfo'])

/** Unwrap a `mode: 'cursor'` provider list response. Never invents a `total`. */
export const unwrapCursorFindResponse = <T>(response: unknown): {
  result: T[]
  limit: number
  endCursor: string | null
  hasNext: boolean
} => {
  if (!isCanonicalCursorFindResponseEnvelope<T>(response)) {
    throw new TypeError('Invalid content query response: expected a cursor-list envelope.')
  }

  const { endCursor, hasNext } = response.pageInfo
  return {
    result: response.result,
    limit: response.limit,
    endCursor,
    hasNext
  }
}
