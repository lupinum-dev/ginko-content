import { hash as ohash } from 'ohash'
import type { H3Event } from 'h3'
import type { ParsedContent } from '../types/content'
import type { ContentCacheArtifact } from '../types/runtime'
import { splitInlineLocaleVariantId } from '../core/content/locale'
import { memoizeRuntimeValue } from '../integrations/nitro/context'
import { parseContentVariants } from '../integrations/nitro/ingest'
import { cacheStoreFor, getCachedContents, setCachedContents } from './cache'
import { contentConfig, contentIgnorePredicate, getContentStorageRuntime, getContentsIds, resolveStorageId } from './driver'
import { validateContentGraph } from './validation'

const isProduction = process.env.NODE_ENV === 'production'
const isPrerendering = import.meta.prerender
const shouldValidateAtRuntime = import.meta.dev || isPrerendering

const isContentCacheArtifact = (value: unknown): value is ContentCacheArtifact<ParsedContent[]> => {
  return Boolean(value)
    && typeof value === 'object'
    && Array.isArray((value as ContentCacheArtifact<ParsedContent[]>).parsed)
    && typeof (value as ContentCacheArtifact<ParsedContent[]>).hash === 'string'
}

export function* chunksFromArray<T> (arr: T[], n: number): Generator<T[], void> {
  for (let i = 0; i < arr.length; i += n) {
    yield arr.slice(i, i + n)
  }
}

/**
 * Load every locale variant for a single content id.
 *
 * Cache strategy:
 *  1. Production serves an existing parsed artifact immediately.
 *  2. Dev/prerender validate source metadata before reusing an artifact.
 *  3. Concurrent misses for the same `(storageId, hash)` share one parse.
 */
const loadContentVariants = async (event: H3Event, id: string): Promise<ParsedContent[]> => {
  const runtime = getContentStorageRuntime(event)
  const config = contentConfig()
  const { sourceId: contentId } = splitInlineLocaleVariantId(id)
  if (!contentIgnorePredicate(contentId)) {
    return [{ _id: contentId, body: null } as ParsedContent]
  }

  const storageId = await resolveStorageId(event, contentId)
  const cachedValue = await runtime.parsedCache.getItem<unknown>(storageId)
  const cached = isContentCacheArtifact(cachedValue) ? cachedValue : null
  if (isProduction && !isPrerendering && cached) {
    return cached.parsed as ParsedContent[]
  }

  const meta = await runtime.source.getMeta(storageId)
  const hash = ohash({
    mtime: meta.mtime,
    size: meta.size || 0,
    version: runtime.config.cacheVersion,
    integrity: runtime.config.cacheIntegrity,
    collections: runtime.config.collections,
    defaultLocale: runtime.config.defaultLocale,
    locales: runtime.config.locales,
    translatedSlugs: runtime.config.translatedSlugs,
    strictTranslatedSlugs: runtime.config.strictTranslatedSlugs,
    respectPathCase: runtime.config.respectPathCase
  })
  if (cached?.hash === hash) {
    return cached.parsed as ParsedContent[]
  }

  return cacheStoreFor(event).inflightContents.run(`${storageId}${hash}`, async () => {
    const body = await runtime.source.getItem(storageId)
    if (body === null) {
      return [{ _id: contentId, body: null } as ParsedContent]
    }

    const parsed = await parseContentVariants(contentId, body, config, { validate: true }) as ParsedContent[]

    try {
      await runtime.parsedCache.setItem(storageId, { parsed, hash })
    } catch (error) {
      if (import.meta.dev) {
        console.warn(`[content] Failed to cache parsed content for "${storageId}"`, error)
      }
    }

    return parsed
  })
}

const loadContents = async (event: H3Event, prefix?: string) => {
  const keys = await getContentsIds(event, prefix)
  const contents: ParsedContent[] = []

  for (const chunk of [...chunksFromArray(keys, 10)]) {
    const result = await Promise.all(chunk.map(key => loadContentVariants(event, key)))
    contents.push(...result.flat())
  }

  const filtered = contents.filter(document => document && document._path)
  if (shouldValidateAtRuntime) {
    const outcome = validateContentGraph(filtered, contentConfig())
    if (!outcome.ok) {
      throw outcome.error
    }
  }

  return filtered
}

export const getContentsList = (event: H3Event, prefix?: string) => {
  const runtime = getContentStorageRuntime(event)
  const cacheKey = JSON.stringify({
    prefix,
    sources: runtime.config.sources,
    collections: runtime.config.collections,
    defaultLocale: runtime.config.defaultLocale,
    locales: runtime.config.locales,
    translatedSlugs: runtime.config.translatedSlugs,
    strictTranslatedSlugs: runtime.config.strictTranslatedSlugs
  })

  return memoizeRuntimeValue(event, `contents:${cacheKey}`, async () => {
    const cached = getCachedContents(event, cacheKey)
    if ((isPrerendering || !isProduction) && cached?.length) {
      return cached
  }

  return await cacheStoreFor(event).inflightContentsList.run(cacheKey, async () => {
    const result = await loadContents(event, prefix)
    if (isPrerendering || !isProduction) {
      setCachedContents(event, cacheKey, result)
    }
    return result
  })
  })
}

export const getContent = async (event: H3Event, id: string): Promise<ParsedContent> => {
  const { sourceId, locale } = splitInlineLocaleVariantId(id)
  const parsed = await loadContentVariants(event, sourceId)
  if (!locale) {
    return parsed[0] as ParsedContent
  }

  const match = parsed.find(document => document._locale === locale)
  if (!match) {
    console.warn(`[content] Locale variant "${locale}" not found for "${sourceId}", falling back to default`)
  }

  return match || parsed[0] as ParsedContent
}
