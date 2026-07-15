import { hash as ohash } from 'ohash'
import type { H3Event } from 'h3'
import type { MissingDocument, ParsedContent } from '../types/content'
import type { ContentCacheArtifact } from '../types/runtime'
import { isRealDocument } from '../core/content/document'
import { splitInlineLocaleVariantId } from '../core/content/locale'
import { memoizeRuntimeValue } from '../integrations/nitro/context'
import { parseContentVariants } from '../integrations/nitro/ingest'
import { cacheStoreFor } from './cache'
import { contentConfig, contentIgnorePredicate, getContentStorageRuntime, getContentsIds, resolveStorageId } from './driver'
import { getProcessDocuments, usesProcessSnapshot } from './snapshot-runtime'
import { validateContentGraph } from './validation'

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
 *  1. Dev/prerender validate source metadata before reusing an artifact.
 *  2. Concurrent misses for the same `(storageId, hash)` share one parse.
 */
export const loadContentVariants = async (event: H3Event, id: string): Promise<Array<ParsedContent | MissingDocument>> => {
  const runtime = getContentStorageRuntime(event)
  const config = contentConfig()
  const { sourceId: contentId } = splitInlineLocaleVariantId(id)
  if (!contentIgnorePredicate(contentId)) {
    return [{ id: contentId, body: null, missing: true }]
  }

  const storageId = await resolveStorageId(event, contentId)
  const cachedValue = await runtime.parsedCache.getItem<unknown>(storageId)
  const cached = isContentCacheArtifact(cachedValue) ? cachedValue : null
  const body = await runtime.source.getItem(storageId)
  if (body === null) {
    return [{ id: contentId, body: null, missing: true }]
  }

  const hash = ohash({
    body: ohash(body),
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
  const contents: Array<ParsedContent | MissingDocument> = []

  for (const chunk of [...chunksFromArray(keys, 10)]) {
    const result = await Promise.all(chunk.map(key => loadContentVariants(event, key)))
    contents.push(...result.flat())
  }

  // Do not additionally require a truthy `document.path`: a valid `type:
  // 'data'` document legitimately has no route, and the production build
  // (`integrations/nitro/build.ts`, VNEXT §14.3) keeps pathless documents in
  // its snapshot rather than treating "has a route path" as the content-set
  // inclusion test. Dev must include the same document set as production.
  const filtered = contents.filter(isRealDocument)
  if (shouldValidateAtRuntime) {
    const outcome = validateContentGraph(filtered, contentConfig())
    if (!outcome.ok) {
      throw outcome.error
    }
  }

  return filtered
}

const snapshotDocumentsFor = async (event: H3Event, prefix?: string) => {
  const documents = await getProcessDocuments(event)
  if (!prefix) {
    return documents
  }

  return documents.filter((document) => {
    const { sourceId } = splitInlineLocaleVariantId(document.id)
    return sourceId.startsWith(prefix)
  })
}

export const getContentsList = (event: H3Event, prefix?: string) => {
  if (usesProcessSnapshot) {
    return snapshotDocumentsFor(event, prefix)
  }

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

  // One request-scoped memo for the complete contents-list load (VNEXT.md
  // 15.7). `memoizeRuntimeValue` already shares one in-flight promise across
  // concurrent callers within a request, so a second single-flight map plus a
  // separate "contents" map here would only duplicate this memoization with
  // no independent invalidation source.
  return memoizeRuntimeValue(event, `contents:${cacheKey}`, () => loadContents(event, prefix))
}

export const getContent = async (event: H3Event, id: string): Promise<ParsedContent> => {
  const { sourceId, locale } = splitInlineLocaleVariantId(id)
  const parsed = usesProcessSnapshot
    ? (await getProcessDocuments(event)).filter(document => splitInlineLocaleVariantId(document.id).sourceId === sourceId)
    : (await loadContentVariants(event, sourceId)).filter(isRealDocument)
  if (!locale) {
    return parsed[0] as ParsedContent
  }

  const match = parsed.find(document => document.locale === locale)
  if (!match) {
    console.warn(`[content] Locale variant "${locale}" not found for "${sourceId}", falling back to default`)
  }

  return match || parsed[0] as ParsedContent
}
