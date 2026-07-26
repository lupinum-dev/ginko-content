import type { H3Event } from 'h3'
import type { ContentProviderQueryInput } from '../types/query'
import type {
  ContentQueryFindOneResponse,
  ContentQueryFindResponse,
  ContentQueryResponse
} from '../types/api'
import type { ParsedContent } from '../types/content'
import { collectMarkdownRefLinks, parseRefLink } from '../core/references/resolve'
import { projectContentRoute } from '../features/localization/route-projector'
import { resolveRuntimeCollectionLocalePolicy } from '../features/localization/config'
import { contentConfig } from './driver'
import { getContentGraph, resolveCanonicalKey, resolveVariant } from './graph'

const isConfiguredQuickLink = (href: string) => {
  const parsed = parseRefLink(href)
  if (!parsed) {
    return false
  }

  const separator = parsed.ref.indexOf('.')
  if (separator <= 0 || separator === parsed.ref.length - 1) {
    return false
  }

  const namespace = parsed.ref.slice(0, separator)
  const key = parsed.ref.slice(separator + 1)
  const links = (contentConfig() as { links?: Record<string, Record<string, unknown>> }).links
  return Boolean(links?.[namespace]?.[key])
}

const resolveReferenceTarget = async (
  event: H3Event,
  identity: string,
  collections: Record<string, unknown>
): Promise<{ canonicalKey: string, collection?: string } | null> => {
  const canonicalKey = await resolveCanonicalKey(event, identity)
  if (canonicalKey) {
    return { canonicalKey }
  }

  const scopedMatches = (await Promise.all(
    Object.keys(collections).map(async collection => {
      const scopedCanonicalKey = await resolveCanonicalKey(event, identity, collection)
      return scopedCanonicalKey
        ? { canonicalKey: scopedCanonicalKey, collection }
        : null
    })
  )).filter((match): match is { canonicalKey: string, collection: string } => Boolean(match))

  return scopedMatches.length === 1 ? scopedMatches[0] : null
}

const resolveDocumentRefLinks = async (
  event: H3Event,
  content: ParsedContent,
  requestedLocale?: string
) => {
  if (!content || content.type !== 'markdown' || !content.body) {
    return undefined
  }

  const hrefs = collectMarkdownRefLinks(content.body)
  if (!hrefs.length) {
    return undefined
  }

  const config = contentConfig()
  const graph = await getContentGraph(event)
  const entries = await Promise.all(
    hrefs.map(async href => {
      const parsed = parseRefLink(href)
      if (!parsed) {
        return null
      }

      const target = await resolveReferenceTarget(event, parsed.ref, config.collections || {})
      if (!target) {
        if (isConfiguredQuickLink(href)) {
          return [href, href] as const
        }

        if (import.meta.dev) {
          console.warn(
            `[content] Could not resolve markdown ref "${href}" in "${content.file?.path || content.id}"`
          )
        }

        return [href, href] as const
      }

      const variant = await resolveVariant(event, target.canonicalKey, requestedLocale, {
        collection: target.collection
      })
      if (!variant?.path) {
        if (import.meta.dev) {
          console.warn(
            `[content] Could not resolve markdown ref "${href}" in "${content.file?.path || content.id}"`
          )
        }

        return [href, href] as const
      }

      if (
        import.meta.dev &&
        requestedLocale &&
        variant.resolvedLocale &&
        variant.resolvedLocale !== requestedLocale
      ) {
        console.warn(
          `[content] Markdown ref "${href}" in "${content.file?.path || content.id}" fell back from locale "${requestedLocale}" to "${variant.resolvedLocale}"`
        )
      }

      const routeLocale =
        variant.fallback && requestedLocale ? requestedLocale : variant.resolvedLocale
      const targetCollection = graph.byId[variant.contentId]?.collection
      const targetPolicy = targetCollection
        ? resolveRuntimeCollectionLocalePolicy(targetCollection, config)
        : undefined
      if (!targetPolicy) {
        throw new Error(`Missing resolved locale policy for content collection "${targetCollection || ''}".`)
      }
      return [
        href,
        `${projectContentRoute({
          contentPath: variant.path,
          locale: routeLocale || targetPolicy.defaultLocale
        }, targetPolicy)}${parsed.hash}`
      ] as const
    })
  )

  const resolvedRefs = Object.fromEntries(
    entries.filter((entry): entry is readonly [string, string] => Boolean(entry))
  )
  return Object.keys(resolvedRefs).length ? resolvedRefs : undefined
}

export const withResolvedRefs = async <T>(
  event: H3Event,
  content: T,
  requestedLocale?: string
): Promise<T> => {
  if (!content || Array.isArray(content)) {
    return content
  }

  const resolvedRefs = await resolveDocumentRefLinks(
    event,
    content as unknown as ParsedContent,
    requestedLocale
  )
  if (!resolvedRefs) {
    return content
  }

  const existingResolution = (content as unknown as ParsedContent).resolved
  return {
    ...(content as Record<string, unknown>),
    resolved: {
      ...(existingResolution || {}),
      resolvedRefs
    }
  } as T
}

export const withResolvedRefsList = async <T>(
  event: H3Event,
  items: T[],
  requestedLocale?: string
): Promise<T[]> => {
  return await Promise.all(items.map(item => withResolvedRefs(event, item, requestedLocale)))
}

export const withResolvedRefsQueryResponse = async <T>(
  event: H3Event,
  response: ContentQueryResponse<T>,
  params: ContentProviderQueryInput
): Promise<ContentQueryResponse<T>> => {
  if (typeof response.result === 'number') {
    return response
  }

  const requestedLocale = params.resolveLocale?.locale

  if (params.first) {
    const firstResponse = response as ContentQueryFindOneResponse<T>
    return {
      ...firstResponse,
      result: await withResolvedRefs(event, firstResponse.result, requestedLocale)
    }
  }

  if (!Array.isArray(response.result)) {
    return response
  }

  const listResponse = response as ContentQueryFindResponse<T>
  return {
    ...listResponse,
    result: await withResolvedRefsList(event, listResponse.result, requestedLocale)
  }
}
