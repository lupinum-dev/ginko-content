/**
 * Layer 2 of the unified query API (ADR-0016).
 *
 * Vue composables that wrap the Layer 1 pure async functions in
 * `useAsyncData`. Every option may be a value, a `Ref`, or a getter — the
 * composable resolves them via `toValue` and reruns when sources change.
 *
 * No implicit locale resolution: callers must pass `locale` (or its
 * reactive source) explicitly when the collection is i18n. Use Nuxt i18n's
 * `useI18n().locale` or the host app's chosen reactive locale source.
 */
import { computed, shallowRef, toValue, watch } from 'vue'
import type { ComputedRef, MaybeRefOrGetter } from 'vue'
import { hash } from 'ohash'
import { createError, useAsyncData, useRoute } from '#imports'
import type {
  BacklinksOptions,
  BacklinksResult,
  BacklinkSource,
  ContentCollectionTarget,
  ContentVariant,
  ContentTreeItem,
  ContentResolvedMeta,
  ContentRouteMeta,
  DocumentFromHandle,
  LocalePathEntry,
  LocaleFallback,
  ManyOptions,
  LocalizedDoc,
  NeighborsOptions,
  NeighborsResult,
  OneOptions,
  PopulateSpec,
  PopulateFromOptions,
  PopulatedDocument,
  PaginationOptions,
  PaginationResult,
  ResolveOneOptions,
  ResolveOneResult,
  SortSpec,
  TreeOptions,
  VariantsOptions
} from '../../../types/query'
import { createClientContentQueryContext } from './query-api'
import {
  backlinks as backlinksWithContext,
  many as manyWithContext,
  neighbors as neighborsWithContext,
  one as oneWithContext,
  paginate as paginateWithContext,
  resolveOne as resolveOneWithContext,
  tree as treeWithContext,
  variants as variantsWithContext
} from '../../query/unified'
import { useContentRoute } from './route'

// Each top-level option may be a value, a Ref, or a getter. Object-valued
// options (like `by` and `where`) recurse one level so callers can write
// `by: { path: () => route.path }` — the runtime unwrapDeep handles the
// rest. Primitive values (strings, numbers, booleans) only get the
// MaybeRefOrGetter wrapper at the option level itself.
type ReactiveLeaf<T> = T | MaybeRefOrGetter<T>
// We recurse for any object-shaped option (excluding arrays and functions)
// so `by` and `where` nested keys can take refs or getters individually.
type ReactiveValue<V> = V extends ((...args: never[]) => unknown) | readonly unknown[]
  ? ReactiveLeaf<V>
  : V extends object | undefined
    ? ReactiveLeaf<V> | { [P in keyof NonNullable<V>]?: ReactiveLeaf<NonNullable<V>[P]> }
    : ReactiveLeaf<V>
type Reactive<T> = {
  [K in keyof T]: ReactiveValue<T[K]>
}

/**
 * Recursively unwrap any `Ref` / getter found in a reactive options object.
 * `by: { path: () => route.path }` is the canonical use case: the
 * top-level `by` key is a plain object, but its inner `path` is a getter
 * that has to be evaluated each time the source ref changes. Walking the
 * tree (with cycle protection via a Set) keeps the option shape ergonomic
 * without forcing the caller to pre-resolve.
 */
const unwrapDeep = (value: unknown, seen = new WeakSet<object>()): unknown => {
  if (value === null || value === undefined) return value
  // Refs and getters: read once.
  if (typeof value === 'function') return unwrapDeep(toValue(value as MaybeRefOrGetter<unknown>), seen)
  if (typeof value === 'object' && '__v_isRef' in (value as object)) {
    return unwrapDeep(toValue(value as MaybeRefOrGetter<unknown>), seen)
  }
  // Arrays: map.
  if (Array.isArray(value)) return value.map(item => unwrapDeep(item, seen))
  // Plain objects (skip RegExp / Date / class instances).
  if (typeof value === 'object' && value.constructor === Object) {
    if (seen.has(value as object)) return value
    seen.add(value as object)
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = unwrapDeep(v, seen)
    }
    return out
  }
  return value
}

const resolveOptions = <T extends Record<string, unknown>>(reactive: Reactive<T>): T => {
  return unwrapDeep(reactive) as T
}

const stableKey = (prefix: string, name: string, options: unknown) => `${prefix}:${name}:${hash(options)}`

type DocFromHandle<H> = DocumentFromHandle<H>

