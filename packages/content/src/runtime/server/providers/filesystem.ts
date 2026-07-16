import type { H3Event } from 'h3'
import type { NavItem, ParsedContent } from '../../../types/content'
import type {
  ContentProvider,
  ContentProviderNavigationItem,
  ContentProviderSurroundItem,
  ContentRouteRecord,
  ProviderDocumentInput
} from '../../../public/provider'
import { PROVIDER_QUERY_OPERATORS } from '../../../core/query/operators'
import {
  longestMountForPath,
  normalizeContentPath,
  normalizeRouteMounts,
  routeRemainder,
  stripLocalePrefix
} from '../../../core/content/path'
import { projectContentRoute } from '../../../features/localization/route-projector'
import {
  markCollectionNavigationRoot,
  scopeNavigationTree,
  type CanonicalNavigationItem
} from '../../../features/navigation/canonical'
import { buildContentResult } from '../../../integrations/nitro/build'
import { executeFilesystemContentQuery } from '../query-executor'
import { resolveContentNavigation } from '../navigation-query'
import { queryFilesystemCollectionItemSurroundings } from '../collection-helpers'
import { getContentRuntimeConfig } from '../runtime-config'

const providerContentPath = (collection: string, locale: string, contentPath: string) => {
  const config = getContentRuntimeConfig().content || {}
  const collectionConfig = config.collections?.[collection]
  const collectionI18n = collectionConfig?.i18n && typeof collectionConfig.i18n === 'object'
    ? collectionConfig.i18n
    : undefined
  const locales = collectionI18n?.locales?.length ? collectionI18n.locales : (config.locales || [])
  const routeMounts = normalizeRouteMounts(collectionConfig?.route, locales, collectionI18n?.defaultLocale || config.defaultLocale)
  const normalizedPath = normalizeContentPath(contentPath)
  const sourceMount = longestMountForPath(normalizedPath, routeMounts || {})
  const mountAgnosticPath = sourceMount
    ? routeRemainder(normalizedPath, sourceMount[1])
    : normalizedPath
  return projectContentRoute({ contentPath: mountAgnosticPath, locale }, {
    localized: locales.length > 0,
    locales,
    // Provider facts stop before the application locale prefix, so treating
    // the concrete locale as default here applies its mount without prefixing.
    defaultLocale: locale,
    fallback: {},
    translatedSlugs: false,
    routeMounts: routeMounts || {}
  })
}

const toVariantFacts = (document: ParsedContent) => {
  const variantPaths = document.resolved?.variantPaths
  if (variantPaths) {
    return Object.entries(variantPaths).map(([locale, contentPath]) => ({
      locale,
      contentPath: providerContentPath(document.collection || '', locale, contentPath)
    }))
  }
  const locale = document.locale || ''
  return [{ locale, contentPath: providerContentPath(document.collection || '', locale, document.path || '/') }]
}

/** Convert an internal filesystem document into the same raw seam third-party providers use. */
const toProviderDocument = (document: ParsedContent): ProviderDocumentInput => {
  const { path, resolved, route, resolution, ...data } = document as ParsedContent & Record<string, unknown>
  void route
  void resolution
  return {
    ...data,
    id: document.id,
    collection: document.collection || '',
    canonicalKey: document.canonicalKey || '',
    locale: document.locale || '',
    contentPath: providerContentPath(document.collection || '', document.locale || '', path || '/'),
    routeVariants: toVariantFacts(document),
    type: document.type,
    body: document.body ?? null,
    // Reference resolution runs before the filesystem document crosses the
    // provider seam. Preserve its canonical public carrier instead of
    // dropping it with the rest of the legacy internal `resolved` metadata.
    ...(resolved?.resolvedRefs ? { resolvedRefs: resolved.resolvedRefs } : {}),
    ...(document.file ? { file: document.file } : {})
  }
}

const mapQueryResult = <T>(response: Awaited<ReturnType<typeof executeFilesystemContentQuery<T>>>) => {
  if (typeof response.result === 'number') return response
  if (Array.isArray(response.result)) {
    return { ...response, result: response.result.map(item => toProviderDocument(item as ParsedContent)) }
  }
  return {
    ...response,
    result: response.result ? toProviderDocument(response.result as unknown as ParsedContent) : response.result
  }
}

const routeFactFromCanonicalNavigationItem = (collection: string, item: CanonicalNavigationItem) => {
  if (item.page === false || item.navigationKind === 'folder') return undefined
  const contentPath = typeof item.navigationPath === 'string' ? item.navigationPath : item.path
  if (!contentPath || !item.canonicalKey || !item.locale) return undefined
  const itemCollection = typeof item.collection === 'string' ? item.collection : ''
  const resolvedCollection = collection || itemCollection
  if (!resolvedCollection) return undefined
  return {
    collection: resolvedCollection,
    canonicalKey: item.canonicalKey,
    locale: item.locale,
    contentPath
  }
}

