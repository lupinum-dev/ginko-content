export const MAX_PUBLIC_QUERY_LIMIT = 100
export const MAX_PUBLIC_QUERY_SKIP = 10_000
export const MAX_PUBLIC_QUERY_CURSOR_BYTES = 4_096
export const MAX_PUBLIC_POPULATE_REFERENCES = 1_000
export const DEFAULT_PUBLIC_QUERY_LIMIT = 100
export const DEFAULT_PUBLIC_PAGINATION_LIMIT = 10

const assertNonNegativeInteger: (value: unknown, field: string, maximum: number) => asserts value is number = (value, field, maximum) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`Content query ${field} must be a non-negative finite integer.`)
  }
  if (value > maximum) {
    throw new TypeError(`Content query ${field} exceeds the maximum of ${maximum}.`)
  }
}

export const assertPublicQueryLimit: (value: unknown) => asserts value is number = (value) => {
  assertNonNegativeInteger(value, 'limit', MAX_PUBLIC_QUERY_LIMIT)
}

export const assertPublicPagingLimit: (value: unknown) => asserts value is number = (value) => {
  assertPublicQueryLimit(value)
  if (value === 0) {
    throw new TypeError('Content query paging limit must be a positive integer.')
  }
}

export const assertPublicQuerySkip: (value: unknown) => asserts value is number = (value) => {
  assertNonNegativeInteger(value, 'skip', MAX_PUBLIC_QUERY_SKIP)
}
