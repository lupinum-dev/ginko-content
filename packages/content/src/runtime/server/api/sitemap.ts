import { defineEventHandler, getQuery } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { queryCollectionsSitemapEntries } from '../sitemap-provider'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const runtimeSitemap = useRuntimeConfig(event).public.content?.sitemap
  const include = typeof query.include === 'string'
    ? query.include.split(',').map(item => item.trim()).filter(Boolean)
    : runtimeSitemap?.include
  const exclude = typeof query.exclude === 'string'
    ? query.exclude.split(',').map(item => item.trim()).filter(Boolean)
    : runtimeSitemap?.exclude
  const includeDrafts = typeof query.includeDrafts === 'string'
    ? query.includeDrafts === 'true'
    : runtimeSitemap?.includeDrafts

  return await queryCollectionsSitemapEntries(event, { include, exclude, includeDrafts })
})
