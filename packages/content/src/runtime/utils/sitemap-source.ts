export const GINKO_SITEMAP_SOURCE_NAME = '@lupinum/ginko-content:urls'

export function resolveContentSitemapSource(apiBaseURL: string, sitemapPath = '/sitemap') {
  const base = apiBaseURL.replace(/\/$/, '')
  const path = sitemapPath.startsWith('/') ? sitemapPath : `/${sitemapPath}`
  return `${base}${path}`
}
