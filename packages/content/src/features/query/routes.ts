import type { ContentCollectionHandle } from '../../types/config'
import { resolveCollectionLocalePolicy } from '../localization/locale-policy'
import { DEFAULT_CONTENT_LOCALE } from '../../core/content/locale'
import { normalizeContentPath } from '../../core/content/path'
import { mountProviderContentPath, projectContentRoute } from '../localization/route-projector'

export interface CollectionPathOptions {
  /**
   * Target locale. Non-default locales are prefixed in public routes.
   */
  locale?: string
  /**
   * Relative document slug. Arrays are joined with `/`.
   */
  slug?: string | string[]
  /**
   * Canonical content path or route remainder. Takes precedence over `slug`.
   */
  path?: string
  /**
   * Include the application locale prefix. Set to `false` for the mounted
   * provider coordinate.
   */
  localePrefix?: boolean
}

const normalizeSlug = (slug: string | string[] | undefined) => {
  if (Array.isArray(slug)) {
    return slug.filter(Boolean).join('/')
  }
  return slug || ''
}

const collectionI18n = (collection: ContentCollectionHandle) => {
  return collection.i18n && typeof collection.i18n === 'object'
    ? collection.i18n
    : undefined
}

const normalizeRemainder = (path: string) => normalizeContentPath(path.startsWith('/') ? path : `/${path}`)

/**
 * Build a public route for a route-backed collection from the collection's own
 * route map. This keeps app code from duplicating `{ en: '/authors', de:
 * '/autoren' }` in local utilities.
 */
export const getCollectionPath = (
  collection: ContentCollectionHandle,
  options: CollectionPathOptions = {}
) => {
  if (collection.i18n === true) {
    throw new TypeError(
      `getCollectionPath() cannot project collection "${collection.name}" from i18n: true because `
      + 'the pure collection handle does not contain the inherited locale policy. '
      + 'Use an explicit collection-local i18n { locales, defaultLocale } object.'
    )
  }
  const i18n = collectionI18n(collection)
  const defaultLocale = i18n?.defaultLocale || DEFAULT_CONTENT_LOCALE
  const locale = options.locale || defaultLocale
  const remainder = normalizeRemainder(options.path ?? normalizeSlug(options.slug) ?? '/')
  const policy = resolveCollectionLocalePolicy({
    name: collection.name,
    localized: Boolean(collection.i18n),
    locales: i18n?.locales,
    defaultLocale: i18n?.defaultLocale,
    route: collection.route
  }, {
    locales: i18n?.locales || [],
    defaultLocale,
    fallback: {},
    translatedSlugs: false
  })
  const routeFact = { contentPath: remainder, locale }

  return options.localePrefix === false
    ? mountProviderContentPath(routeFact, policy)
    : projectContentRoute(routeFact, policy)
}
