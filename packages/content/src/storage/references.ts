import type { H3Event } from 'h3'
import type { ContentQueryBuilderParams } from '../types/query'
import type { ContentQueryResponse } from '../types/api'
import type { ParsedContent } from '../types/content'
import { collectMarkdownRefLinks, parseRefLink } from '../core/references/resolve'
import { contentConfig } from './driver'
import { getContentManifest, resolveVariant } from './manifest'

const prefixLocaleRoute = (path: string, locale?: string) => {
  const defaultLocale = contentConfig().defaultLocale

  if (!locale || locale === defaultLocale) {
    return path
  }

  return path === '/' ? `/${locale}` : `/${locale}${path}`
}

const resolveDocumentRefLinks = async (event: H3Event, content: ParsedContent, requestedLocale?: string) => {
  if (!content || content._type !== 'markdown' || !content.body) {
    return undefined
  }

  const hrefs = collectMarkdownRefLinks(content.body)
  if (!hrefs.length) {
    return undefined
  }

  const manifest = await getContentManifest(event)
  const entries = await Promise.all(hrefs.map(async (href) => {
    const parsed = parseRefLink(href)
    if (!parsed) {
      return null
    }

    const canonicalKey = manifest.byRef[parsed.ref]
    if (!canonicalKey) {
      if (import.meta.dev) {
        console.warn(`[content] Could not resolve markdown ref "${href}" in "${content._file || content._id}"`)
      }

      return [href, href] as const
    }

    const variant = await resolveVariant(event, canonicalKey, requestedLocale)
    if (!variant?.path) {
      if (import.meta.dev) {
        console.warn(`[content] Could not resolve markdown ref "${href}" in "${content._file || content._id}"`)
      }

      return [href, href] as const
    }

    if (import.meta.dev && requestedLocale && variant.resolvedLocale && variant.resolvedLocale !== requestedLocale) {
      console.warn(`[content] Markdown ref "${href}" in "${content._file || content._id}" fell back from locale "${requestedLocale}" to "${variant.resolvedLocale}"`)
    }

    return [href, `${prefixLocaleRoute(variant.path, variant.resolvedLocale)}${parsed.hash}`] as const
  }))

  const resolvedRefs = Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry)))
  return Object.keys(resolvedRefs).length ? resolvedRefs : undefined
}

export const withResolvedRefs = async <T> (event: H3Event, content: T, requestedLocale?: string): Promise<T> => {
  if (!content || Array.isArray(content)) {
    return content
  }

  const resolvedRefs = await resolveDocumentRefLinks(event, content as ParsedContent, requestedLocale)
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
) => {
  if (typeof response.result === 'number') {
    return response
  }

  const requestedLocale = params.resolveLocale?.locale

  if (params.first) {
    return {
      ...response,
      result: await withResolvedRefs(event, response.result, requestedLocale)
    }
  }

  return {
    ...response,
    result: Array.isArray(response.result)
      ? await withResolvedRefsList(event, response.result, requestedLocale)
      : response.result
  }
}
