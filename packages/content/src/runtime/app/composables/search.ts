import type { ComputedRef, Ref } from 'vue'
import type { MaybeRefOrGetter } from '#imports'
import { computed, ref, shallowRef, toValue, useAsyncData, useFetch, useRuntimeConfig, watchEffect } from '#imports'
import { withBase } from 'ufo'
import type { ContentCollectionMap } from '@lupinum/ginko-content'
import type { ContentCollectionHandle } from '../../../types/config'
import type { ContentNavigationItem, ParsedContent } from '../../../types/content'
import type { ContentSearchSection } from '../../../types/query'
import type { ContentSearchIndexRecord, ContentSearchPublicRuntimeConfig, ContentSearchResult } from '../../../types/search'
import { searchRecords } from '../../shared/search'
import { createContentSearchNavigation } from '../../../features/search/navigation'
import { resolveCollectionSearchSectionsData } from '../../../features/collections/resolve'
import { resolveCollectionI18n } from '../../../features/localization/path'
import { many, tree } from './query-api'
import { resolveActiveLocale } from './locale'
import { getContentRuntime } from './runtime'

export interface UseContentSearchResultsOptions {
  locale?: MaybeRefOrGetter<string | undefined>
}

export interface UseContentSearchOptions extends UseContentSearchResultsOptions {
  /**
   * Initial search term for the controlled query ref.
   */
  initialQuery?: MaybeRefOrGetter<string | undefined>
  /**
   * Maximum number of results exposed by the headless controller.
   */
  limit?: MaybeRefOrGetter<number | undefined>
}

export interface UseContentSearchResultsResult {
  results: ComputedRef<ContentSearchResult[]>
  pending: ComputedRef<boolean>
  error: ComputedRef<unknown>
}

export interface UseContentSearchResult extends UseContentSearchResultsResult {
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
}

export interface UseContentSearchDataOptions {
  locale?: MaybeRefOrGetter<string | undefined>
}

export interface UseContentSearchDataResult {
  files: ComputedRef<ContentSearchSection[]>
  searchNavigation: ComputedRef<ContentNavigationItem[]>
  /**
   * Compatibility alias for `searchNavigation`.
   *
   * Prefer `searchNavigation` so layout navigation and search navigation are
   * not confused.
   */
  navigation: ComputedRef<ContentNavigationItem[]>
  searchTerm: ReturnType<typeof ref<string>>
}

interface PagefindSearchResultData {
  url?: string
  excerpt?: string
  meta?: {
    title?: string
    locale?: string
  }
}

interface PagefindSearchResult {
  score: number
  data(): Promise<PagefindSearchResultData>
}

interface PagefindSearchResponse {
  results?: PagefindSearchResult[]
}

interface PagefindModule {
  search(term: string): Promise<PagefindSearchResponse>
}

type ContentRuntimeConfig = {
  locales?: string[]
  search?: ContentSearchPublicRuntimeConfig | false
}

type AppRuntimeConfig = {
  baseURL?: string
}

const defaultSearchConfig: ContentSearchPublicRuntimeConfig = {
  apiBaseURL: '/api/_content/search',
  indexURL: '/api/_content/search/index.json',
  engine: 'minisearch',
  minisearch: {
    fields: ['title', 'content', 'headings'],
    storeFields: ['path', 'title', 'excerpt', 'anchor', 'locale'],
    boost: {
      title: 4,
      headings: 2,
      content: 1
    },
    fuzzy: 0.2,
    prefix: true
  }
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
    engine: value.engine === 'pagefind' || value.engine === 'cms' ? value.engine : 'minisearch',
    minisearch: resolveMiniSearchRuntimeOptions(value.minisearch)
  }
}

