import type { H3Event } from 'h3'
import type { ContentQueryBuilderParams } from '../types/query'
import type { ContentQueryFindOneResponse, ContentQueryFindResponse, ContentQueryResponse } from '../types/api'
import type { ParsedContent } from '../types/content'
import { collectMarkdownRefLinks, parseRefLink } from '../core/references/resolve'
import { projectContentPathToLocale } from '../features/localization/path'
import { contentConfig } from './driver'
import { resolveCanonicalKey, resolveVariant } from './manifest'

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

const resolveDocumentRefLinks = async (event: H3Event, content: ParsedContent, requestedLocale?: string) => {
  if (!content || content.type !== 'markdown' || !content.body) {
    return undefined
  }

  const hrefs = collectMarkdownRefLinks(content.body)
  if (!hrefs.length) {
    return undefined
  }

  const entries = await Promise.all(hrefs.map(async (href) => {
    const parsed = parseRefLink(href)
    if (!parsed) {
      return null
    }

    const canonicalKey = await resolveCanonicalKey(event, parsed.ref)
    if (!canonicalKey) {
      if (isConfiguredQuickLink(href)) {
        return [href, href] as const
      }

      if (import.meta.dev) {
        console.warn(`[content] Could not resolve markdown ref "${href}" in "${content.file?.path || content.id}"`)
      }

      return [href, href] as const
    }

    const variant = await resolveVariant(event, canonicalKey, requestedLocale)
    if (!variant?.path) {
      if (import.meta.dev) {
        console.warn(`[content] Could not resolve markdown ref "${href}" in "${content.file?.path || content.id}"`)
      }

      return [href, href] as const
    }

    if (import.meta.dev && requestedLocale && variant.resolvedLocale && variant.resolvedLocale !== requestedLocale) {
      console.warn(`[content] Markdown ref "${href}" in "${content.file?.path || content.id}" fell back from locale "${requestedLocale}" to "${variant.resolvedLocale}"`)
    }

    const routeLocale = variant.fallback && requestedLocale
      ? requestedLocale
      : variant.resolvedLocale
    return [href, `${projectContentPathToLocale(variant.path, routeLocale, contentConfig().defaultLocale)}${parsed.hash}`] as const
  }))

  const resolvedRefs = Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry)))
  return Object.keys(resolvedRefs).length ? resolvedRefs : undefined
}

export const withResolvedRefs = async <T> (event: H3Event, content: T, requestedLocale?: string): Promise<T> => {
  if (!content || Array.isArray(content)) {
    return content
  }

  const resolvedRefs = await resolveDocumentRefLinks(event, content as unknown as ParsedContent, requestedLocale)
  if (!resolvedRefs) {
    return content
  }

  return {
    ...(content as Record<string, unknown>),
    _resolvedRefs: resolvedRefs
  } as T
}

export const withResolvedRefsList = async <T> (event: H3Event, items: T[], requestedLocale?: string): Promise<T[]> => {
  return await Promise.all(items.map(item => withResolvedRefs(event, item, requestedLocale)))
}

export const withResolvedRefsQueryResponse = async <T> (
  event: H3Event,
  response: ContentQueryResponse<T>,
  params: ContentQueryBuilderParams
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
