import type { ParsedContent } from '../../types/content'
import { createCollectionSurroundings } from '../navigation/tree'
import { createSearchSections, type GenerateSearchSectionsOptions } from '../search/sections'
import type { RuntimeContentI18nInput } from '../localization/config'
import { localizePath, normalizeContentPath, resolveCollectionI18n, resolveRouteContent } from '../localization/path'

export interface CollectionResolveRuntime extends RuntimeContentI18nInput {
  localeFallback?: Record<string, string[]>
  translatedSlugs?: boolean
}

export const resolveCollectionNavigationData = async (
  collection: string,
  _runtime: CollectionResolveRuntime,
  options: {
    fields?: string[]
    locale?: string
    canonical?: boolean
    activeLocale?: string
    loadNavigation: () => Promise<any[]>
  }
) => {
  return await options.loadNavigation()
}

export const resolveCollectionItemSurroundingsData = async (
  collection: string,
  path: string,
  runtime: CollectionResolveRuntime,
  options: {
    before?: number
    after?: number
    fields?: string[]
    locale?: string
    canonical?: boolean
    activeLocale?: string
    loadNavigation: (options: { fields?: string[], locale?: string, canonical?: boolean }) => Promise<any[]>
  }
) => {
  const { locales, defaultLocale } = resolveCollectionI18n(collection, runtime)
  const resolved = resolveRouteContent(path, locales, defaultLocale, options.locale)
  const navigation = await options.loadNavigation({
    fields: options.fields || [],
    locale: resolved.locale || options.activeLocale,
    canonical: options.canonical
  })
  const localizedPath = options.canonical ? normalizeContentPath(resolved.path) : normalizeContentPath(resolved.routePath)
  return createCollectionSurroundings(navigation, localizedPath, options)
}

export const resolveCollectionSearchSectionsData = async (
  collection: string,
  runtime: CollectionResolveRuntime,
  options: (GenerateSearchSectionsOptions & { locale?: string, canonical?: boolean, activeLocale?: string }) & {
    loadPages: (extraFields: string[]) => Promise<Array<Pick<ParsedContent, 'path' | 'title' | 'description' | 'body'> & Record<string, unknown>>>
  }
) => {
  const { locales, defaultLocale } = resolveCollectionI18n(collection, runtime)
  const locale = options.locale || options.activeLocale || defaultLocale
  const pages = await options.loadPages(options.extraFields || [])
  const sections = createSearchSections(pages, options)
  return options.canonical
    ? sections
    : sections.map(section => ({
        ...section,
        id: localizePath(section.id, locale, defaultLocale, locales) || section.id
      }))
}
