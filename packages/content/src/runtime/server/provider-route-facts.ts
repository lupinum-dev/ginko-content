import type {
  ContentProviderRouteFact,
  ContentProviderSearchResult,
  ContentRouteRecord
} from '../../public/provider'
import type { ContentSearchResult } from '../../types/search'
import {
  longestMountForPath,
  normalizeContentPath,
  normalizeRouteMounts,
  routeRemainder
} from '../../core/content/path'
import { projectContentRoute } from '../../features/localization/route-projector'
import type { RuntimeContentConfig } from '../../features/query/context'
import { createContentProviderError } from '../../public/provider-errors'

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

const normalizeProviderContentPath = (
  value: string,
  provider: string,
  operation: string,
  field: string,
) => {
  const hasControlCharacter = [...value].some((character) => {
    const code = character.codePointAt(0)!
    return code <= 31 || code === 127
  })
  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    value.includes('?') ||
    value.includes('#') ||
    /[\s"<>]/u.test(value) ||
    hasControlCharacter
  ) {
    return fail(provider, operation, field, 'returned contentPath outside the leading-slash, site-relative content route contract.')
  }

  try {
    const parsed = new URL(value, 'https://ginko.invalid')
    const sourcePreserved = parsed.pathname === value || decodeURI(parsed.pathname) === value
    if (parsed.origin !== 'https://ginko.invalid' || !sourcePreserved) {
      return fail(provider, operation, field, 'returned contentPath outside the leading-slash, site-relative content route contract.')
    }
  } catch {
    return fail(provider, operation, field, 'returned contentPath outside the leading-slash, site-relative content route contract.')
  }

  return normalizeContentPath(value)
}

export const normalizeProviderRouteFact = (
  value: unknown,
  provider: string,
  operation: string,
  field = 'route'
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

  return {
    collection: String(value.collection),
    canonicalKey: String(value.canonicalKey),
    locale: String(value.locale),
    contentPath
  }
}

export const projectProviderRouteFact = (
  fact: ContentProviderRouteFact,
  runtime: RuntimeContentConfig,
  targetLocale = fact.locale
): string => {
  const collection = runtime.collections?.[fact.collection]
  const collectionI18n = collection?.i18n && typeof collection.i18n === 'object' ? collection.i18n : undefined
  const locales = collectionI18n?.locales?.length ? collectionI18n.locales : (runtime.locales || [])
  const defaultLocale = collectionI18n?.defaultLocale || runtime.defaultLocale
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
  requestedLocale?: string
): Array<Record<string, unknown>> => {
  if (!Array.isArray(value)) {
    return fail(provider, 'navigation', 'result', 'returned a non-array navigation result.')
  }

  const visit = (item: unknown, indexPath: string): Record<string, unknown> => {
    if (!isRecord(item) || typeof item.title !== 'string') {
      return fail(provider, 'navigation', indexPath, 'returned an invalid navigation item.')
    }
    assertNoProjectedKeys(item, provider, 'navigation', indexPath)
    const { route: rawRoute, children: rawChildren, ...fields } = item
    const route = rawRoute === undefined
      ? undefined
      : normalizeProviderRouteFact(rawRoute, provider, 'navigation', `${indexPath}.route`)
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
  runtime: RuntimeContentConfig
): Array<Record<string, unknown> | null> => {
  if (!Array.isArray(value)) {
    return fail(provider, 'surroundings', 'result', 'returned a non-array surroundings result.')
  }
  return value.map((item, index) => {
    if (item === null) return null
    if (!isRecord(item) || typeof item.title !== 'string') {
      return fail(provider, 'surroundings', `result[${index}]`, 'returned an invalid surroundings item.')
    }
    assertNoProjectedKeys(item, provider, 'surroundings', `result[${index}]`)
    const { route: rawRoute, ...fields } = item
    const route = normalizeProviderRouteFact(rawRoute, provider, 'surroundings', `result[${index}].route`)
    return { ...fields, path: projectProviderRouteFact(route, runtime) }
  })
}

export const projectProviderSearchResults = (
  value: readonly ContentProviderSearchResult[],
  provider: string,
  runtime: RuntimeContentConfig
): ContentSearchResult[] => value.map((item, index) => {
  if (!isRecord(item)) {
    fail(provider, 'search', `result[${index}]`, 'returned an invalid search result.')
  }
  assertNoProjectedKeys(item, provider, 'search', `result[${index}]`)
  const { route: rawRoute, ...fields } = item
  const route = normalizeProviderRouteFact(rawRoute, provider, 'search', `result[${index}].route`)
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

export const normalizeProviderRoutes = (value: unknown, provider: string): ContentRouteRecord[] => {
  if (!Array.isArray(value)) {
    return fail(provider, 'routes', 'result', 'returned a non-array routes result.')
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      return fail(provider, 'routes', `result[${index}]`, 'returned an invalid route record.')
    }
    const route = normalizeProviderRouteFact(entry, provider, 'routes', `result[${index}]`)
    const sitemap = entry.sitemap
    if (sitemap !== undefined && sitemap !== false && !isRecord(sitemap)) {
      fail(provider, 'routes', `result[${index}].sitemap`, 'returned invalid sitemap metadata.')
    }
    if (isRecord(sitemap) && sitemap.lastmod !== undefined) {
      const normalized = new Date(String(sitemap.lastmod)).toISOString()
      if (normalized !== sitemap.lastmod) {
        fail(provider, 'routes', `result[${index}].sitemap.lastmod`, 'returned a lastmod value that is not a normalized UTC ISO string.')
      }
    }
    return {
      ...route,
      ...(entry.draft === true ? { draft: true } : {}),
      ...(sitemap === false ? { sitemap: false } : isRecord(sitemap) ? { sitemap } : {})
    } as ContentRouteRecord
  })
}
