const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const isFindResponseEnvelope = (response: unknown): response is {
  result?: unknown
  total?: unknown
  skip?: unknown
  limit?: unknown
} => isObject(response) &&
  Array.isArray(response.result) &&
  typeof response.total === 'number' &&
  (typeof response.skip === 'undefined' || typeof response.skip === 'number') &&
  (typeof response.limit === 'undefined' || typeof response.limit === 'number')

const isResultOnlyEnvelope = (response: unknown): response is { result?: unknown } =>
  isObject(response) &&
  'result' in response &&
  Object.keys(response).length === 1

const isSingleQueryEnvelope = (response: unknown): response is {
  result?: unknown
  total?: unknown
  skip?: unknown
  limit?: unknown
} => isFindResponseEnvelope(response) || isResultOnlyEnvelope(response)

const isListQueryEnvelope = (response: unknown): response is {
  result?: unknown
  total?: unknown
  skip?: unknown
  limit?: unknown
} => isFindResponseEnvelope(response)

export const unwrapOneResponse = <T>(response: unknown): T | T[] | null => {
  if (!response) return null
  if (isSingleQueryEnvelope(response)) {
    const result = response.result
    return (result ?? null) as T | T[] | null
  }
  return response as T
}

export const unwrapListResponse = <T>(response: unknown): T[] => {
  if (!response) return []
  if (isListQueryEnvelope(response)) {
    return response.result as T[]
  }
  return Array.isArray(response) ? response as T[] : [response as T]
}

export const unwrapFindResponse = <T>(response: unknown): {
  result: T[]
  total: number
  skip: number
  limit: number
  hasTotal: boolean
} => {
  if (!response) {
    return { result: [], total: 0, skip: 0, limit: 0, hasTotal: false }
  }

  if (isListQueryEnvelope(response)) {
    const result = Array.isArray(response.result) ? response.result as T[] : response.result ? [response.result as T] : []
    const hasTotal = typeof response.total === 'number'
    return {
      result,
      total: hasTotal ? response.total as number : result.length,
      skip: typeof response.skip === 'number' ? response.skip : 0,
      limit: typeof response.limit === 'number' ? response.limit : result.length,
      hasTotal
    }
  }

  const result = Array.isArray(response) ? response as T[] : [response as T]
  return { result, total: result.length, skip: 0, limit: result.length, hasTotal: false }
}

const isCursorFindResponseEnvelope = (response: unknown): response is {
  mode: 'cursor'
  result: unknown
  limit?: unknown
  pageInfo?: { endCursor?: unknown, hasNext?: unknown }
} => isObject(response) &&
  response.mode === 'cursor' &&
  Array.isArray(response.result) &&
  isObject(response.pageInfo)

/** Unwrap a `mode: 'cursor'` provider list response (VNEXT.md 10.2). Never invents a `total`. */
export const unwrapCursorFindResponse = <T>(response: unknown): {
  result: T[]
  limit: number
  endCursor: string | null
  hasNext: boolean
} => {
  if (!isCursorFindResponseEnvelope(response)) {
    return { result: [], limit: 0, endCursor: null, hasNext: false }
  }

  const result = response.result as T[]
  return {
    result,
    limit: typeof response.limit === 'number' ? response.limit : result.length,
    endCursor: typeof response.pageInfo?.endCursor === 'string' ? response.pageInfo.endCursor : null,
    hasNext: Boolean(response.pageInfo?.hasNext)
  }
}

export const unwrapCountResponse = (response: unknown) => {
  if (typeof response === 'number') {
    return response
  }
  if (isSingleQueryEnvelope(response) && typeof response.result === 'number') {
    return response.result
  }
  return null
}
