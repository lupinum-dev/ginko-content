import { computed, shallowRef, toValue, watch } from 'vue'
import type { ComputedRef, MaybeRefOrGetter } from 'vue'
import { useAsyncData, useRoute } from '#imports'
import type {
  ContentCollectionTarget,
  DocumentFromHandle,
  LocaleFallback,
  LocalizedDoc,
  OneOptions,
  PopulateSpec,
  PopulatedDocument,
  ResolvedContentNavigationItem,
  SurroundOptions
} from '../../../types/query'
import { resolveCollectionI18n } from '../../../features/localization/path'
import { one, surround } from './query-api'
import { getContentRuntime } from './runtime'
import { contentCollectionName, resolveLocaleFromRoutePath, resolveOptions, stableKey, type Reactive } from './use-content-shared'

type DocFromHandle<H> = DocumentFromHandle<H>

type ContentPageSurroundOptions<H> =
  | boolean
  | Omit<SurroundOptions<H>, 'by' | 'locale' | 'fallback'>

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
   * Load previous/next items alongside the page via the `surround()` verb.
   *
   * Pass `true` for the default surround projection, or an options object to
   * choose a `select` projection. Omitting `surround` performs one request;
   * enabling it performs one documented extra request.
   */
  surround?: ContentPageSurroundOptions<H>
}

export type ContentPageStatus = 'pending' | 'success' | 'not-found' | 'error'

export interface UseContentPageReturn<T> {
  /** The current route's document, or `null` while absent. Read `status` to distinguish why. */
  page: ComputedRef<LocalizedDoc<T> | null>
  previous: ComputedRef<ResolvedContentNavigationItem<T> | null>
  next: ComputedRef<ResolvedContentNavigationItem<T> | null>
  /** Explicit route state; unlike Nuxt's async-data status, this distinguishes a settled miss. */
  status: ComputedRef<ContentPageStatus>
  error: ComputedRef<unknown>
  refresh: () => Promise<void>
}

const normalizeRoutePath = (path: unknown) => {
  if (typeof path !== 'string') return undefined
  const normalized = path.replace(/\/+$/, '')
  return normalized || '/'
}

const normalizePageSurround = <H>(surroundOption: ContentPageSurroundOptions<H> | undefined) => {
  if (!surroundOption) return undefined
  return surroundOption === true ? {} : surroundOption
}

/**
 * A resolved page "matches" the current route when either the exact
 * selector the app queried with (`route.requestedPath`) or the document's
 * own canonical public path (`route.resolvedPath`) equals the current route
 * — the first covers a provider/alias match whose canonical path differs
 * from the requested one, the
 * second covers static/prerendered routes served under a normalized path.
 */
const pageMatchesRoute = (
  doc: { route?: { requestedPath?: string, resolvedPath?: string } } | null | undefined,
  path: string
) => {
  if (!doc?.route) return false
  const normalizedPath = normalizeRoutePath(path)
  return normalizeRoutePath(doc.route.requestedPath) === normalizedPath ||
    normalizeRoutePath(doc.route.resolvedPath) === normalizedPath
}

/**
 * The route-aware Nuxt application workflow. It owns:
 *
 * - current route and locale tracking;
 * - SSR payload integration and stable async-data keying;
 * - route-watch behavior;
 * - suppression of stale-page flashes during client-side navigation;
 * - returning the resolved page facts (`page.value.route`/`.resolution`).
 *
 * It does not throw a default 404, has no `notFound` option, does not
 * mutate head tags, and does not choose redirect or fallback-indexing
 * policy — the application decides those by reading
 * `page.value.route.requestedPath`/`.resolvedPath` and
 * `page.value.resolution.usedFallback`.
 */
export async function useContentPage<
  const H extends ContentCollectionTarget,
  P extends PopulateSpec | undefined = undefined
>(
  handle: H,
  options: UseContentPageOptions<H, P> = {} as UseContentPageOptions<H, P>
): Promise<UseContentPageReturn<PopulatedDocument<DocFromHandle<H>, P>>> {
  const route = useRoute()
  const { surround: surroundOption, ...oneOptions } = options as UseContentPageOptions<H, P> & Record<string, unknown>
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

  type Doc = PopulatedDocument<DocFromHandle<H>, P>

  const resolvedPageOptions = computed(() => resolveOptions({
    ...oneOptions,
    locale: activeLocale.value,
    by: routeSelector
  } as Reactive<Record<string, unknown>>) as unknown as OneOptions<H, P>)
  const pageKey = computed(() => stableKey('content-page', contentCollectionName(handle), resolvedPageOptions.value))
  const pageAsyncPromise = useAsyncData<LocalizedDoc<Doc> | null>(
    pageKey,
    () => one(handle, resolvedPageOptions.value) as Promise<LocalizedDoc<Doc> | null>,
    { watch: [resolvedPageOptions], default: () => null }
  )

  const surroundNormalized = normalizePageSurround(surroundOption)
  const resolvedSurroundOptions = computed(() => resolveOptions({
    ...(surroundNormalized || {}),
    locale: activeLocale.value,
    ...('fallback' in oneOptions ? { fallback: oneOptions.fallback as LocaleFallback } : {}),
    by: routeSelector
  } as Reactive<Record<string, unknown>>) as unknown as SurroundOptions<H>)
  const surroundKey = computed(() => stableKey('content-page-surround', contentCollectionName(handle), resolvedSurroundOptions.value))
  const surroundAsyncPromise = surroundNormalized
    ? useAsyncData(
        surroundKey,
        () => surround(handle, resolvedSurroundOptions.value),
        { watch: [resolvedSurroundOptions], default: () => ({ previous: null, next: null }) }
      )
    : undefined

  const pageAsync = await pageAsyncPromise
  const surroundAsync = surroundAsyncPromise ? await surroundAsyncPromise : undefined

  // Keep the last response long enough to suppress stale content while a
  // route change starts its next request.
  const rawPage = shallowRef<LocalizedDoc<Doc> | null>(pageAsync.data.value)
  watch(pageAsync.data, (value) => {
    rawPage.value = value
  })

  const page = computed(() => {
    const current = rawPage.value
    return pageMatchesRoute(current, route.path) ? (current as LocalizedDoc<Doc>) : null
  })

  const error = computed(() => pageAsync.error.value ?? surroundAsync?.error.value ?? undefined)
  const status = computed<ContentPageStatus>(() => {
    if (error.value) return 'error'
    if (page.value) return 'success'
    if (rawPage.value && !pageMatchesRoute(rawPage.value, route.path)) return 'pending'
    if (pageAsync.status.value === 'pending' || pageAsync.status.value === 'idle') return 'pending'
    return 'not-found'
  })

  const previous = computed(() => {
    if (!page.value || !surroundAsync) return null
    return (surroundAsync.data.value?.previous ?? null) as ResolvedContentNavigationItem<Doc> | null
  })
  const next = computed(() => {
    if (!page.value || !surroundAsync) return null
    return (surroundAsync.data.value?.next ?? null) as ResolvedContentNavigationItem<Doc> | null
  })

  return {
    page,
    previous,
    next,
    status,
    error,
    refresh: async () => {
      await pageAsync.refresh()
      if (surroundAsync) await surroundAsync.refresh()
    }
  }
}
