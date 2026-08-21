import type { ComputedRef, Ref } from 'vue'
import { onMounted } from 'vue'
import type { MaybeRefOrGetter } from '#imports'
import { computed, ref, shallowRef, toValue, useAsyncData, useFetch, useRequestFetch, useRuntimeConfig, watchEffect } from '#imports'
import { withBase } from 'ufo'
import type { ContentCollectionHandle } from '../../../types/config'
import type { ContentNavigationItem } from '../../../types/content'
import type { ContentCollectionStringName, ContentSearchSection } from '../../../types/query'
import type { ContentSearchIndexRecord, ContentSearchPublicRuntimeConfig, ContentSearchResult } from '../../../types/search'
import { createMiniSearchIndex } from '../../shared/search'
import { createContentSearchNavigation } from '../../../features/search/navigation'
import { normalizeMiniSearchOptions } from '../../../features/search/options'
import { resolveCollectionSearchSectionsData } from '../../../features/collections/resolve'
import { resolveCollectionI18n } from '../../../features/localization/path'
import { many, navigation as fetchNavigation } from './query-api'
import { resolveActiveLocale } from './locale'
import { getContentRuntime } from './runtime'
import { createPagefindSearchClient } from '../pagefind-client'

interface SearchLoadOptions {
  locale?: MaybeRefOrGetter<string | undefined>
  limit?: MaybeRefOrGetter<number | undefined>
}

export interface UseContentSearchOptions extends SearchLoadOptions {
  /**
   * Initial search term for the controlled query ref.
   */
  initialQuery?: MaybeRefOrGetter<string | undefined>
  /**
   * Maximum number of results exposed by the headless controller.
   */
  limit?: MaybeRefOrGetter<number | undefined>
  /**
   * Optional collection to additionally load that collection's search
   * sections and search-shaped navigation tree. Omit to use only the
   * query-driven results; `files` and `searchNavigation` stay empty and no
   * extra request is issued.
   */
  collection?: ContentCollectionHandle | ContentCollectionStringName
}

interface SearchLoadResult {
  results: ComputedRef<ContentSearchResult[]>
  pending: ComputedRef<boolean>
  error: ComputedRef<unknown>
}

export interface UseContentSearchResult extends SearchLoadResult {
  query: Ref<string>
  activeIndex: Ref<number>
  activeResult: ComputedRef<ContentSearchResult | null>
  hasQuery: ComputedRef<boolean>
  hasResults: ComputedRef<boolean>
  isEmpty: ComputedRef<boolean>
  setQuery: (value: string) => void
  setActiveIndex: (index: number) => void
  next: () => void
  previous: () => void
  reset: () => void
  select: (index?: number) => ContentSearchResult | null
  /** This collection's search sections (empty unless `options.collection` is set). */
  files: ComputedRef<ContentSearchSection[]>
  /**
   * This collection's navigation tree, shaped for search UI (Nuxt UI
   * `UContentSearch`) — the sole name for this data. Empty
   * unless `options.collection` is set.
   */
  searchNavigation: ComputedRef<ContentNavigationItem[]>
}

type AppRuntimeConfig = {
  baseURL?: string
}

const defaultSearchConfig: ContentSearchPublicRuntimeConfig = {
  apiBaseURL: '/api/_content/search',
  indexURL: '/api/_content/search/index.json',
  engine: 'minisearch',
  minisearch: normalizeMiniSearchOptions()
}

const disabledSearchError = new Error('Ginko search is disabled. Enable it with `content.search`.')

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object'
}

const resolveSearchConfig = (runtimeConfig: ReturnType<typeof useRuntimeConfig>): ContentSearchPublicRuntimeConfig | false => {
  const contentValue = runtimeConfig.public.content
  if (!isRecord(contentValue)) {
    return defaultSearchConfig
  }

  const value = contentValue.search
  if (value === false) {
    return false
  }

  if (!isRecord(value)) {
    return defaultSearchConfig
  }

  return {
    apiBaseURL: typeof value.apiBaseURL === 'string' ? value.apiBaseURL : defaultSearchConfig.apiBaseURL,
    indexURL: typeof value.indexURL === 'string' ? value.indexURL : defaultSearchConfig.indexURL,
    engine: value.engine === 'pagefind' || value.engine === 'provider' ? value.engine : 'minisearch',
    minisearch: normalizeMiniSearchOptions(value.minisearch)
  }
}

const resolveAppConfig = (runtimeConfig: ReturnType<typeof useRuntimeConfig>): AppRuntimeConfig => {
  const value = (runtimeConfig as { app?: AppRuntimeConfig }).app
  return value || {}
}