const resolveMiniSearchRuntimeOptions = (value: unknown): ContentSearchPublicRuntimeConfig['minisearch'] => {
  if (!isRecord(value)) {
    return defaultSearchConfig.minisearch
  }

  const fields = Array.isArray(value.fields) ? value.fields.filter((field): field is string => typeof field === 'string' && field.length > 0) : []
  const storeFields = Array.isArray(value.storeFields) ? value.storeFields.filter((field): field is string => typeof field === 'string' && field.length > 0) : []
  const boost = isRecord(value.boost)
    ? Object.fromEntries(Object.entries(value.boost).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])))
    : {}

  return {
    fields: fields.length ? fields : defaultSearchConfig.minisearch.fields,
    storeFields: storeFields.length ? storeFields : defaultSearchConfig.minisearch.storeFields,
    boost: Object.keys(boost).length ? boost : defaultSearchConfig.minisearch.boost,
    fuzzy: typeof value.fuzzy === 'boolean' || typeof value.fuzzy === 'number' ? value.fuzzy : defaultSearchConfig.minisearch.fuzzy,
    prefix: typeof value.prefix === 'boolean' ? value.prefix : defaultSearchConfig.minisearch.prefix
  }
}

const resolveContentConfig = (runtimeConfig: ReturnType<typeof useRuntimeConfig>): ContentRuntimeConfig | undefined => {
  const value = runtimeConfig.public.content
  if (!isRecord(value)) {
    return undefined
  }

  return {
    locales: Array.isArray(value.locales)
      ? value.locales.filter((locale): locale is string => typeof locale === 'string')
      : undefined,
    search: value.search === false
      ? false
      : (isRecord(value.search)
          ? {
              apiBaseURL: typeof value.search.apiBaseURL === 'string' ? value.search.apiBaseURL : defaultSearchConfig.apiBaseURL,
              indexURL: typeof value.search.indexURL === 'string' ? value.search.indexURL : defaultSearchConfig.indexURL,
              engine: value.search.engine === 'pagefind' || value.search.engine === 'cms' ? value.search.engine : 'minisearch',
              minisearch: resolveMiniSearchRuntimeOptions(value.search.minisearch)
            }
          : undefined)
  }
}

const resolveAppConfig = (runtimeConfig: ReturnType<typeof useRuntimeConfig>): AppRuntimeConfig => {
  const value = (runtimeConfig as { app?: AppRuntimeConfig }).app
  return value || {}
}

const loadSearchSections = async (
  collection: string,
  options: UseContentSearchDataOptions
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
        select: ['_path', 'title', 'description', 'body', ...extraFields]
      }) as Array<Pick<ParsedContent, '_path' | 'title' | 'description' | 'body'> & Record<string, unknown>>
    }
  })
}

const collectionName = (collection: ContentCollectionHandle | string) =>
  typeof collection === 'string' ? collection : collection.name

export async function useContentSearchData<K extends keyof ContentCollectionMap & string> (
  collection: ContentCollectionHandle<K> | K,
  options?: UseContentSearchDataOptions
): Promise<UseContentSearchDataResult>;
export async function useContentSearchData (
  collection: string | ContentCollectionHandle,
  options?: UseContentSearchDataOptions
): Promise<UseContentSearchDataResult>;
export async function useContentSearchData (
  collection: string | ContentCollectionHandle,
  options: UseContentSearchDataOptions = {}
) {
  const name = collectionName(collection)
  const searchTerm = ref('')
  const locale = computed(() => toValue(options.locale))
  const payload = await useAsyncData(computed(() => `content-search-data:${name}:${locale.value || 'default'}`), async () => {
    const locale = toValue(options.locale)
    const [navigation, files] = await Promise.all([
      tree(name, locale ? { locale } : {}),
      loadSearchSections(name, options)
    ])

    return {
      files,
      navigation: createContentSearchNavigation(navigation)
    }
  }, {
    watch: [locale]
  })

  const files = computed(() => payload.data.value?.files || [])
  const searchNavigation = computed(() => payload.data.value?.navigation || [])

  return {
    files,
    searchNavigation,
    navigation: searchNavigation,
    searchTerm
  }
}

export const useContentSearchResults = async (search: MaybeRefOrGetter<string>, options: UseContentSearchResultsOptions = {}): Promise<UseContentSearchResultsResult> => {
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

  if (config.engine === 'cms') {
    return await useCmsSearch(search, config.apiBaseURL, options)
  }

  return await useMiniSearch(search, config.indexURL, config.minisearch, options)
}

