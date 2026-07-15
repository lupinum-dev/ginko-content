import type { ContentCollectionHandle } from '../../types/config'
import type { ResolvedCollectionLocalePolicy } from '../localization/locale-policy'
import { normalizeContentPath, normalizeRouteMounts } from '../../core/content/path'
import { projectContentRoute } from '../localization/route-projector'

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
   * Override the default locale when the collection does not declare one.
   */
  defaultLocale?: string
  /**
   * Override the locale list when the collection does not declare one.
   */
  locales?: string[]
  /**
   * Return the locale-specific route without adding the locale prefix.
   */
  canonical?: boolean
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
  const i18n = collectionI18n(collection)
  const defaultLocale = i18n?.defaultLocale || options.defaultLocale
  const locales = i18n?.locales?.length ? i18n.locales : (options.locales || (defaultLocale ? [defaultLocale] : []))
  const locale = options.locale || defaultLocale
  const mounts = normalizeRouteMounts(collection.route, locales, defaultLocale)
  const remainder = normalizeRemainder(options.path ?? normalizeSlug(options.slug) ?? '/')

  // `canonical: true` asks for the mounted-but-unprefixed path. Feeding the
  // projector a policy whose `defaultLocale` equals the requested locale
  // reproduces that exactly: the mount is still applied,
  // but `prefixPathWithLocale` never adds a prefix when locale === defaultLocale.
  const policy: ResolvedCollectionLocalePolicy = {
    localized: locales.length > 0,
    locales,
    defaultLocale: options.canonical ? locale : defaultLocale,
    fallback: {},
    translatedSlugs: false,
    routeMounts: mounts ?? {}
  }

  return projectContentRoute({ contentPath: remainder, locale: locale ?? '' }, policy)
}
