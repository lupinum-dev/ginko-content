import type { ContentSearchResult } from '../../types/search'
import { isPagefindLocaleManifest, type PagefindLocaleManifest } from '../pagefind-manifest'

interface PagefindResultData {
  url?: string
  excerpt?: string
  plain_excerpt?: string
  meta?: {
    collection?: unknown
    title?: unknown
    locale?: unknown
  }
}

interface PagefindResult {
  id?: string
  score: number
  data(): Promise<PagefindResultData>
}

interface PagefindModule {
  search(term: string): Promise<{ results?: PagefindResult[] }>
}

const defaultManifestLoader = async (url: string) => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to load Pagefind locale manifest: ${response.status}`)
  return await response.json()
}

const defaultModuleLoader = (url: string) => import(/* @vite-ignore */ url) as Promise<PagefindModule>

const resolveEntryUrl = (manifestUrl: string, entry: string) => {
  return `${manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1)}${entry}`
}

const normalizeResultUrl = (value: unknown) => {
  const source = typeof value === 'string' ? value : ''
  if (!source) return { path: '', anchor: undefined }
  try {
    const url = new URL(source, 'https://ginko.invalid')
    return {
      path: decodeURIComponent(url.pathname),
      anchor: url.hash ? decodeURIComponent(url.hash.slice(1)) : undefined
    }
  } catch {
    const [path = '', anchor] = source.split('#')
    return { path, anchor: anchor || undefined }
  }
}

export const createPagefindSearchClient = (options: {
  manifestUrl: string
  loadManifest?: (url: string) => Promise<unknown>
  importModule?: (url: string) => Promise<PagefindModule>
}) => {
  const loadManifest = options.loadManifest || defaultManifestLoader
  const importModule = options.importModule || defaultModuleLoader
  let manifestPromise: Promise<PagefindLocaleManifest> | undefined
  const modules = new Map<string, Promise<PagefindModule>>()

  const manifest = () => {
    manifestPromise ||= loadManifest(options.manifestUrl).then((value) => {
      if (!isPagefindLocaleManifest(value)) throw new Error('Invalid Pagefind locale manifest. Rebuild the site search index.')
      return value
    })
    return manifestPromise
  }

  const moduleFor = (locale: string, entry: string) => {
    let loaded = modules.get(locale)
    if (!loaded) {
      loaded = importModule(resolveEntryUrl(options.manifestUrl, entry))
      modules.set(locale, loaded)
    }
    return loaded
  }

  return {
    async search (term: string, execution: { locale?: string, limit?: number } = {}): Promise<ContentSearchResult[]> {
      if (!term.trim()) return []
      const localeManifest = await manifest()
      const locales = execution.locale ? [execution.locale] : Object.keys(localeManifest.indexes)
      const unknownLocale = locales.find(locale => !localeManifest.indexes[locale])
      if (unknownLocale) return []

      const responses = await Promise.all(locales.map(async (locale) => {
        const entry = localeManifest.indexes[locale]!
        const pagefind = await moduleFor(locale, entry)
        return (await pagefind.search(term)).results || []
      }))
      const ranked = responses.flatMap((results, localeIndex) =>
        results.map((result, resultIndex) => ({ result, localeIndex, resultIndex })))
        .sort((left, right) =>
          right.result.score - left.result.score
          || String(left.result.id || '').localeCompare(String(right.result.id || ''))
          || left.localeIndex - right.localeIndex
          || left.resultIndex - right.resultIndex)
      const normalize = async (result: PagefindResult) => {
        const data = await result.data()
        const meta = data.meta
        const { path, anchor } = normalizeResultUrl(data.url)
        return {
          path,
          collection: typeof meta?.collection === 'string' ? meta.collection : '',
          title: typeof meta?.title === 'string' ? meta.title : path,
          excerpt: typeof data.plain_excerpt === 'string' ? data.plain_excerpt : '',
          score: result.score,
          anchor: anchor || undefined,
          locale: typeof meta?.locale === 'string' ? meta.locale : undefined
        } satisfies ContentSearchResult
      }
      const compare = (left: ContentSearchResult, right: ContentSearchResult) =>
        right.score - left.score
        || left.path.localeCompare(right.path)
        || (left.anchor || '').localeCompare(right.anchor || '')

      const requestedLimit = typeof execution.limit === 'number' && execution.limit > 0
        ? Math.floor(execution.limit)
        : undefined
      if (requestedLimit !== undefined) {
        if (requestedLimit === 0) return []
        const normalized = (await Promise.all(
          ranked.slice(0, requestedLimit).map(item => normalize(item.result))
        )).sort(compare)
        const seen = new Set<string>()
        return normalized.filter((result) => {
          const key = `${result.path}#${result.anchor || ''}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
      }

      const normalized = (await Promise.all(ranked.map(item => normalize(item.result)))).sort(compare)
      const seen = new Set<string>()
      return normalized.filter((result) => {
        const key = `${result.path}#${result.anchor || ''}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    }
  }
}
