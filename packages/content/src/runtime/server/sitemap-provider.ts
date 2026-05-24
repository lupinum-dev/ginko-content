import type { H3Event } from 'h3'
import type { ContentSitemapEntry } from '../../types/query'
import type { QueryCollectionsSitemapEntriesOptions } from './sitemap'
import { createContentProviderError } from '../../public/provider-errors'

/**
 * Generate sitemap entries for one or more content collections.
 *
 * Entries include locale alternatives when i18n metadata is available and
 * attempt to collect images from page metadata and markdown bodies.
 */
export async function queryCollectionsSitemapEntries (
  event: H3Event,
  options: QueryCollectionsSitemapEntriesOptions = {}
): Promise<ContentSitemapEntry[]> {
  const { getContentProvider } = await import('./providers')
  const provider = await getContentProvider(event)
  if (!provider.sitemapEntries) {
    throw createContentProviderError('unsupported_provider_operation', `${provider.name} does not support sitemap entries`, {
      provider: provider.name
    })
  }
  return await provider.sitemapEntries(event, options)
}