interface UseContentOneReturn<T> {
  data: ComputedRef<LocalizedDoc<T> | null>
  pending: ComputedRef<boolean>
  status: ComputedRef<string>
  error: ComputedRef<unknown>
  refresh: () => Promise<void>
}

/**
 * Reactively resolve a single document. Reruns when any reactive source on
 * `options` changes. Caching follows Nuxt's standard `useAsyncData` semantics
 * keyed by `${collection}:${stableHash(options)}`.
 */
export async function useContentOne<
  const H extends ContentCollectionTarget,
  O extends OneOptions<H, PopulateSpec | undefined>
> (
  handle: H,
  options: Reactive<O>
): Promise<UseContentOneReturn<PopulatedDocument<DocFromHandle<H>, PopulateFromOptions<O>>>> {
  const resolved = computed(() => resolveOptions(options as Reactive<Record<string, unknown>>) as O)
  const key = computed(() => stableKey('content-one', typeof handle === 'string' ? handle : (handle as { name: string }).name, resolved.value))
  const context = createClientContentQueryContext()
  const asyncData = await useAsyncData<LocalizedDoc<PopulatedDocument<DocFromHandle<H>, PopulateFromOptions<O>>> | null>(
    key,
    () => oneWithContext(context, handle, resolved.value) as Promise<LocalizedDoc<PopulatedDocument<DocFromHandle<H>, PopulateFromOptions<O>>> | null>,
    { watch: [resolved], default: () => null }
  )

  return {
    data: computed(() => asyncData.data.value as LocalizedDoc<PopulatedDocument<DocFromHandle<H>, PopulateFromOptions<O>>> | null),
    pending: computed(() => asyncData.pending.value),
    status: computed(() => asyncData.status.value),
    error: computed(() => asyncData.error.value),
    refresh: () => asyncData.refresh()
  }
}

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
  surround: ComputedRef<{
    previous: ContentTreeItem<T> | null
    next: ContentTreeItem<T> | null
  }>
  previous: ComputedRef<ContentTreeItem<T> | null>
  next: ComputedRef<ContentTreeItem<T> | null>
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
    _path?: unknown
    _requestedPath?: unknown
    _requestedRoute?: unknown
  })
  if (
    normalizeRoutePath(legacyPath._path) === normalizedPath ||
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
    by: routeSelector
  } as Reactive<OneOptions<H, P>>)
  const surroundOptions = normalizePageSurround(surround)
  const surroundResultPromise = surroundOptions
    ? useContentNeighbors(handle, {
        ...surroundOptions,
        ...('locale' in oneOptions ? { locale: oneOptions.locale } : {}),
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
  const pageSurround = computed(() => ({
    previous: previous.value,
    next: next.value
  }))

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

interface UseContentResolveOneReturn<T> {
  doc: ComputedRef<LocalizedDoc<T> | null>
  explain: ComputedRef<ResolveOneResult<T>['explain'] | null>
  status: ComputedRef<string>
  error: ComputedRef<unknown>
  refresh: () => Promise<void>
}

/**
 * Reactively resolve a single document with a first-class diagnostic envelope.
 */
export async function useContentResolveOne<
  const H extends ContentCollectionTarget,
  O extends ResolveOneOptions<H, PopulateSpec | undefined>
> (
  handle: H,
  options: Reactive<O>
): Promise<UseContentResolveOneReturn<PopulatedDocument<DocFromHandle<H>, PopulateFromOptions<O>>>> {
  const resolved = computed(() => resolveOptions(options as Reactive<Record<string, unknown>>) as O)
  const key = computed(() => stableKey('content-resolve-one', typeof handle === 'string' ? handle : (handle as { name: string }).name, resolved.value))
  const context = createClientContentQueryContext()
  const asyncData = await useAsyncData<ResolveOneResult<PopulatedDocument<DocFromHandle<H>, PopulateFromOptions<O>>>>(
    key,
    () => resolveOneWithContext(context, handle, resolved.value) as Promise<ResolveOneResult<PopulatedDocument<DocFromHandle<H>, PopulateFromOptions<O>>>>,
    { watch: [resolved] }
  )

  return {
    doc: computed(() => asyncData.data.value?.doc ?? null),
    explain: computed(() => asyncData.data.value?.explain ?? null),
    status: computed(() => asyncData.status.value),
    error: computed(() => asyncData.error.value),
    refresh: () => asyncData.refresh()
  }
}

interface UseContentManyReturn<T> {
  data: ComputedRef<Array<LocalizedDoc<T>>>
  status: ComputedRef<string>
  error: ComputedRef<unknown>
  refresh: () => Promise<void>
}

interface UseContentPaginationReturn<T> {
  data: ComputedRef<Array<LocalizedDoc<T>>>
  page: ComputedRef<number>
  limit: ComputedRef<number>
  total: ComputedRef<number>
  pageCount: ComputedRef<number>
  hasNext: ComputedRef<boolean>
  hasPrev: ComputedRef<boolean>
  nextPage: ComputedRef<number | null>
  prevPage: ComputedRef<number | null>
  status: ComputedRef<string>
  error: ComputedRef<unknown>
  refresh: () => Promise<void>
}

/**
 * Reactively resolve a list of documents.
 */
export async function useContentMany<
  const H extends ContentCollectionTarget,
  O extends ManyOptions<H, PopulateSpec | undefined>
> (
  handle: H,
  options: Reactive<O> = {} as Reactive<O>
): Promise<UseContentManyReturn<PopulatedDocument<DocFromHandle<H>, PopulateFromOptions<O>>>> {
  const resolved = computed(() => resolveOptions(options as Reactive<Record<string, unknown>>) as O)
  const key = computed(() => stableKey('content-many', typeof handle === 'string' ? handle : (handle as { name: string }).name, resolved.value))
  const context = createClientContentQueryContext()
  const asyncData = await useAsyncData<Array<LocalizedDoc<PopulatedDocument<DocFromHandle<H>, PopulateFromOptions<O>>>>>(
    key,
    () => manyWithContext(context, handle, resolved.value) as Promise<Array<LocalizedDoc<PopulatedDocument<DocFromHandle<H>, PopulateFromOptions<O>>>>>,
    { watch: [resolved], default: () => [] }
  )

  return {
    data: computed(() => (asyncData.data.value || []) as Array<LocalizedDoc<PopulatedDocument<DocFromHandle<H>, PopulateFromOptions<O>>>>),
    status: computed(() => asyncData.status.value),
    error: computed(() => asyncData.error.value),
    refresh: () => asyncData.refresh()
  }
}

const emptyPagination = <T>(): PaginationResult<T> => ({
  data: [],
  page: 1,
  limit: 10,
  total: 0,
  pageCount: 0,
  hasNext: false,
  hasPrev: false,
  nextPage: null,
  prevPage: null
})

/**
 * Reactively resolve one page of documents plus total/page navigation metadata.
 */
export async function useContentPagination<
  const H extends ContentCollectionTarget,
  O extends PaginationOptions<H, PopulateSpec | undefined>
> (
  handle: H,
  options: Reactive<O>
): Promise<UseContentPaginationReturn<PopulatedDocument<DocFromHandle<H>, PopulateFromOptions<O>>>> {
  const resolved = computed(() => resolveOptions(options as Reactive<Record<string, unknown>>) as O)
  const key = computed(() => stableKey('content-pagination', typeof handle === 'string' ? handle : (handle as { name: string }).name, resolved.value))
  const context = createClientContentQueryContext()
  type PageResult = PaginationResult<PopulatedDocument<DocFromHandle<H>, PopulateFromOptions<O>>>
  const asyncData = await useAsyncData<PageResult>(
    key,
    () => paginateWithContext(context, handle, resolved.value) as Promise<PageResult>,
    { watch: [resolved], default: () => emptyPagination<PopulatedDocument<DocFromHandle<H>, PopulateFromOptions<O>>>() }
  )
  const result = computed(() => asyncData.data.value || emptyPagination<PopulatedDocument<DocFromHandle<H>, PopulateFromOptions<O>>>())

  return {
    data: computed(() => result.value.data),
    page: computed(() => result.value.page),
    limit: computed(() => result.value.limit),
    total: computed(() => result.value.total),
    pageCount: computed(() => result.value.pageCount),
    hasNext: computed(() => result.value.hasNext),
    hasPrev: computed(() => result.value.hasPrev),
    nextPage: computed(() => result.value.nextPage),
    prevPage: computed(() => result.value.prevPage),
    status: computed(() => asyncData.status.value),
    error: computed(() => asyncData.error.value),
    refresh: () => asyncData.refresh()
  }
}

interface UseContentBacklinksReturn<T> {
  data: ComputedRef<T[]>
  status: ComputedRef<string>
  error: ComputedRef<unknown>
  refresh: () => Promise<void>
}

/**
 * Reactively resolve source documents that reference a target document.
 */
export async function useContentBacklinks<
  const Target extends ContentCollectionTarget,
  const Source extends BacklinkSource | ReadonlyArray<BacklinkSource>,
  P extends PopulateSpec | undefined = undefined
> (
  handle: Target,
  options: Reactive<BacklinksOptions<Target, Source, P>> & { from: ReactiveValue<Source> }
): Promise<UseContentBacklinksReturn<BacklinksResult<Source, P>[number]>> {
  const resolved = computed(() => resolveOptions(options as unknown as Reactive<Record<string, unknown>>) as unknown as BacklinksOptions<Target, Source, P>)
  const key = computed(() => stableKey('content-backlinks', typeof handle === 'string' ? handle : (handle as { name: string }).name, resolved.value))
  const context = createClientContentQueryContext()
  type BacklinksData = BacklinksResult<Source, P>
  const asyncData = await useAsyncData<BacklinksData>(
    key,
    () => backlinksWithContext(context, handle, resolved.value) as Promise<BacklinksData>,
    { watch: [resolved], default: () => [] as unknown as BacklinksData }
  )

  return {
    data: computed(() => (asyncData.data.value || []) as BacklinksData),
    status: computed(() => asyncData.status.value),
    error: computed(() => asyncData.error.value),
    refresh: () => asyncData.refresh()
  }
}

interface UseContentVariantsReturn<T> {
  data: ComputedRef<Array<ContentVariant<T>>>
  status: ComputedRef<string>
  error: ComputedRef<unknown>
  refresh: () => Promise<void>
}

/**
 * Reactively resolve every locale variant of a single document — used by
 * locale switchers. Returns one entry per configured locale, with a
 * `translated` flag.
 */
export async function useContentVariants<H extends ContentCollectionTarget> (
  handle: H,
  options: Reactive<VariantsOptions<H>>
): Promise<UseContentVariantsReturn<DocFromHandle<H>>> {
  const resolved = computed(() => resolveOptions(options as unknown as Reactive<Record<string, unknown>>) as unknown as VariantsOptions<H>)
  const key = computed(() => stableKey('content-variants', typeof handle === 'string' ? handle : (handle as { name: string }).name, resolved.value))
  const context = createClientContentQueryContext()
  const asyncData = await useAsyncData<Array<ContentVariant<DocFromHandle<H>>>>(
    key,
    () => variantsWithContext(context, handle, resolved.value as VariantsOptions<H>) as Promise<Array<ContentVariant<DocFromHandle<H>>>>,
    { watch: [resolved], default: () => [] }
  )

  return {
    data: computed(() => (asyncData.data.value || []) as Array<ContentVariant<DocFromHandle<H>>>),
    status: computed(() => asyncData.status.value),
    error: computed(() => asyncData.error.value),
    refresh: () => asyncData.refresh()
  }
}

interface UseContentTreeReturn<T> {
  data: ComputedRef<T[]>
  status: ComputedRef<string>
  error: ComputedRef<unknown>
  refresh: () => Promise<void>
}

/**
 * Reactively resolve the navigation tree for a collection.
 */
export async function useContentTree<H extends ContentCollectionTarget> (
  handle: H,
  options: Reactive<TreeOptions<H>> = {} as Reactive<TreeOptions<H>>
): Promise<UseContentTreeReturn<ContentTreeItem<DocFromHandle<H>>>> {
  const resolved = computed(() => resolveOptions(options as Reactive<Record<string, unknown>>) as TreeOptions<H>)
  const key = computed(() => stableKey('content-tree', typeof handle === 'string' ? handle : (handle as { name: string }).name, resolved.value))
  const context = createClientContentQueryContext()
  type TreeResult = Array<ContentTreeItem<DocFromHandle<H>>>
  const asyncData = await useAsyncData<TreeResult>(
    key,
    () => treeWithContext(context, handle, resolved.value as TreeOptions<H>) as Promise<TreeResult>,
    { watch: [resolved], default: () => [] as TreeResult }
  )

  return {
    data: computed(() => (asyncData.data.value || []) as TreeResult),
    status: computed(() => asyncData.status.value),
    error: computed(() => asyncData.error.value),
    refresh: () => asyncData.refresh()
  }
}

interface UseContentNeighborsReturn<T> {
  data: ComputedRef<NeighborsResult<T>>
  pending: ComputedRef<boolean>
  status: ComputedRef<string>
  error: ComputedRef<unknown>
  refresh: () => Promise<void>
}

/**
 * Reactively resolve previous/next surroundings for a document.
 */
export async function useContentNeighbors<H extends ContentCollectionTarget> (
  handle: H,
  options: Reactive<NeighborsOptions<H>>
): Promise<UseContentNeighborsReturn<DocFromHandle<H>>> {
  const resolved = computed(() => resolveOptions(options as unknown as Reactive<Record<string, unknown>>) as unknown as NeighborsOptions<H>)
  const key = computed(() => stableKey('content-neighbors', typeof handle === 'string' ? handle : (handle as { name: string }).name, resolved.value))
  const context = createClientContentQueryContext()
  const asyncData = await useAsyncData<NeighborsResult<DocFromHandle<H>>>(
    key,
    () => neighborsWithContext(context, handle, resolved.value as NeighborsOptions<H>) as Promise<NeighborsResult<DocFromHandle<H>>>,
    { watch: [resolved], default: () => ({ prev: null, next: null }) as NeighborsResult<DocFromHandle<H>> }
  )

  return {
    data: computed(() => (asyncData.data.value || { prev: null, next: null }) as NeighborsResult<DocFromHandle<H>>),
    pending: computed(() => asyncData.pending.value),
    status: computed(() => asyncData.status.value),
    error: computed(() => asyncData.error.value),
    refresh: () => asyncData.refresh()
  }
}

/* -------------------------------------------------------------------------- */
/* useContentLocaleSwitch                                                     */
/* -------------------------------------------------------------------------- */

interface UseContentLocaleSwitchReturn<T> {
  /**
   * Per-locale path map of the resolved document, keyed by locale code.
   * Empty object when the document hasn't resolved yet or returned `null`.
   */
  paths: ComputedRef<Record<string, LocalePathEntry>>
  /**
   * Resolve a switch destination for a given locale. Returns the content's
   * translated path when available; otherwise `null` so the caller can fall
   * back to a route-only switch (e.g. `useSwitchLocalePath`).
   */
  switchTo: (locale: string) => string | null
  /**
   * The resolved document, exposed so the caller can read additional fields
   * (title, description, ...) from the same query without a second fetch.
   */
  data: ComputedRef<LocalizedDoc<T> | null>
}

/**
 * Resolve every per-locale path for a content document. Thin wrapper over
 * `useContentOne` that exposes the document's `localePaths` plus a `switchTo`
 * helper for rendering locale switchers.
 *
 * Layouts and pages typically call this with the same options — `useAsyncData`
 * dedupes by key, so it's a single round-trip:
 *
 * ```vue
 * <script setup>
 * const { switchTo } = useContentLocaleSwitch(docs, {
 *   locale: () => locale.value,
 *   by: { path: () => route.path },
 *   fallback: true
 * })
 *
 * // In the template:
 * // <a :href="switchTo('de') || useSwitchLocalePath()('de')">Deutsch</a>
 * </script>
 * ```
 */
export async function useContentLocaleSwitch<
  const H extends ContentCollectionTarget,
  O extends OneOptions<H, PopulateSpec | undefined>
> (
  handle: H,
  options: Reactive<O>
): Promise<UseContentLocaleSwitchReturn<PopulatedDocument<DocFromHandle<H>, PopulateFromOptions<O>>>> {
  const { data } = await useContentOne(handle, options)
  const paths = computed(() => {
    const localePaths = (data.value as { localePaths?: Record<string, LocalePathEntry> } | null)?.localePaths
    return localePaths || {}
  })
  const switchTo = (locale: string): string | null => paths.value?.[locale]?.path ?? null
  return { paths, switchTo, data }
}

// Re-export the underlying types so consumers can avoid pulling from internal paths.
export type {
  ManyOptions,
  OneOptions,
  BacklinksOptions,
  BacklinksResult,
  LocalizedDoc,
  ContentResolvedMeta,
  ContentCollectionTarget,
  DocumentFromHandle,
  NeighborsOptions,
  NeighborsResult,
  PaginationOptions,
  PaginationResult,
  PopulateSpec,
  PopulateFromOptions,
  PopulatedDocument,
  ResolveOneOptions,
  ResolveOneResult,
  SortSpec,
  TreeOptions,
  VariantsOptions,
  ContentVariant
}
