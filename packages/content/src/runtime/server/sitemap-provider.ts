import type { H3Event } from 'h3'
import type { ContentSitemapEntry } from '../../types/query'
import type { QueryCollectionsSitemapEntriesOptions } from './sitemap'
import { createContentProviderError } from '../../public/provider-errors'

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const describeShape = (value: unknown) => {
  if (Array.isArray(value)) return 'array'
  if (value === null) return 'null'
  return typeof value
}

const assertSitemapEntry = (
  entry: unknown,
  index: number,
  provider: string
): asserts entry is ContentSitemapEntry => {
  if (!isObject(entry) || typeof entry.loc !== 'string' || !entry.loc.trim()) {
    throw createContentProviderError('provider_result_invalid', `${provider} returned an invalid sitemap entry.`, {
      provider,
      operation: 'sitemap entries',
      index,
      field: 'loc',
      actual: describeShape(entry)
    })
  }

  if (
    entry.alternatives !== undefined &&
    (!Array.isArray(entry.alternatives) || entry.alternatives.some(alternative =>
      !isObject(alternative) ||
      typeof alternative.hreflang !== 'string' ||
      typeof alternative.href !== 'string'
    ))
  ) {
    throw createContentProviderError('provider_result_invalid', `${provider} returned invalid sitemap alternatives.`, {
      provider,
      operation: 'sitemap entries',
      index,
      field: 'alternatives',
      actual: describeShape(entry.alternatives)
    })
  }
}

const assertSitemapEntries = (
  value: unknown,
  provider: string
): ContentSitemapEntry[] => {
  if (!Array.isArray(value)) {
    throw createContentProviderError('provider_result_invalid', `${provider} returned invalid sitemap entries.`, {
      provider,
      operation: 'sitemap entries',
      actual: describeShape(value)
    })
  }

  value.forEach((entry, index) => assertSitemapEntry(entry, index, provider))
  return value
}

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
  return assertSitemapEntries(await provider.sitemapEntries(event, options), provider.name)
}
