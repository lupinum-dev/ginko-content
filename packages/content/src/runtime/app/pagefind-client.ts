import type { ContentSearchResult } from '../../types/search'

interface PagefindLocaleManifest {
  version: 1
  defaultLocale: string
  indexes: Record<string, string>
}

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
  score: number
  data(): Promise<PagefindResultData>
}

interface PagefindModule {
  search(term: string): Promise<{ results?: PagefindResult[] }>
}

const isManifest = (value: unknown): value is PagefindLocaleManifest => {
  if (!value || typeof value !== 'object') return false
  const manifest = value as Record<string, unknown>
  return manifest.version === 1
    && typeof manifest.defaultLocale === 'string'
    && Boolean(manifest.defaultLocale)
    && Boolean(manifest.indexes)
    && typeof manifest.indexes === 'object'
    && Object.values(manifest.indexes as Record<string, unknown>).every(entry => typeof entry === 'string' && Boolean(entry))
}

const defaultManifestLoader = async (url: string) => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to load Pagefind locale manifest: ${response.status}`)
  return await response.json()
}

const defaultModuleLoader = (url: string) => import(/* @vite-ignore */ url) as Promise<PagefindModule>

const resolveEntryUrl = (manifestUrl: string, entry: string) => {
  if (/^(?:https?:)?\/\//.test(entry) || entry.startsWith('/')) return entry
  return `${manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1)}${entry}`
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
      if (!isManifest(value)) throw new Error('Invalid Pagefind locale manifest. Rebuild the site search index.')
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
      const ranked = responses.flat().sort((left, right) => right.score - left.score)
      const limited = typeof execution.limit === 'number' && execution.limit > 0
        ? ranked.slice(0, Math.floor(execution.limit))
        : ranked
      const normalized = await Promise.all(limited.map(async (result) => {
        const data = await result.data()
        const meta = data.meta
        const [path = '', anchor] = String(data.url || '').split('#')
        return {
          path,
          collection: typeof meta?.collection === 'string' ? meta.collection : '',
          title: typeof meta?.title === 'string' ? meta.title : path,
          excerpt: typeof data.plain_excerpt === 'string' ? data.plain_excerpt : '',
          score: result.score,
          anchor: anchor || undefined,
          locale: typeof meta?.locale === 'string' ? meta.locale : undefined
        } satisfies ContentSearchResult
      }))

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
