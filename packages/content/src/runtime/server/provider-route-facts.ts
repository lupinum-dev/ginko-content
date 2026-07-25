import type {
  ContentProviderRouteFact,
  ContentRouteRecord
} from '../../public/provider'
import type { ContentSearchResult } from '../../types/search'
import {
  projectContentRoute,
  RouteProjectionError,
  unmountProviderContentPath
} from '../../features/localization/route-projector'
import { resolveRuntimeCollectionLocalePolicy } from '../../features/localization/config'
import type { RuntimeContentConfig } from '../../features/query/context'
import { createContentProviderError } from '../../public/provider-errors'
import { collectJsonPurityViolations } from '../../core/json-value'
import {
  CONTENT_ROUTE_LIMITS,
  ContentRouteRecordValidationError,
  normalizeRawContentRouteRecord,
  normalizeRawProviderRouteFact,
} from '../../core/provider-route-record'

const forbiddenProjectedKeys = ['path', 'href', 'localePath', 'alternates'] as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const fail = (provider: string, operation: string, field: string, message: string): never => {
  throw createContentProviderError('provider_result_invalid', `${provider} ${message}`, {
    provider,
    operation,
    field
  })
}

const assertNoProjectedKeys = (value: Record<string, unknown>, provider: string, operation: string, field: string) => {
  const key = forbiddenProjectedKeys.find(candidate => candidate in value)
  if (key) {
    fail(provider, operation, `${field}.${key}`, `returned preprojected route field "${key}". Providers must return a raw route fact instead.`)
  }
}

const assertJsonPureProviderValue = (value: unknown, provider: string, operation: string, field: string) => {
  const violation = collectJsonPurityViolations(value)[0]
  if (!violation) return
  const suffix = violation.path === '$' ? '' : violation.path.slice(1)
  fail(provider, operation, `${field}${suffix}`, `returned a non-JSON value that ${violation.reason}.`)
}

const assertRuntimeProviderRouteFact = (
  route: ContentProviderRouteFact,
  provider: string,
  operation: string,
  field: string,
  runtime?: RuntimeContentConfig
): ContentProviderRouteFact => {
  if (runtime?.collections) {
    if (!Object.prototype.hasOwnProperty.call(runtime.collections, route.collection)) {
      fail(provider, operation, `${field}.collection`, 'returned a route fact for an unknown collection.')
    }
    const localePolicy = resolveRuntimeCollectionLocalePolicy(route.collection, runtime)
    if (!localePolicy) {
      return fail(provider, operation, `${field}.collection`, 'has no resolved locale policy.')
    }
    const allowedLocales = localePolicy.localized
      ? localePolicy.locales
      : [localePolicy.defaultLocale]
    if (!allowedLocales.includes(route.locale)) {
      fail(provider, operation, `${field}.locale`, 'returned a route fact outside the configured collection locales.')
    }
  }
  return route
}

export const normalizeProviderRouteFact = (
  value: unknown,
  provider: string,
  operation: string,
  field = 'route',
  runtime?: RuntimeContentConfig
): ContentProviderRouteFact => {
  try {
    return assertRuntimeProviderRouteFact(
      normalizeRawProviderRouteFact(value, field),
      provider,
      operation,
      field,
      runtime
    )
  } catch (error) {
    if (error instanceof ContentRouteRecordValidationError) {
      return fail(provider, operation, error.field, error.message)
    }
    throw error
  }
}

export const projectProviderRouteFact = (
  fact: ContentProviderRouteFact,
  runtime: RuntimeContentConfig,
  targetLocale = fact.locale
): string => {
  const targetPolicy = resolveRuntimeCollectionLocalePolicy(fact.collection, runtime)
  if (!targetPolicy) {
    throw createContentProviderError(
      'unsupported_query_shape',
      'Content collection locale policy is missing from runtime config.',
      { collection: fact.collection, field: 'localePolicy' }
    )
  }
  if (targetPolicy.localized && !targetPolicy.locales.includes(targetLocale)) {
    throw createContentProviderError(
      'unsupported_query_shape',
      'Requested content locale is not configured for the selected collection.',
      { collection: fact.collection, field: 'locale' }
    )
  }
  try {
    const contentPath = unmountProviderContentPath(fact.contentPath, fact.locale, targetPolicy)
    return projectContentRoute({ contentPath, locale: targetLocale }, targetPolicy)
  }
  catch (error) {
    if (!(error instanceof RouteProjectionError)) throw error
    throw createContentProviderError(
      'provider_result_invalid',
      error.message,
      { collection: fact.collection, operation: 'route', field: 'contentPath' },
      error
    )
  }
}

