import type { ContentCollectionConfig, ContentCollectionRouteConfig } from '../types/config'
import { normalizeContentPath, normalizeRouteMounts } from '../core/content/path'

export interface ContentRouteMetadataPage {
  file?: string
  path?: string
  children?: ContentRouteMetadataPage[]
  meta?: Record<string, unknown>
}

interface ContentPageMeta {
  collection?: unknown
  route?: unknown
}

const getContentPageMeta = (page: ContentRouteMetadataPage): ContentPageMeta | undefined => {
  const content = page.meta?.content
  return content && typeof content === 'object' ? content as ContentPageMeta : undefined
}

const isRouteConfig = (value: unknown): value is ContentCollectionRouteConfig =>
  typeof value === 'string' ||
  (
    value !== null &&
    typeof value === 'object' &&
    Object.values(value).every(entry => typeof entry === 'string')
  )

const describePage = (page: ContentRouteMetadataPage) => page.file || page.path || '<unknown page>'

const expectedLocalesFor = (
  collection: ContentCollectionConfig,
  locales: string[],
  defaultLocale?: string
) => {
  const collectionI18n = collection.i18n && typeof collection.i18n === 'object'
    ? collection.i18n
    : undefined

  return collectionI18n?.locales?.length
    ? collectionI18n.locales
    : (locales.length ? locales : (defaultLocale ? [defaultLocale] : []))
}

export function validateContentPageRouteMetadata(
  pages: ContentRouteMetadataPage[],
  collections: Record<string, ContentCollectionConfig>,
  options: { locales?: string[], defaultLocale?: string } = {}
) {
  const visit = (page: ContentRouteMetadataPage) => {
    const contentMeta = getContentPageMeta(page)
    if (contentMeta) {
      validatePage(page, contentMeta, collections, options)
    }

    for (const child of page.children || []) {
      visit(child)
    }
  }

  for (const page of pages) {
    visit(page)
  }
}

function validatePage(
  page: ContentRouteMetadataPage,
  contentMeta: ContentPageMeta,
  collections: Record<string, ContentCollectionConfig>,
  options: { locales?: string[], defaultLocale?: string }
) {
  const collectionName = contentMeta.collection
  if (typeof collectionName !== 'string' || !collectionName) {
    throw new Error(`@lupinum/ginko-content page "${describePage(page)}" declares content route metadata without a string collection name.`)
  }

  const collection = collections[collectionName]
  if (!collection) {
    throw new Error(`@lupinum/ginko-content page "${describePage(page)}" declares content collection "${collectionName}", but no matching collection exists in content.config.ts.`)
  }

  if (!isRouteConfig(contentMeta.route)) {
    throw new Error(`@lupinum/ginko-content page "${describePage(page)}" declares content collection "${collectionName}" but no route metadata. Add definePageMeta({ content: { collection: '${collectionName}', route: ... } }).`)
  }

  const locales = expectedLocalesFor(collection, options.locales || [], options.defaultLocale)
  const defaultLocale = collection.i18n && typeof collection.i18n === 'object'
    ? collection.i18n.defaultLocale
    : options.defaultLocale
  const expected = normalizeRouteMounts(collection.route, locales, defaultLocale)
  const actual = normalizeRouteMounts(contentMeta.route, locales, defaultLocale)

  if (!expected) {
    throw new Error(`@lupinum/ginko-content page "${describePage(page)}" declares route metadata for collection "${collectionName}", but that collection has no route config in content.config.ts.`)
  }

  for (const locale of Object.keys(expected)) {
    const expectedRoute = normalizeContentPath(expected[locale])
    const actualRoute = actual?.[locale] ? normalizeContentPath(actual[locale]) : undefined

    if (!actualRoute) {
      throw new Error(`@lupinum/ginko-content route metadata mismatch in "${describePage(page)}": collection "${collectionName}" is missing locale "${locale}" route "${expectedRoute}".`)
    }

    if (actualRoute !== expectedRoute) {
      throw new Error(`@lupinum/ginko-content route metadata mismatch in "${describePage(page)}": collection "${collectionName}" locale "${locale}" expected route "${expectedRoute}" but page metadata declares "${actualRoute}".`)
    }
  }
}
