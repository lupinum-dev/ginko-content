import { computed, shallowRef, toValue, watch } from 'vue'
import type { ComputedRef, MaybeRefOrGetter } from 'vue'
import { createError, useRoute } from '#imports'
import type {
  ContentCollectionTarget,
  ContentRouteMeta,
  ContentTreeItem,
  DocumentFromHandle,
  LocaleFallback,
  LocalizedDoc,
  NeighborsOptions,
  OneOptions,
  PopulateSpec,
  PopulatedDocument
} from '../../../types/query'
import { resolveCollectionI18n } from '../../../features/localization/path'
import { useContentRoute } from './route'
import { getContentRuntime } from './runtime'
import { contentCollectionName, resolveLocaleFromRoutePath, type Reactive } from './use-content-shared'
import { useContentOne } from './use-content-document'
import { useContentNeighbors } from './use-content-navigation'

type DocFromHandle<H> = DocumentFromHandle<H>

type ContentPageSurroundOptions<H> =
  | boolean
  | Omit<NeighborsOptions<H>, 'by' | 'locale' | 'fallback'>

type ContentPageOneOptions<
  H,
  P extends PopulateSpec | undefined
> = Omit<OneOptions<H, P>, 'by' | 'locale' | 'fallback'> & {
  /**
   * Optional locale override. Route pages may omit this even for typed i18n
   * handles because the route selector is the source of truth for the active
   * public URL.
   */
  locale?: string
  fallback?: LocaleFallback
}

export type UseContentPageOptions<
  H = unknown,
  P extends PopulateSpec | undefined = undefined
> = Reactive<ContentPageOneOptions<H, P>> & {
  /**
   * Load previous/next items alongside the page.
   *
   * Pass `true` for the default surround query, or an options object to choose
   * fields. The page query remains one request unless this is enabled.
   */
  surround?: ContentPageSurroundOptions<H>
  /**
   * Override the error raised when the current route does not resolve to a
   * content page. Set `false` to render a local empty/not-found state.
   */
  notFound?: false | (() => Parameters<typeof createError>[0])
}

interface UseContentPageReturn<T> {
  data: ComputedRef<LocalizedDoc<T> | undefined>
  page: ComputedRef<LocalizedDoc<T> | undefined>
  previous: ComputedRef<ContentTreeItem<T> | null>
  next: ComputedRef<ContentTreeItem<T> | null>
  surround: ComputedRef<Array<ContentTreeItem<T>>>
  pending: ComputedRef<boolean>
  status: ComputedRef<string>
  error: ComputedRef<unknown>
  refresh: () => Promise<void>
}

const defaultPageNotFound = () => createError({
  statusCode: 404,
  statusMessage: 'Page not found',
  fatal: true
})

const normalizePageNotFound = (
  notFound: UseContentPageOptions['notFound']
) => {
  if (notFound === false) return undefined
  return createError(notFound ? notFound() : defaultPageNotFound())
}

const normalizePageSurround = <H>(surround: ContentPageSurroundOptions<H> | undefined) => {
  if (!surround) return undefined
  return surround === true ? {} : surround
}

const normalizeRoutePath = (path: unknown) => {
  if (typeof path !== 'string') return undefined
  const normalized = path.replace(/\/+$/, '')
  return normalized || '/'
}

const localePathMatches = (entry: unknown, path: string) => {
  const normalizedPath = normalizeRoutePath(path)
  if (typeof entry === 'string') return normalizeRoutePath(entry) === normalizedPath
  return Boolean(entry && typeof entry === 'object' && 'path' in entry && normalizeRoutePath((entry as { path?: unknown }).path) === normalizedPath)
}

const routeMetaMatchesPath = (value: ContentRouteMeta | null | undefined, path: string) => {
  if (!value) return false
  const normalizedPath = normalizeRoutePath(path)
  const legacyPath = (value as {
    path?: unknown
    _requestedPath?: unknown
    _requestedRoute?: unknown
  })
  if (
    normalizeRoutePath(legacyPath.path) === normalizedPath ||
    normalizeRoutePath(legacyPath._requestedPath) === normalizedPath ||
    normalizeRoutePath(legacyPath._requestedRoute) === normalizedPath
  ) return true
  const requestedRoute = (value as {
    _requestedRoute?: unknown
    resolved?: { requestedRoute?: unknown }
  }).resolved?.requestedRoute ?? (value as { _requestedRoute?: unknown })._requestedRoute
  return normalizeRoutePath(value.path) === normalizedPath ||
    normalizeRoutePath(value.canonicalPath) === normalizedPath ||
    normalizeRoutePath(requestedRoute) === normalizedPath ||
    Object.values(value.localePaths || {}).some(entry => localePathMatches(entry, path))
}

/**
 * Ergonomic route-page helper. This is the product-level default for Nuxt page
 * components; the explicit `useContentOne` selector remains the lower-level
 * primitive for custom reads.
 */