const loadSearchSections = async (
  collection: string,
  options: SearchLoadOptions
) => {
  const runtime = getContentRuntime()
  const { locales, defaultLocale } = resolveCollectionI18n(collection, runtime)
  const locale = toValue(options.locale)

  return await resolveCollectionSearchSectionsData(collection, runtime, {
    locale,
    activeLocale: locale || resolveActiveLocale(locales, defaultLocale),
    loadPages: async (extraFields) => {
      return await many(collection, {
        ...(locale ? { locale } : {}),
        select: ['title', 'description', 'body', ...extraFields]
      })
    }
  })
}

const collectionName = (collection: ContentCollectionHandle | string) =>
  typeof collection === 'string' ? collection : collection.name

/**
 * Load one collection's search sections and search-shaped navigation tree.
 * Internal to `useContentSearch`.
 */
const loadCollectionSearchData = async (
  collection: ContentCollectionStringName | ContentCollectionHandle,
  options: SearchLoadOptions
) => {
  const name = collectionName(collection)
  const locale = computed(() => toValue(options.locale))
  const payloadPromise = useAsyncData(computed(() => `content-search-data:${name}:${locale.value || 'default'}`), async () => {
    const locale = toValue(options.locale)
    const [navigation, files] = await Promise.all([
      fetchNavigation(name, locale ? { locale } : {}),
      loadSearchSections(name, options)
    ])

    return {
      files,
      navigation: createContentSearchNavigation(navigation as any)
    }
  }, {
    watch: [locale]
  })
  const payload = await payloadPromise

  return {
    files: computed(() => payload.data.value?.files || []),
    searchNavigation: computed(() => payload.data.value?.navigation || [])
  }
}

const loadSearchResults = async (search: MaybeRefOrGetter<string>, options: SearchLoadOptions = {}): Promise<SearchLoadResult> => {
  const runtimeConfig = useRuntimeConfig()
  const config = resolveSearchConfig(runtimeConfig)
  const appConfig = resolveAppConfig(runtimeConfig)

  if (config === false) {
    return {
      results: computed(() => []),
      pending: computed(() => false),
      error: computed(() => disabledSearchError)
    }
  }

  if (config.engine === 'pagefind') {
    return usePagefindSearch(search, withBase('/pagefind/pagefind.js', appConfig.baseURL || '/'), options)
  }

  if (config.engine === 'provider') {
    return await useProviderSearch(search, config.apiBaseURL, options)
  }

  return await useMiniSearch(search, config.indexURL, config.minisearch, options)
}

/**
 * The sole public search composable. It combines reactive, backend-normalized
 * query search with optional per-collection search sections and navigation.
 */
export const useContentSearch = async (options: UseContentSearchOptions = {}): Promise<UseContentSearchResult> => {
  const query = ref(String(toValue(options.initialQuery) || ''))
  const activeIndex = ref(-1)
  // Both branches use Nuxt composables and must start synchronously while the
  // caller's setup context is active. Awaiting either branch first can lose
  // that context before the other branch initializes.
  const searchPromise = loadSearchResults(query, options)
  const collectionDataPromise = options.collection
    ? loadCollectionSearchData(options.collection, options)
    : Promise.resolve({
        files: computed(() => [] as ContentSearchSection[]),
        searchNavigation: computed(() => [] as ContentNavigationItem[]),
      })
  const [search, collectionData] = await Promise.all([searchPromise, collectionDataPromise])
  const limit = computed(() => {
    const value = toValue(options.limit)
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined
  })
  const results = computed(() => {
    const items = search.results.value
    return typeof limit.value === 'number' ? items.slice(0, limit.value) : items
  })
  const hasQuery = computed(() => query.value.trim().length > 0)
  const hasResults = computed(() => results.value.length > 0)
  const isEmpty = computed(() => hasQuery.value && !search.pending.value && !search.error.value && !results.value.length)
  const activeResult = computed(() => results.value[activeIndex.value] || null)
  let lastQuery = query.value

  const setActiveIndex = (index: number) => {
    const lastIndex = results.value.length - 1
    if (!Number.isFinite(index)) {
      activeIndex.value = -1
      return
    }
    activeIndex.value = lastIndex < 0 ? -1 : Math.max(-1, Math.min(Math.floor(index), lastIndex))
  }
  const setQuery = (value: string) => {
    query.value = value
    setActiveIndex(-1)
  }
  const next = () => setActiveIndex(activeIndex.value + 1)
  const previous = () => setActiveIndex(activeIndex.value <= -1 ? -1 : activeIndex.value - 1)
  const reset = () => {
    query.value = ''
    activeIndex.value = -1
  }
  const select = (index = activeIndex.value) => results.value[index] || null

  watchEffect(() => {
    const currentQuery = query.value
    const resultCount = results.value.length
    if (currentQuery !== lastQuery) {
      lastQuery = currentQuery
      activeIndex.value = -1
    }
    if (!Number.isInteger(activeIndex.value) || activeIndex.value < -1) {
      activeIndex.value = -1
      return
    }
    if (!resultCount) {
      activeIndex.value = -1
      return
    }
    if (activeIndex.value >= resultCount) {
      activeIndex.value = resultCount - 1
    }
  })

  return {
    query,
    results,
    pending: search.pending,
    error: search.error,
    activeIndex,
    activeResult,
    hasQuery,
    hasResults,
    isEmpty,
    setQuery,
    setActiveIndex,
    next,
    previous,
    reset,
    select,
    files: collectionData.files,
    searchNavigation: collectionData.searchNavigation
  }
}

