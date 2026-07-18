import type {
  ContentProviderRouteFact,
  ContentRouteRecord
} from '../../public/provider'
import type { ContentSearchResult } from '../../types/search'
import {
  longestMountForPath,
  normalizeSiteRelativeContentPath,
  normalizeRouteMounts,
  routeRemainder
} from '../../core/content/path'
import { projectContentRoute } from '../../features/localization/route-projector'
import { resolveRuntimeCollectionI18nConfig } from '../../features/localization/config'
import type { RuntimeContentConfig } from '../../features/query/context'
import { createContentProviderError } from '../../public/provider-errors'
import { collectJsonPurityViolations } from '../../core/json-value'

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

const normalizeProviderContentPath = (
  value: string,
  provider: string,
  operation: string,
  field: string,
) => {
  try {
    return normalizeSiteRelativeContentPath(value)
  } catch {
    return fail(provider, operation, field, 'returned contentPath outside the leading-slash, site-relative content route contract.')
  }
}

export const normalizeProviderRouteFact = (
  value: unknown,
  provider: string,
  operation: string,
  field = 'route',
  runtime?: RuntimeContentConfig
): ContentProviderRouteFact => {
  if (!isRecord(value)) {
    return fail(provider, operation, field, 'returned an invalid route fact.')
  }
  assertNoProjectedKeys(value, provider, operation, field)

  for (const key of ['collection', 'canonicalKey', 'locale', 'contentPath'] as const) {
    if (typeof value[key] !== 'string' || !value[key]) {
      fail(provider, operation, `${field}.${key}`, `returned a route fact without a non-empty ${key}.`)
    }
  }
  const contentPath = normalizeProviderContentPath(
    String(value.contentPath),
    provider,
    operation,
    `${field}.contentPath`,
  )

  const route = {
    collection: String(value.collection),
    canonicalKey: String(value.canonicalKey),
    locale: String(value.locale),
    contentPath
  }

  if (runtime?.collections) {
    if (!Object.prototype.hasOwnProperty.call(runtime.collections, route.collection)) {
      fail(provider, operation, `${field}.collection`, 'returned a route fact for an unknown collection.')
    }
    const localePolicy = resolveRuntimeCollectionI18nConfig(route.collection, runtime)
    if (localePolicy && !localePolicy.locales.includes(route.locale)) {
      fail(provider, operation, `${field}.locale`, 'returned a route fact outside the configured collection locales.')
    }
  }

  return route
}

export const projectProviderRouteFact = (
  fact: ContentProviderRouteFact,
  runtime: RuntimeContentConfig,
  targetLocale = fact.locale
): string => {
  const targetPolicy = resolveRuntimeCollectionI18nConfig(fact.collection, runtime)
  if (targetPolicy && !targetPolicy.locales.includes(targetLocale)) {
    throw createContentProviderError(
      'unsupported_query_shape',
      'Requested content locale is not configured for the selected collection.',
      { collection: fact.collection, field: 'locale' }
    )
  }
  const collection = runtime.collections?.[fact.collection]
  const locales = targetPolicy?.locales || []
  const defaultLocale = targetPolicy?.defaultLocale
  const routeMounts = normalizeRouteMounts(collection?.route, locales, defaultLocale) || {}
  const sourceMount = longestMountForPath(fact.contentPath, routeMounts)
  const contentPath = sourceMount
    ? routeRemainder(fact.contentPath, sourceMount[1])
    : fact.contentPath

  return projectContentRoute({ contentPath, locale: targetLocale }, {
    localized: locales.length > 0,
    locales,
    defaultLocale,
    fallback: runtime.localeFallback || {},
    translatedSlugs: false,
    routeMounts
  })
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
  const routes = value.map((entry, index) => {
    if (!isRecord(entry)) {
      return fail(provider, 'routes', `result[${index}]`, 'returned an invalid route record.')
    }
    const route = normalizeProviderRouteFact(entry, provider, 'routes', `result[${index}]`, runtime)
    if (entry.draft !== undefined && typeof entry.draft !== 'boolean') {
      fail(provider, 'routes', `result[${index}].draft`, 'returned a non-boolean draft value.')
    }
    const sitemap = entry.sitemap
    if (sitemap !== undefined && sitemap !== false && !isRecord(sitemap)) {
      fail(provider, 'routes', `result[${index}].sitemap`, 'returned invalid sitemap metadata.')
    }
    if (isRecord(sitemap)) {
      const lastmod = sitemap.lastmod
      if (lastmod !== undefined) {
        if (typeof lastmod !== 'string' || Number.isNaN(Date.parse(lastmod))) {
          return fail(provider, 'routes', `result[${index}].sitemap.lastmod`, 'returned an invalid lastmod value.')
        }
        const normalized = new Date(lastmod).toISOString()
        if (normalized !== lastmod) {
          return fail(provider, 'routes', `result[${index}].sitemap.lastmod`, 'returned a lastmod value that is not a normalized UTC ISO string.')
        }
      }
      const images = sitemap.images
      if (images !== undefined) {
        if (!Array.isArray(images)) {
          return fail(provider, 'routes', `result[${index}].sitemap.images`, 'returned non-array sitemap images.')
        }
        for (const [imageIndex, image] of images.entries()) {
          if (!isRecord(image) || typeof image.loc !== 'string' || !image.loc) {
            return fail(provider, 'routes', `result[${index}].sitemap.images[${imageIndex}].loc`, 'returned a sitemap image without a non-empty loc string.')
          }
        }
      }
    }
    return {
      ...route,
      ...(entry.draft === true ? { draft: true } : {}),
      ...(sitemap === false ? { sitemap: false } : isRecord(sitemap) ? { sitemap } : {})
    } as ContentRouteRecord
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
