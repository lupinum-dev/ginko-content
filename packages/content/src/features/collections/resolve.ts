import { createCollectionSurroundings } from '../navigation/tree'
import { createSearchSections, type GenerateSearchSectionsOptions, type SearchablePage } from '../search/sections'
import type { RuntimeContentI18nInput } from '../localization/config'
import { localizePath, normalizeContentPath, resolveCollectionI18n, resolveRouteContent } from '../localization/path'

type CollectionResolveRuntime = RuntimeContentI18nInput

export const resolveCollectionItemSurroundingsData = async (
  collection: string,
  path: string,
  runtime: CollectionResolveRuntime,
  options: {
    before?: number
    after?: number
    fields?: string[]
    locale?: string
    activeLocale?: string
    loadNavigation: (options: { fields?: string[], locale?: string }) => Promise<any[]>
  }
) => {
  const { locales, defaultLocale } = resolveCollectionI18n(collection, runtime)
  const resolved = resolveRouteContent(path, locales, defaultLocale, options.locale)
  const navigation = await options.loadNavigation({
    fields: options.fields || [],
    locale: resolved.locale || options.activeLocale
  })
  const localizedPath = normalizeContentPath(resolved.routePath)
  return createCollectionSurroundings(navigation, localizedPath, options)
}

export const resolveCollectionSearchSectionsData = async (
  collection: string,
  runtime: CollectionResolveRuntime,
  options: (GenerateSearchSectionsOptions & { locale?: string, activeLocale?: string }) & {
    loadPages: (extraFields: string[]) => Promise<SearchablePage[]>
  }
) => {
  const { locales, defaultLocale } = resolveCollectionI18n(collection, runtime)
  const locale = options.locale || options.activeLocale || defaultLocale
  const pages = await options.loadPages(options.extraFields || [])
  const sections = createSearchSections(pages, options)
  return sections.map(section => ({
    ...section,
    id: localizePath(section.id, locale, defaultLocale, locales) || section.id
  }))
}
