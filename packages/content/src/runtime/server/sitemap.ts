import type { H3Event } from 'h3'
import { getRequestURL } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import type { ContentSitemapEntry } from '../../types/query'
import { queryCollectionsSitemapEntriesData, type QueryCollectionsSitemapEntriesOptions } from '../../features/sitemap/query'
import { queryFilesystemCollectionPage, queryFilesystemCollectionRouteMeta } from './collection-helpers'
import { serverQueryCollection } from './storage'
import { contentConfig } from './storage-access'
import { resolveCollectionI18n } from '../../features/localization/path'

type LocaleConfig = {
  code: string
  language?: string
}

type SitemapRuntimeConfig = {
  public: {
    content?: { siteUrl?: string }
    siteUrl?: string
    i18n?: { locales?: LocaleConfig[] }
  }
}

const sitemapPageFields = [
  'path',
  'file',
  'locale',
  'draft',
  'canonicalKey',
  'sitemap',
  'image',
  'seo',
  'ogImage'
] as const

export type { QueryCollectionsSitemapEntriesOptions }

export async function queryFilesystemCollectionsSitemapEntries (
  event: H3Event,
  options: QueryCollectionsSitemapEntriesOptions = {}
): Promise<ContentSitemapEntry[]> {
  const runtimeConfig = useRuntimeConfig(event)
  const sitemapRuntime = runtimeConfig as unknown as SitemapRuntimeConfig
  const requestUrl = (event as H3Event | undefined)?.node?.req ? getRequestURL(event) : null

  return await queryCollectionsSitemapEntriesData({
    collections: contentConfig().collections,
    defaultLocale: contentConfig().defaultLocale,
    runtimeSiteUrl: sitemapRuntime.public.content?.siteUrl || sitemapRuntime.public.siteUrl,
    localeConfigs: sitemapRuntime.public.i18n?.locales || [],
    requestSiteUrl: requestUrl ? `${requestUrl.protocol}//${requestUrl.host}` : undefined
  }, {
    loadCollectionPages: async collection => {
      const config = contentConfig()
      const collectionI18n = resolveCollectionI18n(collection, config)
      const pages = collectionI18n.locales.length
        ? (await Promise.all(collectionI18n.locales.map(locale =>
            serverQueryCollection(event, collection).locale(locale).select(...sitemapPageFields).all()
          ))).flat()
        : await serverQueryCollection(event, collection).select(...sitemapPageFields).all()

      return pages as Array<{
        path?: string
        collection?: string
        canonicalKey?: string
        locale?: string
        draft?: boolean
        sitemap?: unknown
        body?: unknown
      }>
    },
    loadRouteMeta: async (collection, path, locale) => {
      return await queryFilesystemCollectionRouteMeta(event, collection, path, { locale })
    },
    loadPage: async (collection, path, locale) => {
      return await queryFilesystemCollectionPage(event, collection, path, { locale })
    }
  }, options)
}

export const queryCollectionsSitemapEntries = queryFilesystemCollectionsSitemapEntries
