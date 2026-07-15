import type { ContentQuerySortOptions, ContentQuerySortParams } from '../../types/query'

const isNullish = (value: unknown): value is null | undefined =>
  value === null || value === undefined

export const get = (obj: Record<string, unknown> | undefined, path: string): unknown =>
  path.split('.').reduce<unknown>((acc, part) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined), obj)

const pickObject = <T extends Record<string, unknown>>(obj: T, condition: (item: string) => boolean) =>
  Object.keys(obj)
    .filter(condition)
    .reduce<Record<string, unknown>>((newObj, key) => Object.assign(newObj, { [key]: obj[key] }), {})

export const omit = (keys?: string[]) => <T extends Record<string, unknown>>(obj: T) =>
  keys && keys.length ? pickObject(obj, key => !keys.includes(key)) : obj

export const apply = <TInput, TOutput>(fn: (d: TInput) => TOutput) => (data: TInput | TInput[]) =>
  Array.isArray(data) ? data.map(item => fn(item)) : fn(data)

export const detectProperties = (keys: string[]) => {
  const prefixes = []
  const properties = []
  for (const key of keys) {
    if (['$', '_'].includes(key)) {
      prefixes.push(key)
    } else {
      properties.push(key)
    }
  }
  return { prefixes, properties }
}

export const withoutKeys = (keys: string[] = []) => <T extends Record<string, unknown>>(obj: T | undefined) => {
  if (keys.length === 0 || !obj) {
    return obj
  }
  const { prefixes, properties } = detectProperties(keys)
  return pickObject(obj, key => !properties.includes(key) && !prefixes.includes(key.charAt(0)))
}

export const withKeys = (keys: string[] = []) => <T extends Record<string, unknown>>(obj: T | undefined) => {
  if (keys.length === 0 || !obj) {
    return obj
  }
  const { prefixes, properties } = detectProperties(keys)
  return pickObject(obj, key => properties.includes(key) || prefixes.includes(key.charAt(0)))
}

export const sortList = <T extends Record<string, unknown>>(data: T[], params: ContentQuerySortOptions) => {
  // `ContentQuerySortOptions` is a union of `ContentQuerySortParams` (the
  // `$locale`/`$numeric`/etc. knobs) and `ContentQuerySortFields` (the
  // `{ field: 1 | -1 }` map). At call-time the two shapes are always merged
  // into one object, so a narrow read-through cast is honest here.
  const sortParams = params as ContentQuerySortParams
  const comperable = new Intl.Collator(sortParams.$locale, {
    numeric: sortParams.$numeric,
    caseFirst: sortParams.$caseFirst,
    sensitivity: sortParams.$sensitivity
  })
  const keys = Object.keys(params).filter(key => !key.startsWith('$'))
  for (const key of keys) {
    data = data.sort((a, b) => {
      const values = [get(a, key), get(b, key)]
        .map((value) => {
          if (value === null) {
            return undefined
          }
          if (value instanceof Date) {
            return value.toISOString()
          }
          return typeof value === 'undefined' ? undefined : String(value)
        })
      if (params[key as keyof ContentQuerySortOptions] === -1) {
        values.reverse()
      }
      return comperable.compare(values[0] || '', values[1] || '')
    })
  }

  return data
}

/**
 * Raise TypeError if value is not an array.
 */
export function assertArray (value: unknown, message = 'Expected an array'): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(message)
  }
}

/**
 * Ensure result is an array
 */
export const ensureArray = <T>(value: T) => {
  return (Array.isArray(value) ? value : isNullish(value) ? [] : [value]) as T extends Array<unknown> ? T : T[]
}

export const LOGICAL_QUERY_OPERATORS = new Set(['$and', '$or', '$not'])

export const SUPPORTED_QUERY_OPERATORS = [
  '$eq',
  '$ne',
  '$gt',
  '$gte',
  '$lt',
  '$lte',
  '$in',
  '$nin',
  '$contains',
  '$containsAny',
  '$icontains',
  '$exists',
  '$type',
  '$regex',
  '$prefix',
  '$options',
  '$not'
] as const

const isQueryOperatorRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof RegExp) && !(value instanceof Date)
}

export const containsStandaloneRegexOptions = (value: unknown): boolean => {
  if (!isQueryOperatorRecord(value)) {
    return false
  }

  if ('$options' in value && !('$regex' in value)) {
    return true
  }

  return Object.values(value).some((child) => {
    if (Array.isArray(child)) {
      return child.some(containsStandaloneRegexOptions)
    }

    return containsStandaloneRegexOptions(child)
  })
}

export const findUnsupportedQueryOperator = (value: unknown, extraOperators: readonly string[] = []): string | undefined => {
  if (!value || value instanceof RegExp || value instanceof Date) {
    return undefined
  }

  if (Array.isArray(value)) {
    return value.map(item => findUnsupportedQueryOperator(item, extraOperators)).find(Boolean)
  }

  if (!isQueryOperatorRecord(value)) {
    return undefined
  }

  for (const [key, nested] of Object.entries(value)) {
    if (
      key.startsWith('$') &&
      !LOGICAL_QUERY_OPERATORS.has(key) &&
      !SUPPORTED_QUERY_OPERATORS.includes(key as typeof SUPPORTED_QUERY_OPERATORS[number]) &&
      !extraOperators.includes(key)
    ) {
      return key
    }

    const unsupported = findUnsupportedQueryOperator(nested, extraOperators)
    if (unsupported) return unsupported
  }
}

export const assertSupportedQueryOperators = (value: unknown, extraOperators: readonly string[] = []): void => {
  const unsupported = findUnsupportedQueryOperator(value, extraOperators)
  if (unsupported) {
    throw new TypeError(`Unsupported content query operator: ${unsupported}`)
  }
}
