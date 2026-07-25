import type { H3Event } from 'h3'
import type { NavItem, ParsedContent } from '../../../types/content'
import type { ContentQueryFindResponse, ContentQueryResponse } from '../../../types/api'
import type {
  ContentProvider,
  ContentProviderNavigationItem,
  ContentProviderSurroundItem,
  ContentRouteRecord,
  ProviderDocumentInput
} from '../../../public/provider'
import { PROVIDER_CAPABILITY_OPERATORS } from '../../../core/query/operators'
import {
  normalizeContentPath
} from '../../../core/content/path'
import {
  mountProviderContentPath
} from '../../../features/localization/route-projector'
import { resolveRuntimeCollectionLocalePolicy } from '../../../features/localization/config'
import type { CanonicalNavigationItem } from '../../../features/navigation/canonical'
import { buildContentResult } from '../../../integrations/nitro/build'
import { executeFilesystemContentQuery } from '../query-executor'
import { resolveContentNavigation } from '../navigation-query'
import { queryFilesystemCollectionItemSurroundings } from '../collection-helpers'
import { getContentRuntimeConfig } from '../runtime-config'
import { fromContentProviderQueryPlan } from '../../../features/query/query-plan-boundary'

const providerContentPath = (collection: string, locale: string, contentPath: string) => {
  const config = getContentRuntimeConfig().content || {}
  const localePolicy = resolveRuntimeCollectionLocalePolicy(collection, config)
  if (!localePolicy) {
    throw new Error(`Missing runtime locale policy for content collection "${collection}".`)
  }
  return mountProviderContentPath({
    contentPath: normalizeContentPath(contentPath),
    locale
  }, localePolicy)
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
  const { path, resolved, route, resolution, dir, variants, localePaths, unprefixedPath, ...data } = document as ParsedContent & Record<string, unknown>
  void route
  void resolution
  void dir
  void variants
  void localePaths
  void unprefixedPath
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
    // provider seam, so preserve its canonical public carrier here.
    ...(resolved?.resolvedRefs ? { resolvedRefs: resolved.resolvedRefs } : {}),
    ...(document.file ? { file: document.file } : {})
  }
}

const mapQueryResult = (response: ContentQueryResponse<ParsedContent>): ContentQueryResponse<ProviderDocumentInput> => {
  if (typeof response.result === 'number') return { result: response.result }
  if (Array.isArray(response.result)) {
    const list = response as ContentQueryFindResponse<ParsedContent>
    const result = response.result.map(toProviderDocument)
    return list.mode === 'cursor'
      ? { mode: 'cursor', result, limit: list.limit, pageInfo: list.pageInfo }
      : {
          ...(list.mode === 'offset' ? { mode: 'offset' as const } : {}),
          result,
          skip: list.skip,
          limit: list.limit,
          total: list.total,
        }
  }
  return { result: response.result ? toProviderDocument(response.result) : undefined }
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
    contentPath: providerContentPath(resolvedCollection, item.locale, contentPath)
  }
}

const routeFactFromNavItem = (collection: string, item: NavItem) => {
  if (typeof item.unprefixedPath !== 'string' || !item.canonicalKey || !item.locale) return undefined
  const itemCollection = typeof item.collection === 'string' ? item.collection : ''
  const resolvedCollection = collection || itemCollection
  if (!resolvedCollection) return undefined
  return {
    collection: resolvedCollection,
    canonicalKey: item.canonicalKey,
    locale: item.locale,
    contentPath: providerContentPath(resolvedCollection, item.locale, item.unprefixedPath)
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
        ...PROVIDER_CAPABILITY_OPERATORS
      ],
      pagination: ['offset', 'cursor']
    }
  },
  query: async (event: H3Event, query: import('../../../public/provider').ContentProviderQuery) => {
    const config = getContentRuntimeConfig().content || {}
    const policy = query.collection
      ? resolveRuntimeCollectionLocalePolicy(query.collection, config)
      : undefined
    const canonicalPlan = fromContentProviderQueryPlan(query.plan, policy)
    const plan = {
      ...canonicalPlan,
      // Provider documents must cross the seam with their complete identity
      // and route facts. The canonical response shaper applies the caller's
      // `only`/`without` projection after normalization.
      projection: { only: [], without: [] }
    }
    return mapQueryResult(await executeFilesystemContentQuery<ParsedContent>(event, plan))
  },
  navigation: async (event, query) => {
    const collection = query.collection
    if (!collection) {
      throw new Error('Filesystem navigation requires a named content collection.')
    }
    const config = getContentRuntimeConfig().content || {}
    const localePolicy = resolveRuntimeCollectionLocalePolicy(collection, config)
    if (!localePolicy) {
      throw new Error(`Missing runtime locale policy for content collection "${collection}".`)
    }
    const canonicalPlan = fromContentProviderQueryPlan(query.plan, localePolicy)
    const canonical = await resolveContentNavigation(event, {
      collection,
      plan: canonicalPlan
    })
    return toProviderNavigation(collection, canonical)
  },
  surroundings: async (event, collection, contentPath, options) =>
    toProviderSurround(collection, await queryFilesystemCollectionItemSurroundings(event, collection, contentPath, {
      locale: options?.locale
    })),
  routes: async (event): Promise<ContentRouteRecord[]> => {
    const result = await buildContentResult(event)
    const config = getContentRuntimeConfig().content || {}
    return result.routes.map((route) => {
      const localePolicy = resolveRuntimeCollectionLocalePolicy(route.collection, config)
      if (!localePolicy) {
        throw new Error(`Missing runtime locale policy for content collection "${route.collection}".`)
      }
      return {
        collection: route.collection,
        canonicalKey: route.canonicalKey,
        locale: route.locale,
        contentPath: mountProviderContentPath({
          contentPath: route.contentPath,
          locale: route.locale
        }, localePolicy),
        ...(route.draft ? { draft: true } : {}),
        ...(route.sitemap ? (route.sitemapMetadata ? { sitemap: route.sitemapMetadata } : {}) : { sitemap: false })
      }
    })
  }
}
