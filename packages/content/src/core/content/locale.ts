/**
 * Locale utilities shared by the graph, the query planner, and the ingest
 * pipeline. Three concepts to keep straight:
 *
 *  1. **Fallback chain** — the ordered list of locales to try when a
 *     variant is missing (`buildLocaleFallbackChain`). User-configured
 *     per-locale fallbacks come first; the site default ties it off.
 *
 *  2. **Inline locale variant id** — YAML/JSON sources can carry locale
 *     overrides inline (`i18n: { de: { title: '…' } }`). We split each
 *     such document into one variant per locale at ingest; the
 *     synthetic variants share a `id` shape of
 *     `${sourceId}#__locale=${locale}`. `splitInlineLocaleVariantId`
 *     reverses that for lookups.
 *
 *  3. **Inline override merge** — `expandDataLocaleVariants` does a
 *     deep merge of the base document with each locale-specific
 *     override, cloning values along the way so variants never share
 *     references with the base or with each other.
 */
import type { ParsedContent } from '../../types/content'
import type { ContentCollectionI18nConfig } from '../../types/config'

/** Separator between source id and locale in inline-variant ids. */
export const INLINE_LOCALE_ID_SEPARATOR = '#__locale='

const isPlainObject = (value: unknown): value is Record<string, any> => {
  return Boolean(value) && Object.prototype.toString.call(value) === '[object Object]'
}

const cloneValue = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map(item => cloneValue(item)) as T
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)])) as T
  }

  return value
}

const mergeLocaleOverride = <T>(base: T, override: unknown): T => {
  if (typeof override === 'undefined') {
    return cloneValue(base)
  }

  if (Array.isArray(override)) {
    return cloneValue(override) as T
  }

  if (isPlainObject(base) && isPlainObject(override)) {
    const merged = Object.fromEntries(Object.entries(base).map(([key, value]) => [key, cloneValue(value)]))
    for (const [key, value] of Object.entries(override)) {
      Object.defineProperty(merged, key, {
        value: Object.prototype.hasOwnProperty.call(merged, key) ? mergeLocaleOverride(merged[key], value) : cloneValue(value),
        enumerable: true,
        configurable: true,
        writable: true
      })
    }
    return merged as T
  }

  return cloneValue(override) as T
}

/**
 * Build the locale resolution chain for a request. The requested locale,
 * configured fallbacks, and default locale are ordered by priority and
 * deduplicated without reordering.
 */
export const resolveLocaleChain = (
  requestedLocale: string | undefined,
  defaultLocale?: string,
  fallback: Record<string, string[]> = {}
) => {
  const chain = [
    ...(requestedLocale ? [requestedLocale] : []),
    ...((requestedLocale && fallback[requestedLocale]) || []),
    ...(defaultLocale ? [defaultLocale] : [])
  ].filter(Boolean) as string[]

  return Array.from(new Set(chain))
}

/**
 * Produce the fallback portion of the canonical locale chain, excluding the
 * requested locale itself.
 *
 * @example
 * buildLocaleFallbackChain('fr', 'en', { fr: ['de'] })  // ['de', 'en']
 * buildLocaleFallbackChain('en', 'en')                 // []
 */
export const buildLocaleFallbackChain = (
  locale: string,
  defaultLocale?: string,
  fallback?: Record<string, string[]>
) => resolveLocaleChain(locale, defaultLocale, fallback).slice(1)

/** Canonical locale order: default locale first, then configured locale order. */
export const sortLocalesCanonically = (
  locales: string[],
  config: { defaultLocale?: string, locales?: string[] } = {}
): string[] => {
  const order = [
    ...(config.defaultLocale ? [config.defaultLocale] : []),
    ...(config.locales || [])
  ]
  const rank = new Map(order.map((locale, index) => [locale, index]))
  const inputOrder = new Map(locales.map((locale, index) => [locale, index]))
  return Array.from(new Set(locales)).sort((left, right) =>
    (rank.get(left) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right) ?? Number.MAX_SAFE_INTEGER) ||
    (inputOrder.get(left) ?? Number.MAX_SAFE_INTEGER) - (inputOrder.get(right) ?? Number.MAX_SAFE_INTEGER)
  )
}

/**
 * Split an inline-variant id back into `{ sourceId, locale }`. Returns the
 * input unchanged (with `locale: undefined`) when no separator is found.
 */
export const splitInlineLocaleVariantId = (id: string) => {
  const separatorIndex = id.indexOf(INLINE_LOCALE_ID_SEPARATOR)
  if (separatorIndex === -1) {
    return { sourceId: id, locale: undefined }
  }

  return {
    sourceId: id.slice(0, separatorIndex),
    locale: id.slice(separatorIndex + INLINE_LOCALE_ID_SEPARATOR.length) || undefined
  }
}

/**
 * Expand a single YAML/JSON document with inline `i18n` overrides into one
 * document per configured locale.
 *
 * Markdown documents are returned unchanged — they express locale
 * variants via filename (`index.en.md`, `index.de.md`) rather than
 * inline keys, so the ingest pipeline already produces one document
 * per variant.
 *
 * The base document (without the `i18n` key) becomes the source-locale
 * variant. Each sibling locale gets a deep-merged variant that inherits
 * from the base and overrides keys listed under `i18n[locale]`.
 *
 * GOTCHA: a non-object override (e.g. a string) is skipped with a warn.
 * We do not throw — translation data is user-authored and one malformed
 * override should not fail ingest for the whole document.
 */
export const expandDataLocaleVariants = (
  document: ParsedContent,
  i18nConfig?: ContentCollectionI18nConfig
) => {
  if (!i18nConfig || (document.type !== 'yaml' && document.type !== 'json')) {
    return [document]
  }

  const rawI18n = isPlainObject(document.i18n) ? document.i18n : undefined
  if (!rawI18n) {
    return [document]
  }

  const { i18n: _removed, ...baseDocument } = document as ParsedContent & { i18n?: Record<string, unknown> }
  const sourceLocale = document.locale || i18nConfig.defaultLocale
  const variants: ParsedContent[] = [{ ...baseDocument, locale: sourceLocale }]

  for (const locale of i18nConfig.locales) {
    if (locale === sourceLocale) {
      continue
    }

    const override = rawI18n[locale]
    if (typeof override !== 'undefined' && !isPlainObject(override)) {
      console.warn(`[content] Inline i18n override for locale "${locale}" in "${document.id}" must be an object. Skipping invalid override.`)
      continue
    }

    if (!isPlainObject(override)) {
      continue
    }

    const merged = mergeLocaleOverride(baseDocument, override) as ParsedContent
    variants.push({
      ...merged,
      id: `${document.id}${INLINE_LOCALE_ID_SEPARATOR}${locale}`,
      locale
    })
  }

  return variants
}
