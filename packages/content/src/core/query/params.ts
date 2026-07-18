import type { ContentProviderQueryInput, ContentProviderQueryWhere } from '../../types/query'
import type { ContentCollectionI18nConfig } from '../../types/config'
import { buildLocaleFallbackChain } from '../content/locale'
import { collectJsonPurityViolations, formatJsonPurityViolations } from '../json-value'

export const encodeQueryParams = (params: ContentProviderQueryInput) => {
  const violations = collectJsonPurityViolations(params)
  if (violations.length) {
    throw new TypeError(`Invalid content query params: ${formatJsonPurityViolations(violations)}`)
  }
  const bytes = new TextEncoder().encode(JSON.stringify(params))
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  let encoded = btoa(binary)
  encoded = encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

  const chunks = encoded.match(/.{1,100}/g) || []
  return chunks.join('/')
}

export const decodeQueryParams = (encoded: string) => {
  encoded = encoded.replace(/\//g, '')
  encoded = encoded.replace(/-/g, '+').replace(/_/g, '/')
  encoded = encoded.padEnd(encoded.length + (4 - (encoded.length % 4)) % 4, '=')

  const binary = atob(encoded)
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
}

export const ensureQueryWhereArray = (where?: ContentProviderQueryInput['where']) => {
  return Array.isArray(where) ? [...where] : where ? [where] : []
}

export const collectQueryWhere = (
  where: ContentProviderQueryInput['where'],
  predicate: (condition: ContentProviderQueryWhere) => boolean
): ContentProviderQueryWhere[] => {
  const matches: ContentProviderQueryWhere[] = []

  const visit = (conditions: ContentProviderQueryInput['where']) => {
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
  where: ContentProviderQueryInput['where'],
  predicate: (condition: ContentProviderQueryWhere) => boolean
): ContentProviderQueryWhere | undefined => collectQueryWhere(where, predicate)[0]

const normalizeResolutionFallback = <T extends {
  locale?: string
  fallback?: string[] | boolean
  exact?: boolean
}>(
  resolution: T | undefined,
  options: {
    collectionI18n?: ContentCollectionI18nConfig
    defaultLocale?: string
    localeFallback?: Record<string, string[]>
  }
): T | undefined => {
  if (!resolution) return undefined

  const normalized = { ...resolution }
  const defaultLocale = options.collectionI18n?.defaultLocale || options.defaultLocale

  // `fallback: false` and `exact: true` are the same no-fallback intent. Keep
  // only that canonical state so later lowering cannot accidentally restore a
  // configured fallback chain from an absent/empty fallback array.
  if (normalized.exact === true || normalized.fallback === false) {
    delete normalized.fallback
    normalized.exact = true
    return normalized
  }

  if (normalized.fallback === true) {
    const locale = normalized.locale || defaultLocale
    normalized.fallback = locale
      ? buildLocaleFallbackChain(locale, defaultLocale, options.localeFallback)
      : []
  } else if (Array.isArray(normalized.fallback)) {
    // `default` is the public shorthand for this collection's own default, not
    // a literal locale code. Preserve explicit order while resolving it here,
    // before configured-locale validation and plan lowering.
    normalized.fallback = Array.from(new Set(normalized.fallback.flatMap(locale =>
      locale === 'default' ? (defaultLocale ? [defaultLocale] : []) : [locale]
    )))
    if (normalized.fallback.length === 0) {
      delete normalized.fallback
      normalized.exact = true
    }
  }

  return normalized
}

export const normalizeContentQueryParams = (
  params: ContentProviderQueryInput,
  options: {
    collectionI18n?: ContentCollectionI18nConfig
    defaultLocale?: string
    localeFallback?: Record<string, string[]>
  } = {}
): ContentProviderQueryInput => {
  const where = ensureQueryWhereArray(params.where)
  const normalized: ContentProviderQueryInput = {
    ...params,
    where,
    sort: params.sort ? [...params.sort] : params.sort
  }
  if (params.where === undefined) {
    delete normalized.where
  }

  if (normalized.resolveLocale) {
    normalized.resolveLocale = normalizeResolutionFallback(normalized.resolveLocale, options)
  }
  if (normalized.resolveVariant) {
    normalized.resolveVariant = normalizeResolutionFallback(normalized.resolveVariant, options)
  }

  if (options.collectionI18n?.locales.length && !normalized.resolveLocale && !normalized.resolveVariant) {
    const queryLocale = findQueryWhere(where, item => typeof item.locale !== 'undefined')?.locale
    const defaultLocale = options.collectionI18n.defaultLocale
    if (!queryLocale && defaultLocale) {
      where.push({ locale: defaultLocale })
    }
  }

  if (where.length > 0) {
    normalized.where = where
  }

  return normalized
}
