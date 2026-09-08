import { toValue, type MaybeRefOrGetter } from 'vue'
import { useRoute, useRouter } from '#imports'
import type { UseContentPageReturn } from './use-content-page'
import { pageMatchesRoute } from './use-content-shared'
import { getContentRuntime } from './runtime'

/** The existing page result supplies the facts; no shared state or second query. */
export type ContentLocalePage = Pick<UseContentPageReturn<unknown>, 'page' | 'status'>

export interface UseContentLocalePathOptions<L extends string = string> {
  /** Used only when the source is undefined (an application-only page). */
  fallback?: (locale: L) => string | undefined
}

/** Derive interactive locale links from a page result supplied by its owner. */
export function useContentLocalePath<L extends string = string>(
  source: MaybeRefOrGetter<ContentLocalePage | undefined>,
  options: UseContentLocalePathOptions<L> = {}
): (locale: L) => string | undefined {
  const route = useRoute()
  const router = useRouter()
  const runtime = getContentRuntime()

  return (locale) => {
    const result = toValue(source)
    if (!result) return runtime.locales?.includes(locale) ? options.fallback?.(locale) : undefined
    if (result.status.value !== 'success') return undefined

    const document = result.page.value
    if (!document || !pageMatchesRoute(document, route.path)) return undefined
    const alternates = document.route.alternates
    const alternate = alternates.find(item => item.locale === locale && item.source === 'variant') ??
      alternates.find(item => item.locale === locale)
    if (!alternate) return undefined

    return router.resolve({ path: alternate.path, query: route.query, hash: route.hash }).fullPath
  }
}