export const useContentSearch = async (options: UseContentSearchOptions = {}): Promise<UseContentSearchResult> => {
  const query = ref(String(toValue(options.initialQuery) || ''))
  const activeIndex = ref(-1)
  const search = await useContentSearchResults(query, options)
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
    select
  }
}

const useMiniSearch = async (search: MaybeRefOrGetter<string>, indexURL: string, minisearch: ContentSearchPublicRuntimeConfig['minisearch'], options: UseContentSearchResultsOptions): Promise<UseContentSearchResultsResult> => {
  const locale = computed(() => toValue(options.locale))
  const requestUrl = computed(() => locale.value ? `${indexURL}?locale=${encodeURIComponent(locale.value)}` : indexURL)
  const { data, pending, error } = await useFetch<ContentSearchIndexRecord[]>(requestUrl)
  const results = computed(() => searchRecords(data.value || [], toValue(search), locale.value, minisearch))

  return {
    results,
    pending: computed(() => pending.value),
    error: computed(() => error.value)
  }
}

const useCmsSearch = async (search: MaybeRefOrGetter<string>, apiBaseURL: string, options: UseContentSearchResultsOptions): Promise<UseContentSearchResultsResult> => {
  const locale = computed(() => toValue(options.locale))
  const requestUrl = computed(() => {
    const params = new URLSearchParams()
    const term = String(toValue(search) || '')
    if (term) {
      params.set('q', term)
    }
    if (locale.value) {
      params.set('locale', locale.value)
    }
    const query = params.toString()
    return query ? `${apiBaseURL}?${query}` : apiBaseURL
  })
  const { data, pending, error } = await useFetch<ContentSearchResult[]>(requestUrl)

  return {
    results: computed(() => data.value || []),
    pending: computed(() => pending.value),
    error: computed(() => error.value)
  }
}

// Pagefind ships as one browser-side module per generated site. Cache the
// dynamic import at app scope so multiple search boxes do not fetch it again.
let pagefindModulePromise: Promise<PagefindModule> | null = null

const loadPagefindModule = (pagefindUrl: string): Promise<PagefindModule> => {
  pagefindModulePromise = pagefindModulePromise || import(/* @vite-ignore */ pagefindUrl) as Promise<PagefindModule>
  return pagefindModulePromise
}

const deriveLocale = (path: string, locales: string[] = []) => {
  const segments = path.split('/').filter(Boolean)
  return segments[0] && locales.includes(segments[0]) ? segments[0] : undefined
}

const usePagefindSearch = (search: MaybeRefOrGetter<string>, pagefindUrl: string, options: UseContentSearchResultsOptions): UseContentSearchResultsResult => {
  const runtimeConfig = useRuntimeConfig()
  const contentConfig = resolveContentConfig(runtimeConfig)
  const locale = computed(() => toValue(options.locale))
  const results = ref<ContentSearchResult[]>([])
  const pending = ref(false)
  const error = shallowRef<unknown>(null)

  if (contentConfig?.search === false) {
    return {
      results: computed(() => []),
      pending: computed(() => false),
      error: computed(() => disabledSearchError)
    }
  }

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
      const pagefind = await loadPagefindModule(pagefindUrl)
      const response = await pagefind.search(term)
      const normalized = await Promise.all((response?.results || []).map(async (result) => {
        const data = await result.data()
        const [path = '', anchor] = String(data?.url || '').split('#')

        return {
          path,
          title: data?.meta?.title || path,
          excerpt: data?.excerpt || '',
          score: result.score,
          anchor: anchor || undefined,
          locale: data?.meta?.locale || deriveLocale(path, contentConfig?.locales || [])
        } satisfies ContentSearchResult
      }))

      if (!cancelled) {
        results.value = locale.value ? normalized.filter(result => result.locale === locale.value) : normalized
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

  return {
    results: computed(() => results.value),
    pending: computed(() => pending.value),
    error: computed(() => error.value)
  }
}