const routeFactFromNavItem = (collection: string, item: NavItem) => {
  if (!item.path || !item.canonicalKey || !item.locale) return undefined
  const itemCollection = typeof item.collection === 'string' ? item.collection : ''
  const resolvedCollection = collection || itemCollection
  if (!resolvedCollection) return undefined
  const config = getContentRuntimeConfig().content || {}
  const contentPath = stripLocalePrefix(item.path, config.locales || [], config.defaultLocale, item.locale).path
  return {
    collection: resolvedCollection,
    canonicalKey: item.canonicalKey,
    locale: item.locale,
    contentPath
  }
}

const toProviderNavigation = (collection: string, items: CanonicalNavigationItem[]): ContentProviderNavigationItem[] =>
  items.map((item) => {
    const {
      path,
      unprefixedPath,
      variants,
      localePaths,
      resolved,
      children,
      file,
      stem,
      navigationKind,
      navigationPath,
      _collectionRoot,
      ...fields
    } = item
    void path
    void unprefixedPath
    void variants
    void localePaths
    void resolved
    void file
    void stem
    void navigationKind
    void navigationPath
    void _collectionRoot
    const route = routeFactFromCanonicalNavigationItem(collection, item)
    return {
      ...fields,
      title: String(item.title || ''),
      ...(route ? { route } : {}),
      ...(children?.length ? { children: toProviderNavigation(collection, children) } : {})
    }
  })

const toProviderSurround = (collection: string, items: Array<NavItem | null>): Array<ContentProviderSurroundItem | null> =>
  items.map((item) => {
    if (!item) return null
    const route = routeFactFromNavItem(collection, item)
    if (!route) return null
    const { path, unprefixedPath, variants, localePaths, resolved, ...fields } = item as NavItem & Record<string, unknown>
    void path
    void unprefixedPath
    void variants
    void localePaths
    void resolved
    return { ...fields, title: String(item.title || ''), route }
  })

export const filesystemProvider: ContentProvider = {
  name: 'filesystem',
  capabilities: {
    query: {
      operators: [
        ...PROVIDER_QUERY_OPERATORS.filter(operator => operator !== '$options'),
        '$and',
        '$or'
      ],
      pagination: ['offset', 'cursor']
    }
  },
  query: async <T = ParsedContent>(event: H3Event, query: import('../../../public/provider').ContentProviderQuery) => {
    const plan = {
      ...query.plan,
      projection: {
        only: query.plan.projection.only.length
          ? [...new Set([
              ...query.plan.projection.only,
              'id', 'collection', 'canonicalKey', 'locale', 'path', 'resolved',
              'type', 'body', 'file'
            ])]
          : [],
        without: query.plan.projection.only.length ? [] : query.plan.projection.without
      }
    }
    return mapQueryResult(await executeFilesystemContentQuery<T>(event, plan)) as unknown as import('../../../types/api').ContentQueryResponse<T>
  },
  navigation: async (event, query, options) => {
    const collection = query.collection || ''
    const config = getContentRuntimeConfig().content || {}
    const collectionI18n = collection ? config.collections?.[collection]?.i18n : undefined
    const locales = collectionI18n && typeof collectionI18n === 'object' && collectionI18n.locales?.length
      ? collectionI18n.locales
      : (config.locales || [])
    const defaultLocale = collectionI18n && typeof collectionI18n === 'object'
      ? collectionI18n.defaultLocale || config.defaultLocale
      : config.defaultLocale
    const routeMounts = normalizeRouteMounts(config.collections?.[collection]?.route, locales, defaultLocale)
    const canonical = await resolveContentNavigation(event, query, options)
    const scoped = scopeNavigationTree(
      markCollectionNavigationRoot(canonical, collection, { routeMounts }),
      collection
    )
    return toProviderNavigation(collection, scoped)
  },
  surroundings: async (event, collection, contentPath, options) =>
    toProviderSurround(collection, await queryFilesystemCollectionItemSurroundings(event, collection, contentPath, {
      locale: options?.locale
    })),
  routes: async (event): Promise<ContentRouteRecord[]> => {
    const result = await buildContentResult(event)
    const config = getContentRuntimeConfig().content || {}
    return result.routes.map(route => ({
      collection: route.collection,
      canonicalKey: route.canonicalKey,
      locale: route.locale,
      contentPath: normalizeContentPath(
        stripLocalePrefix(route.path, config.locales || [], config.defaultLocale, route.locale).path
      ),
      ...(route.draft ? { draft: true } : {}),
      ...(route.sitemap ? (route.sitemapMetadata ? { sitemap: route.sitemapMetadata } : {}) : { sitemap: false })
    }))
  }
}
