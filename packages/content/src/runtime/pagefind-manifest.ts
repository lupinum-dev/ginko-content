export interface PagefindLocaleManifest {
  version: 1
  defaultLocale: string
  indexes: Record<string, string>
}

export const isPagefindLocale = (value: unknown): value is string =>
  typeof value === 'string'
  && value.length > 0
  && value.length <= 64
  && /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(value)

const indexEntry = (locale: string, defaultLocale: string) =>
  locale === defaultLocale ? 'pagefind.js' : `${locale}/pagefind.js`

export const createPagefindLocaleManifest = (
  defaultLocale: string,
  locales: readonly string[]
): PagefindLocaleManifest => ({
  version: 1,
  defaultLocale,
  indexes: Object.fromEntries(locales.map(locale => [locale, indexEntry(locale, defaultLocale)]))
})

export const isPagefindLocaleManifest = (value: unknown): value is PagefindLocaleManifest => {
  if (!value || typeof value !== 'object') return false
  const manifest = value as Record<string, unknown>
  const indexes = manifest.indexes && typeof manifest.indexes === 'object' && !Array.isArray(manifest.indexes)
    ? manifest.indexes as Record<string, unknown>
    : undefined
  if (manifest.version !== 1 || !isPagefindLocale(manifest.defaultLocale) || !indexes) return false
  const entries = Object.entries(indexes)
  return entries.length > 0
    && entries.every(([locale, entry]) =>
      isPagefindLocale(locale)
      && entry === indexEntry(locale, manifest.defaultLocale as string))
    && typeof indexes[manifest.defaultLocale] === 'string'
}
