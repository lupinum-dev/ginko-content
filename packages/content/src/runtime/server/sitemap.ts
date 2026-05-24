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

const sitemapPageFields = [
  '_path',
  '_file',
  '_locale',
  '_draft',
  '_canonicalKey',
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
  const requestUrl = (event as H3Event | undefined)?.node?.req ? getRequestURL(event) : null

  return await queryCollectionsSitemapEntriesData({
    collections: contentConfig().collections,
    defaultLocale: contentConfig().defaultLocale,
    runtimeSiteUrl: runtimeConfig.public.siteUrl,
    localeConfigs: (runtimeConfig.public.i18n?.locales || []) as LocaleConfig[],
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
        _path?: string
        _collection?: string
        _canonicalKey?: string
        _locale?: string
        _draft?: boolean
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
