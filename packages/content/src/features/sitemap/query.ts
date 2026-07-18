import type {
  ContentSitemapAlternative,
  ContentSitemapEntry,
  ContentSitemapImage
} from '../../types/query'

export interface QueryCollectionsSitemapEntriesOptions {
  /** Restrict generation to these collection names. */
  include?: string[]
  /** Exclude these collection names from generation. */
  exclude?: string[]
  /** Include draft entries. Defaults to true in development and false otherwise. */
  includeDrafts?: boolean
  /** Absolute site URL used to expand relative paths in final entries. */
  siteUrl?: string
}

const absoluteUrl = (siteUrl: string, path: string) => `${siteUrl}${path}`

const buildSitemapAlternatives = (
  siteUrl: string,
  defaultLocale: string,
  localeToLanguage: Record<string, string>,
  variants: Array<{ locale: string, path: string }>
): ContentSitemapAlternative[] => {
  const alternatives = variants.map(variant => ({
    hreflang: localeToLanguage[variant.locale] || variant.locale,
    href: absoluteUrl(siteUrl, variant.path)
  }))
  const defaultVariant = variants.find(variant => variant.locale === defaultLocale)
  if (defaultVariant) {
    alternatives.unshift({
      hreflang: 'x-default',
      href: absoluteUrl(siteUrl, defaultVariant.path)
    })
  }
  return alternatives
}

interface ProjectSitemapEntryOptions {
  siteUrl: string
  defaultLocale: string
  localeToLanguage: Record<string, string>
  variant: { locale: string, path: string }
  variants: Array<{ locale: string, path: string }>
  lastmod?: string
  images?: ContentSitemapImage[]
}

/** Project one localized route into Nuxt Sitemap's source-entry contract. */
export const projectSitemapEntry = ({
  siteUrl,
  defaultLocale,
  localeToLanguage,
  variant,
  variants,
  lastmod,
  images
}: ProjectSitemapEntryOptions): ContentSitemapEntry => {
  const localizedVariants = variants.filter(candidate => candidate.locale)
  const alternatives = localizedVariants.length > 1
    ? buildSitemapAlternatives(siteUrl, defaultLocale, localeToLanguage, variants)
    : undefined

  return {
    loc: variant.path,
    ...(variant.locale ? { _sitemap: localeToLanguage[variant.locale] || variant.locale } : {}),
    ...(lastmod ? { lastmod } : {}),
    ...(alternatives ? { alternatives } : {}),
    ...(images?.length ? { images } : {})
  }
}