export const projectProviderNavigation = (
  value: unknown,
  provider: string,
  runtime: RuntimeContentConfig,
  requestedLocale?: string,
  requestedCollection?: string
): Array<Record<string, unknown>> => {
  if (!Array.isArray(value)) {
    return fail(provider, 'navigation', 'result', 'returned a non-array navigation result.')
  }
  assertJsonPureProviderValue(value, provider, 'navigation', 'result')

  const visit = (item: unknown, indexPath: string): Record<string, unknown> => {
    if (!isRecord(item) || typeof item.title !== 'string') {
      return fail(provider, 'navigation', indexPath, 'returned an invalid navigation item.')
    }
    assertNoProjectedKeys(item, provider, 'navigation', indexPath)
    const { route: rawRoute, children: rawChildren, ...fields } = item
    const route = rawRoute === undefined
      ? undefined
      : normalizeProviderRouteFact(rawRoute, provider, 'navigation', `${indexPath}.route`, runtime)
    if (route && requestedCollection && route.collection !== requestedCollection) {
      fail(provider, 'navigation', `${indexPath}.route.collection`, 'returned a route fact outside the requested collection.')
    }
    const children = rawChildren === undefined
      ? undefined
      : Array.isArray(rawChildren)
        ? rawChildren.map((child, index) => visit(child, `${indexPath}.children[${index}]`))
        : fail(provider, 'navigation', `${indexPath}.children`, 'returned non-array navigation children.')

    return {
      ...fields,
      ...(route ? { path: projectProviderRouteFact(route, runtime, requestedLocale || route.locale) } : {}),
      ...(children?.length ? { children } : {})
    }
  }

  return value.map((item, index) => visit(item, `result[${index}]`))
}

export const projectProviderSurroundings = (
  value: unknown,
  provider: string,
  runtime: RuntimeContentConfig,
  requestedCollection?: string
): Array<Record<string, unknown> | null> => {
  if (!Array.isArray(value)) {
    return fail(provider, 'surroundings', 'result', 'returned a non-array surroundings result.')
  }
  assertJsonPureProviderValue(value, provider, 'surroundings', 'result')
  return value.map((item, index) => {
    if (item === null) return null
    if (!isRecord(item) || typeof item.title !== 'string') {
      return fail(provider, 'surroundings', `result[${index}]`, 'returned an invalid surroundings item.')
    }
    assertNoProjectedKeys(item, provider, 'surroundings', `result[${index}]`)
    const { route: rawRoute, ...fields } = item
    const route = normalizeProviderRouteFact(rawRoute, provider, 'surroundings', `result[${index}].route`, runtime)
    if (requestedCollection && route.collection !== requestedCollection) {
      fail(provider, 'surroundings', `result[${index}].route.collection`, 'returned a route fact outside the requested collection.')
    }
    return { ...fields, path: projectProviderRouteFact(route, runtime) }
  })
}

export const projectProviderSearchResults = (
  value: unknown,
  provider: string,
  runtime: RuntimeContentConfig,
  allowedCollections?: readonly string[]
): ContentSearchResult[] => {
  if (!Array.isArray(value)) {
    return fail(provider, 'search', 'result', 'returned a non-array search result.')
  }
  assertJsonPureProviderValue(value, provider, 'search', 'result')

  return value.map((item, index) => {
    const field = `result[${index}]`
    if (
      !isRecord(item) ||
      typeof item.title !== 'string' ||
      typeof item.score !== 'number' ||
      !Number.isFinite(item.score) ||
      (item.excerpt !== undefined && typeof item.excerpt !== 'string')
    ) {
      return fail(provider, 'search', field, 'returned an invalid search result.')
    }
    assertNoProjectedKeys(item, provider, 'search', field)
    const { route: rawRoute, ...fields } = item
    const route = normalizeProviderRouteFact(rawRoute, provider, 'search', `${field}.route`, runtime)
    if (allowedCollections && !allowedCollections.includes(route.collection)) {
      fail(provider, 'search', `${field}.route.collection`, 'returned a route fact outside the configured search collections.')
    }
    return {
      ...fields,
      collection: route.collection,
      path: projectProviderRouteFact(route, runtime),
      locale: route.locale,
      title: item.title,
      excerpt: item.excerpt || '',
      score: item.score
    }
  })
}

export const normalizeProviderRoutes = (
  value: unknown,
  provider: string,
  runtime?: RuntimeContentConfig
): ContentRouteRecord[] => {
  if (!Array.isArray(value)) {
    return fail(provider, 'routes', 'result', 'returned a non-array routes result.')
  }
  assertJsonPureProviderValue(value, provider, 'routes', 'result')
  let totalBytes = 2
  const routes = value.map((entry, index) => {
    const field = `result[${index}]`
    try {
      const { record, serializedBytes } = normalizeRawContentRouteRecord(entry, field)
      totalBytes += serializedBytes + (index === 0 ? 0 : 1)
      if (totalBytes > CONTENT_ROUTE_LIMITS.maxTotalRouteBytes) {
        return fail(provider, 'routes', field, 'returned route records that exceed the aggregate byte limit.')
      }
      assertRuntimeProviderRouteFact(record, provider, 'routes', field, runtime)
      return record
    } catch (error) {
      if (error instanceof ContentRouteRecordValidationError) {
        return fail(provider, 'routes', error.field, error.message)
      }
      throw error
    }
  })

  const identities = new Set<string>()
  const paths = new Set<string>()
  for (const [index, route] of routes.entries()) {
    const identity = `${route.collection}\0${route.canonicalKey}\0${route.locale}`
    if (identities.has(identity)) {
      fail(provider, 'routes', `result[${index}]`, 'returned duplicate canonical route identity.')
    }
    identities.add(identity)

    const path = `${route.collection}\0${route.locale}\0${route.contentPath}`
    if (paths.has(path)) {
      fail(provider, 'routes', `result[${index}].contentPath`, 'returned a route path owned by more than one canonical identity.')
    }
    paths.add(path)
  }

  return routes
}
