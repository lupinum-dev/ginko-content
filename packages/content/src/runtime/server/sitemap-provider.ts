import type { H3Event } from 'h3'
import { getRequestURL } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import type { ContentSitemapEntry } from '../../types/query'
import type { QueryCollectionsSitemapEntriesOptions } from '../../features/sitemap/query'
import { projectSitemapEntry } from '../../features/sitemap/query'
import { resolveIncludeDrafts, resolveRuntimeEnvironment } from '../../core/visibility'
import { createContentProviderError } from '../../public/provider-errors'
import { getContentProvider } from './providers'
import { getContentRuntimeConfig } from './runtime-config'
import { normalizeProviderRoutes, projectProviderRouteFact } from './provider-route-facts'

const withoutTrailingSlash = (value: string) => value.replace(/\/$/, '')

const localeLanguageMap = (event: H3Event): Record<string, string> => {
  const runtime = useRuntimeConfig(event) as unknown as {
    public?: { i18n?: { locales?: Array<string | { code?: string, language?: string }> } }
  }
  return Object.fromEntries((runtime.public?.i18n?.locales || []).flatMap((locale) => {
    if (typeof locale === 'string') return [[locale, locale]]
    return locale.code ? [[locale.code, locale.language || locale.code]] : []
  }))
}

const resolveSiteUrl = (event: H3Event, explicit?: string) => {
  if (explicit) return withoutTrailingSlash(explicit)
  const runtime = useRuntimeConfig(event) as unknown as {
    public?: { content?: { siteUrl?: string }, siteUrl?: string }
  }
  const configured = runtime.public?.content?.siteUrl || runtime.public?.siteUrl
  if (configured) return withoutTrailingSlash(configured)
  if (resolveRuntimeEnvironment() === 'development') {
    const url = getRequestURL(event)
    return `${url.protocol}//${url.host}`
  }
  throw new Error('Content sitemap generation requires site.url or runtimeConfig.public.content.siteUrl in production.')
}

/** Build final sitemap entries from provider route facts. Providers never receive consumer policy. */
export async function queryCollectionsSitemapEntries (
  event: H3Event,
  options: QueryCollectionsSitemapEntriesOptions = {}
): Promise<ContentSitemapEntry[]> {
  const provider = await getContentProvider(event)
  if (!provider.routes) {
    throw createContentProviderError('unsupported_provider_operation', `${provider.name} does not support route enumeration.`, {
      provider: provider.name,
      operation: 'routes'
    })
  }

  const runtime = getContentRuntimeConfig().content
  const include = options.include?.length ? new Set(options.include) : undefined
  const exclude = new Set(options.exclude || [])
  const includeDrafts = resolveIncludeDrafts({
    environment: resolveRuntimeEnvironment(),
    includeDrafts: options.includeDrafts
  })
  const routes = normalizeProviderRoutes(await provider.routes(event), provider.name)
    .filter(route => (!include || include.has(route.collection)) && !exclude.has(route.collection))
    .filter(route => runtime.collections?.[route.collection]?.type !== 'data')
    .filter(route => includeDrafts || !route.draft)
    .filter(route => route.sitemap !== false)

  const siteUrl = resolveSiteUrl(event, options.siteUrl)
  const localeToLanguage = localeLanguageMap(event)
  const byCanonical = new Map<string, typeof routes>()
  for (const route of routes) {
    const key = `${route.collection}:${route.canonicalKey}`
    const group = byCanonical.get(key) || []
    group.push(route)
    byCanonical.set(key, group)
  }

  return routes.map((route) => {
    const variants = byCanonical.get(`${route.collection}:${route.canonicalKey}`) || []
    const projectedVariants = variants.map(variant => ({
      locale: variant.locale,
      path: projectProviderRouteFact(variant, runtime)
    }))
    const variant = {
      locale: route.locale,
      path: projectProviderRouteFact(route, runtime)
    }
    const collectionI18n = runtime.collections?.[route.collection]?.i18n
    const defaultLocale =
      collectionI18n && typeof collectionI18n === 'object'
        ? collectionI18n.defaultLocale || runtime.defaultLocale || route.locale
        : runtime.defaultLocale || route.locale
    const metadata = route.sitemap && typeof route.sitemap === 'object' ? route.sitemap : undefined
    return projectSitemapEntry({
      siteUrl,
      defaultLocale,
      localeToLanguage,
      variant,
      variants: projectedVariants,
      lastmod: metadata?.lastmod,
      images: metadata?.images?.length ? [...metadata.images] : undefined
    })
  })
}