export async function useContentPage<
  const H extends ContentCollectionTarget,
  P extends PopulateSpec | undefined = undefined
>(
  handle: H,
  options: UseContentPageOptions<H, P> = {} as UseContentPageOptions<H, P>
): Promise<UseContentPageReturn<PopulatedDocument<DocFromHandle<H>, P>>> {
  const route = useRoute()
  const isBrowser = import.meta.client && typeof window !== 'undefined'
  const { notFound, surround, ...oneOptions } = options as UseContentPageOptions<H, P> & Record<string, unknown>
  const routeSelector = { route: () => normalizeRoutePath(route.path) }
  const runtime = getContentRuntime()
  const collectionI18n = resolveCollectionI18n(contentCollectionName(handle), runtime)
  const activeLocale = computed(() => {
    const explicitLocale = toValue(oneOptions.locale as MaybeRefOrGetter<string | undefined>)
    if (explicitLocale) {
      return explicitLocale
    }

    const { locales, defaultLocale } = collectionI18n
    if (!locales.length && !defaultLocale) {
      return undefined
    }

    return resolveLocaleFromRoutePath(route.path, locales, defaultLocale)
  })
  const rawPage = shallowRef<LocalizedDoc<PopulatedDocument<DocFromHandle<H>, P>> | null>(null)
  const resolvingRoute = shallowRef(false)
  const sawRouteQueryPending = shallowRef(false)
  const page = computed(() => {
    const current = rawPage.value
    return routeMetaMatchesPath(current, route.path)
      ? current as LocalizedDoc<PopulatedDocument<DocFromHandle<H>, P>>
      : undefined
  })

  useContentRoute(page)

  const pageResultPromise = useContentOne(handle, {
    ...oneOptions,
    locale: () => activeLocale.value,
    by: routeSelector
  } as Reactive<OneOptions<H, P>>)
  const surroundOptions = normalizePageSurround(surround)
  const surroundResultPromise = surroundOptions
    ? useContentNeighbors(handle, {
        ...surroundOptions,
        locale: () => activeLocale.value,
        ...('fallback' in oneOptions ? { fallback: oneOptions.fallback as LocaleFallback } : {}),
        by: routeSelector
      } as Reactive<NeighborsOptions<H>>)
    : undefined
  const pageResult = await pageResultPromise
  rawPage.value = pageResult.data.value as LocalizedDoc<PopulatedDocument<DocFromHandle<H>, P>> | null
  if (isBrowser && rawPage.value && !routeMetaMatchesPath(rawPage.value, route.path)) {
    resolvingRoute.value = true
  }

  watch(() => route.path, () => {
    resolvingRoute.value = true
    sawRouteQueryPending.value = false
  }, { flush: 'sync' })

  watch(pageResult.data, (value) => {
    rawPage.value = value as LocalizedDoc<PopulatedDocument<DocFromHandle<H>, P>> | null
    const resolved = value as LocalizedDoc<PopulatedDocument<DocFromHandle<H>, P>> | null
    if (resolved && routeMetaMatchesPath(resolved, route.path)) {
      resolvingRoute.value = false
    }
  })
  watch(() => pageResult.pending.value, (pending) => {
    if (pending) {
      sawRouteQueryPending.value = true
      return
    }
    if (sawRouteQueryPending.value) {
      const resolved = pageResult.data.value as LocalizedDoc<PopulatedDocument<DocFromHandle<H>, P>> | null
      if (!resolved || routeMetaMatchesPath(resolved, route.path)) {
        resolvingRoute.value = false
      }
    }
  })
  const surroundResult = surroundResultPromise ? await surroundResultPromise : undefined

  const pending = computed(() => pageResult.pending.value || Boolean(surroundResult?.pending.value))
  const pageError = computed(() => {
    if (pageResult.error.value) return pageResult.error.value
    if (surroundResult?.error.value) return surroundResult.error.value
    if (pending.value || resolvingRoute.value || page.value || notFound === false) return undefined
    return normalizePageNotFound(notFound)
  })

  if (!isBrowser && pageError.value) {
    throw pageError.value
  }

  const previous = computed(() => {
    if (!page.value || !surroundResult) return null
    return surroundResult.data.value.prev as ContentTreeItem<PopulatedDocument<DocFromHandle<H>, P>> | null
  })
  const next = computed(() => {
    if (!page.value || !surroundResult) return null
    return surroundResult.data.value.next as ContentTreeItem<PopulatedDocument<DocFromHandle<H>, P>> | null
  })
  const pageSurround = computed(() => {
    return [previous.value, next.value].filter((item): item is ContentTreeItem<PopulatedDocument<DocFromHandle<H>, P>> => Boolean(item))
  })

  return {
    data: page,
    page,
    surround: pageSurround,
    previous,
    next,
    pending,
    status: computed(() => pageResult.status.value),
    error: pageError,
    refresh: async () => {
      await pageResult.refresh()
      if (surroundResult) await surroundResult.refresh()
    }
  }
}
