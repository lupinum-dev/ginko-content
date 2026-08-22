import type { ContentQuerySortOptions, ContentQuerySortParams } from '../../types/query'

const isNullish = (value: unknown): value is null | undefined =>
  value === null || value === undefined

const FORBIDDEN_QUERY_FIELD_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])

/** Query field paths are dotted own-property paths. */
export const isValidQueryFieldPath = (path: unknown): path is string =>
  typeof path === 'string' &&
  path.length > 0 &&
  path.split('.').every(segment => segment.length > 0 && !FORBIDDEN_QUERY_FIELD_PATH_SEGMENTS.has(segment))

/** Locale identifier accepted by the platform collation implementation. */
export const isValidQueryCollationLocale = (locale: unknown): locale is string => {
  if (typeof locale !== 'string' || locale.length === 0) return false
  try {
    return Intl.getCanonicalLocales(locale).length === 1
  }
  catch {
    return false
  }
}

export const get = (obj: Record<string, unknown> | undefined, path: string): unknown =>
  path.split('.').reduce<unknown>((acc, part) =>
    acc && typeof acc === 'object' && Object.prototype.hasOwnProperty.call(acc, part)
      ? (acc as Record<string, unknown>)[part]
      : undefined, obj)

const pickObject = <T extends Record<string, unknown>>(obj: T, condition: (item: string) => boolean) =>
  Object.fromEntries(Object.entries(obj).filter(([key]) => condition(key)))

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

export interface DocumentProjection {
  only?: readonly string[]
  without?: readonly string[]
}

/** Apply the shared document field-selection rules at every query boundary. */
export const projectDocumentFields = <T extends Record<string, unknown>>(
  document: T,
  projection: DocumentProjection,
  guaranteed: readonly string[] = []
): T => {
  const selected = projection.only ?? []
  const excluded = projection.without ?? []

  if (selected.length === 0 && excluded.length === 0) return document

  const stripped = excluded.length > 0 ? withoutKeys([...excluded])(document) : document
  if (selected.length === 0) return stripped as T

  const projected = withKeys([...selected])(stripped)
  if (guaranteed.length === 0) return projected as T

  return {
    ...projected,
    ...withKeys([...guaranteed])(document)
  } as T
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
 * Ensure result is an array
 */
export const ensureArray = <T>(value: T) => {
  return (Array.isArray(value) ? value : isNullish(value) ? [] : [value]) as T extends Array<unknown> ? T : T[]
}

export const LOGICAL_QUERY_OPERATORS = new Set(['$and', '$or', '$not'])

export const PUBLIC_QUERY_OPERATORS = [
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
  '$prefix'
] as const

export const PROVIDER_QUERY_OPERATORS = [
  ...PUBLIC_QUERY_OPERATORS,
  '$regex',
  '$options'
] as const

/**
 * Comparison operators a provider can execute after public syntax has been
 * lowered to the query plan. `$options` is folded into the `$regex` operand
 * and is not advertised as a comparison capability. Logical `$not` lowers to
 * a structural plan node alongside `$and` and `$or`.
 */
export type ProviderCapabilityOperator = Exclude<(typeof PROVIDER_QUERY_OPERATORS)[number], '$options'>

export const PROVIDER_CAPABILITY_OPERATORS: readonly ProviderCapabilityOperator[] =
  PROVIDER_QUERY_OPERATORS.filter(
    (operator): operator is ProviderCapabilityOperator => operator !== '$options'
  )

const PROVIDER_CAPABILITY_OPERATOR_SET = new Set<string>(PROVIDER_CAPABILITY_OPERATORS)

export const isProviderCapabilityOperatorList = (value: unknown): value is readonly ProviderCapabilityOperator[] =>
  Array.isArray(value) &&
  value.every(operator => typeof operator === 'string' && PROVIDER_CAPABILITY_OPERATOR_SET.has(operator)) &&
  new Set(value).size === value.length

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
      !PROVIDER_QUERY_OPERATORS.includes(key as typeof PROVIDER_QUERY_OPERATORS[number]) &&
      !extraOperators.includes(key)
    ) {
      return key
    }

    const unsupported = findUnsupportedQueryOperator(nested, extraOperators)
    if (unsupported) return unsupported
  }
}

export const findUnsupportedPublicQueryOperator = (value: unknown): string | undefined => {
  const providerOnlyOperators = PROVIDER_QUERY_OPERATORS.filter(operator =>
    !PUBLIC_QUERY_OPERATORS.includes(operator as typeof PUBLIC_QUERY_OPERATORS[number])
  )
  const unsupportedProviderOperator = findUnsupportedQueryOperator(value)
  if (unsupportedProviderOperator) return unsupportedProviderOperator

  const findProviderOnly = (candidate: unknown): string | undefined => {
    if (!candidate || candidate instanceof RegExp || candidate instanceof Date) return undefined
    if (Array.isArray(candidate)) return candidate.map(findProviderOnly).find(Boolean)
    if (!isQueryOperatorRecord(candidate)) return undefined
    for (const [key, nested] of Object.entries(candidate)) {
      if (providerOnlyOperators.includes(key as typeof providerOnlyOperators[number])) return key
      const found = findProviderOnly(nested)
      if (found) return found
    }
  }

  return findProviderOnly(value)
}

export const assertSupportedQueryOperators = (value: unknown, extraOperators: readonly string[] = []): void => {
  const unsupported = findUnsupportedQueryOperator(value, extraOperators)
  if (unsupported) {
    throw new TypeError(`Unsupported content query operator: ${unsupported}`)
  }
}
