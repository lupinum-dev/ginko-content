import type { LocaleFallback } from '../../types/query'
import type { RuntimeContentConfig } from './context'

export const collectionDefaultLocale = (
  collection: string,
  runtime: RuntimeContentConfig | undefined
) => {
  const collectionI18n = runtime?.collections?.[collection]?.i18n
  const collectionDefault = collectionI18n && typeof collectionI18n === 'object' ? collectionI18n.defaultLocale : undefined
  return collectionDefault || runtime?.defaultLocale
}

export const collectionLocales = (
  collection: string,
  runtime: RuntimeContentConfig | undefined
) => {
  const collectionI18n = runtime?.collections?.[collection]?.i18n
  const collectionLocales = collectionI18n && typeof collectionI18n === 'object' ? collectionI18n.locales : undefined
  return collectionLocales?.length ? collectionLocales : (runtime?.locales || [])
}

export const resolveFallback = (
  fallback: LocaleFallback | undefined,
  collection: string,
  runtime: RuntimeContentConfig | undefined
): Exclude<LocaleFallback, 'default'> | undefined => {
  if (fallback !== 'default') return fallback
  const defaultLocale = collectionDefaultLocale(collection, runtime)
  return defaultLocale ? [defaultLocale] : []
}
