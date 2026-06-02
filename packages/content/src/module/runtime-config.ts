import { defu } from 'defu'
import type { Nuxt } from '@nuxt/schema'

import type { ContentContext, ModuleOptions } from '../types/module'
import type { ContentCollectionConfig } from '../types/config'
import type { ContentSearchPublicRuntimeConfig } from '../types/search'
import { CACHE_VERSION } from '../utils'
import { normalizeMiniSearchOptions } from './options'

const resolveNuxtSiteUrl = (nuxt: Nuxt) => {
  const publicRuntime = nuxt.options.runtimeConfig.public as Record<string, any>
  const configuredSiteUrl = publicRuntime.siteUrl
  if (typeof configuredSiteUrl === 'string' && configuredSiteUrl.length > 0) {
    return configuredSiteUrl
  }

  const nuxtSite = (nuxt.options as { site?: { url?: unknown } }).site
  return typeof nuxtSite?.url === 'string' && nuxtSite.url.length > 0
    ? nuxtSite.url
    : undefined
}

export const applyContentRuntimeConfig = (
  nuxt: Nuxt,
  options: ModuleOptions,
  contentContext: ContentContext,
  runtimeCollections: Record<string, { source?: ContentCollectionConfig['source'], exclude?: ContentCollectionConfig['exclude'], type?: ContentCollectionConfig['type'], strict: boolean, i18n?: { defaultLocale: string, locales: string[] }, sitemap?: boolean, route?: ContentCollectionConfig['route'] }>,
  buildIntegrity: number | undefined,
  cacheIntegrity: string
) => {
  const searchRuntime = contentContext.search === false
    ? false
    : {
        apiBaseURL: contentContext.search.apiBaseURL || `${options.api.baseURL.replace(/\/$/, '')}/search`,
        indexURL: `${(contentContext.search.apiBaseURL || `${options.api.baseURL.replace(/\/$/, '')}/search`).replace(/\/$/, '')}/index.json`,
        engine: contentContext.search.engine || 'minisearch',
        minisearch: normalizeMiniSearchOptions(contentContext.search.minisearch)
      } satisfies ContentSearchPublicRuntimeConfig
  const contentRuntime = defu(nuxt.options.runtimeConfig.public.content, {
    locales: contentContext.locales,
    provider: contentContext.provider || 'filesystem',
    providers: contentContext.providers || {},
    defaultLocale: contentContext.defaultLocale || undefined,
    localeFallback: contentContext.localeFallback || {},
    translatedSlugs: contentContext.translatedSlugs ?? false,
    strictTranslatedSlugs: contentContext.strictTranslatedSlugs ?? false,
    collections: runtimeCollections,
    integrity: buildIntegrity as number,
    experimental: {
      stripQueryParameters: options.experimental.stripQueryParameters
    },
    respectPathCase: options.respectPathCase ?? false,
    api: {
      baseURL: options.api.baseURL
    },
    markdown: {
      plugins: contentContext.markdown.plugins,
      tags: contentContext.markdown.tags,
      anchorLinks: contentContext.markdown.anchorLinks,
      image: contentContext.markdown.image || 'auto'
    },
    sitemap: contentContext.sitemap
      ? {
          path: contentContext.sitemap.path || '/sitemap',
          ...(contentContext.sitemap.include?.length ? { include: contentContext.sitemap.include } : {}),
          ...(contentContext.sitemap.exclude?.length ? { exclude: contentContext.sitemap.exclude } : {}),
          ...(typeof contentContext.sitemap.includeDrafts === 'boolean' ? { includeDrafts: contentContext.sitemap.includeDrafts } : {})
        }
      : false,
    search: searchRuntime,
    navigation: contentContext.navigation as any,
    wsUrl: '',
    contentHead: options.contentHead ?? true
  })

  const siteUrl = resolveNuxtSiteUrl(nuxt)
  if (siteUrl) {
    ;(nuxt.options.runtimeConfig.public as Record<string, any>).siteUrl = siteUrl
  }

  // @ts-expect-error - runtime config typing is augmented in this module package.
  nuxt.options.runtimeConfig.public.content = contentRuntime
  nuxt.options.runtimeConfig.content = defu(nuxt.options.runtimeConfig.content as any, {
    cacheVersion: CACHE_VERSION,
    cacheIntegrity,
    revalidate: options.revalidate && options.revalidate !== false && options.revalidate.token
      ? {
          token: options.revalidate.token,
          allowUnsigned: options.revalidate.allowUnsigned === true
        }
      : false,
    ...contentContext as any,
    collections: runtimeCollections
  })
}
