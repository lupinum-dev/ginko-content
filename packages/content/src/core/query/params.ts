import type { ContentQueryBuilderParams, ContentQueryBuilderWhere } from '../../types/query'
import type { ContentCollectionI18nConfig } from '../../types/config'
import { buildLocaleFallbackChain } from '../content/locale'
import { withoutTrailingSlash } from 'ufo'

const stringifyQueryParams = (value: unknown) => JSON.stringify(value, (_key, item) =>
  item instanceof RegExp ? `--REGEX ${item.toString()}` : item)

const parseQueryParams = (value: string) => JSON.parse(value, (_key, item: unknown) => {
  const encoded = typeof item === 'string' ? item.match(/^--REGEX \/(.*)\/([dgimsuy]*)$/) : undefined
  return encoded?.[1] ? new RegExp(encoded[1], encoded[2] || '') : item
})

export const encodeQueryParams = (params: ContentQueryBuilderParams) => {
  let encoded = stringifyQueryParams(params)
  encoded = typeof Buffer !== 'undefined' ? Buffer.from(encoded).toString('base64') : btoa(encoded)
  encoded = encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

  const chunks = encoded.match(/.{1,100}/g) || []
  return chunks.join('/')
}

export const decodeQueryParams = (encoded: string) => {
  encoded = encoded.replace(/\//g, '')
  encoded = encoded.replace(/-/g, '+').replace(/_/g, '/')
  encoded = encoded.padEnd(encoded.length + (4 - (encoded.length % 4)) % 4, '=')

  return parseQueryParams(typeof Buffer !== 'undefined' ? Buffer.from(encoded, 'base64').toString() : atob(encoded))
}

const escapeContentPath = (path: string) => path.replace(/[-[\]{}()*+.,^$\s/]/g, '\\$&')

export const ensureQueryWhereArray = (where?: ContentQueryBuilderParams['where']) => {
  return Array.isArray(where) ? [...where] : where ? [where] : []
}

export const collectQueryWhere = (
  where: ContentQueryBuilderParams['where'],
  predicate: (condition: ContentQueryBuilderWhere) => boolean
): ContentQueryBuilderWhere[] => {
  const matches: ContentQueryBuilderWhere[] = []

  const visit = (conditions: ContentQueryBuilderParams['where']) => {
    for (const condition of ensureQueryWhereArray(conditions)) {
      if (predicate(condition)) {
        matches.push(condition)
      }

      if (condition.$and) {
        visit(condition.$and)
      }

      if (condition.$or) {
        visit(condition.$or)
      }

      if (condition.$not && typeof condition.$not === 'object' && !Array.isArray(condition.$not) && !(condition.$not instanceof RegExp)) {
        visit(condition.$not)
      }
    }
  }

  visit(where)
  return matches
}

export const findQueryWhere = (
  where: ContentQueryBuilderParams['where'],
  predicate: (condition: ContentQueryBuilderWhere) => boolean
): ContentQueryBuilderWhere | undefined => collectQueryWhere(where, predicate)[0]

export const normalizeContentQueryParams = (
  params: ContentQueryBuilderParams,
  options: {
    path?: string
    collectionI18n?: ContentCollectionI18nConfig
    defaultLocale?: string
    localeFallback?: Record<string, string[]>
    activeLocale?: string
    includeDraftFilter?: boolean
  } = {}
): ContentQueryBuilderParams => {
  const where = ensureQueryWhereArray(params.where)
  const normalized: ContentQueryBuilderParams = {
    ...params,
    where,
    sort: params.sort ? [...params.sort] : params.sort
  }

  if (options.path) {
    if (normalized.first && where.length === 0) {
      where.push({ path: withoutTrailingSlash(options.path) })
    } else {
      where.push({ path: new RegExp(`^${escapeContentPath(options.path)}`) })
    }
  }

  if (!normalized.sort?.length) {
    normalized.sort = [{ 'file.stem': 1, $numeric: true }]
  }

  if (normalized.resolveLocale?.locale && normalized.resolveLocale.fallback === true) {
    normalized.resolveLocale = {
      ...normalized.resolveLocale,
      fallback: buildLocaleFallbackChain(
        normalized.resolveLocale.locale,
        options.collectionI18n?.defaultLocale || options.defaultLocale,
        options.localeFallback
      )
    }
  }

  if (options.includeDraftFilter) {
    if (!findQueryWhere(where, item => typeof item.draft !== 'undefined')) {
      where.push({ draft: { $ne: true } })
    }
  }

  if (options.collectionI18n?.locales.length && !normalized.resolveLocale && !normalized.resolveVariant) {
    const queryLocale = findQueryWhere(where, item => typeof item.locale !== 'undefined')?.locale
    const defaultLocale = options.activeLocale || options.collectionI18n.defaultLocale
    if (!queryLocale && defaultLocale) {
      where.push({ locale: defaultLocale })
    }
  }

  return normalized
}