const useMiniSearch = async (search: MaybeRefOrGetter<string>, indexURL: string, minisearch: ContentSearchPublicRuntimeConfig['minisearch'], options: SearchLoadOptions): Promise<SearchLoadResult> => {
  const locale = computed(() => toValue(options.locale))
  const requestUrl = computed(() => locale.value ? `${indexURL}?locale=${encodeURIComponent(locale.value)}` : indexURL)
  const fetchData = useFetch<ContentSearchIndexRecord[]>(requestUrl)
  const { data, pending, error } = await fetchData
  const index = computed(() => createMiniSearchIndex(data.value || [], minisearch))
  const results = computed(() => index.value.search(toValue(search), {
    locale: locale.value,
    limit: toValue(options.limit)
  }))

  return {
    results,
    pending: computed(() => pending.value),
    error: computed(() => error.value)
  }
}

const useProviderSearch = async (search: MaybeRefOrGetter<string>, apiBaseURL: string, options: SearchLoadOptions): Promise<SearchLoadResult> => {
  const locale = computed(() => toValue(options.locale))
  const term = computed(() => String(toValue(search) || '').trim())
  const requestUrl = computed(() => {
    const params = new URLSearchParams()
    params.set('q', term.value)
    if (locale.value) {
      params.set('locale', locale.value)
    }
    return `${apiBaseURL}?${params.toString()}`
  })
  const requestKey = computed(() => `content-provider-search:${requestUrl.value}`)
  const requestFetch = useRequestFetch()
  const { data, pending, error } = await useAsyncData(requestKey, async () => {
    // The provider contract rejects empty terms. Keep the empty search state
    // local so SSR/prerender and a newly opened search dialog never dispatch an
    // invalid request.
    if (!term.value) {
      return []
    }
    return await requestFetch<ContentSearchResult[]>(requestUrl.value)
  })

  return {
    results: computed(() => (data.value || []).map((result: ContentSearchResult) => ({
      ...result,
      collection: typeof result.collection === 'string' ? result.collection : ''
    }))),
    pending: computed(() => pending.value),
    error: computed(() => error.value)
  }
}

const usePagefindSearch = (search: MaybeRefOrGetter<string>, pagefindUrl: string, options: SearchLoadOptions): SearchLoadResult => {
  const locale = computed(() => toValue(options.locale))
  const results = ref<ContentSearchResult[]>([])
  const pending = ref(false)
  const error = shallowRef<unknown>(null)
  if (import.meta.client) {
    onMounted(() => {
      const client = createPagefindSearchClient({
        manifestUrl: pagefindUrl.replace(/pagefind\.js(?:\?.*)?$/, 'ginko-locales.json')
      })

      watchEffect(async (onCleanup) => {
        const term = toValue(search).trim()
        let cancelled = false
        onCleanup(() => {
          cancelled = true
        })

        if (!term) {
          results.value = []
          pending.value = false
          error.value = null
          return
        }

        pending.value = true
        error.value = null

        try {
          const normalized = await client.search(term, {
            locale: locale.value,
            limit: toValue(options.limit)
          })

          if (!cancelled) {
            results.value = normalized
          }
        } catch (err) {
          if (!cancelled) {
            error.value = err
            results.value = []
          }
        } finally {
          if (!cancelled) {
            pending.value = false
          }
        }
      })
    })
  }

  return {
    results: computed(() => results.value),
    pending: computed(() => pending.value),
    error: computed(() => error.value)
  }
}
