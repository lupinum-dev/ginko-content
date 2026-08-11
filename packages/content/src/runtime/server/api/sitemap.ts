import { defineEventHandler, getQuery } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { queryCollectionsSitemapEntries } from '../sitemap-provider'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const runtimeSitemap = useRuntimeConfig(event).content?.sitemap
  const include = typeof query.include === 'string'
    ? query.include.split(',').map(item => item.trim()).filter(Boolean)
    : runtimeSitemap?.include
  const exclude = typeof query.exclude === 'string'
    ? query.exclude.split(',').map(item => item.trim()).filter(Boolean)
    : runtimeSitemap?.exclude
  // `includeDrafts` is deliberately NOT read from the untrusted query string:
  // this is an unauthenticated public endpoint, and the only legitimate
  // override is the author's own module configuration. Draft visibility
  // otherwise follows the one core environment-aware decision (see
  // the provider-backed sitemap projection).
  const includeDrafts = runtimeSitemap?.includeDrafts

  return await queryCollectionsSitemapEntries(event, { include, exclude, includeDrafts })
})
