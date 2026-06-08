import { contentProviderResultMarker, type ContentCacheHint, type ContentCacheInvalidateInput, type ContentProvider } from '../public/provider'
import type { H3Event } from 'h3'
import type { ContentQueryResponse } from '../types/api'
import type { NavItem, ParsedContent } from '../types/content'
import type { ContentCollectionPageOptions, ContentPageResult, ContentQueryBuilderParams } from '../types/query'
import { buildContentGraph, type ContentGraph } from '../core/content/graph'
import { executeQueryPlan } from '../core/query/execute'
import { lowerQueryPlan } from '../core/query/lower'
import { findUnsupportedQueryOperator, SUPPORTED_QUERY_OPERATORS } from '../core/query/operators'
import { mergeContentCacheHints } from '../core/cache-hints'
import { normalizeRouteMounts, projectContentPathToLocale } from '../features/localization/path'
import { createRouteMeta, localizePageResult } from '../features/localization/results'
import { createContentProviderError } from '../public/provider-errors'

export interface ProviderFixtureCollection {
  type: 'page' | 'data'
  i18n?: boolean | { locales?: string[], defaultLocale?: string }
  route?: string | Record<string, string>
  sitemap?: boolean
}

export interface ProviderFixtureInput {
  name?: string
  providerName?: string
  defaultLocale?: string
  locales?: string[]
  localeFallback?: Record<string, string[]>
  collections: Record<string, ProviderFixtureCollection>
  documents: Array<Partial<ParsedContent> & Record<string, unknown>>
}

export interface ProviderFixture {
  name: string
  providerName: string
  defaultLocale: string
  locales: string[]
  localeFallback: Record<string, string[]>
  collections: Record<string, ProviderFixtureCollection>
  documents: ParsedContent[]
  graph: ContentGraph
  runtime: {
    defaultLocale: string
    locales: string[]
    localeFallback: Record<string, string[]>
    collections: Record<string, ProviderFixtureCollection>
  }
}

export interface ProviderFixtureCacheEvent {
  type: 'hit' | 'miss' | 'set' | 'purge'
  key: string
  tags?: string[]
  paths?: string[]
}

export interface ProviderFixtureCacheState {
  events: ProviderFixtureCacheEvent[]
  dependenciesByPath: Map<string, Set<string>>
  pathsByTag: Map<string, Set<string>>
  renderedPaths: Set<string>
}

export interface ProviderFixtureEventOptions {
  fixture?: ProviderFixture
  provider?: ContentProvider
  query?: Record<string, unknown>
  params?: Record<string, string>
  context?: Record<string, unknown>
}

const trimSlashes = (value: string) => value.replace(/^\/+|\/+$/g, '')

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const unwrapResponseResult = <T>(response: ContentQueryResponse<T> | import('../public/provider').ContentProviderResult<ContentQueryResponse<T>>): T | T[] | number | undefined => {
  if (isObject(response) && response[contentProviderResultMarker] === true) {
    return unwrapResponseResult<T>((response as import('../public/provider').ContentProviderResult<ContentQueryResponse<T>>).data)
  }
  const envelope = response as ContentQueryResponse<T>
  return envelope.result as T | T[] | number | undefined
}

const normalizeQueryResult = <T>(value: T | T[] | number | undefined): T[] => {
  if (Array.isArray(value)) return value
  return value && typeof value === 'object' ? [value] : []
}

const routeMountsFor = (fixture: ProviderFixture, collection: string) => {
  const config = fixture.collections[collection]
  const collectionI18n = config?.i18n && typeof config.i18n === 'object' ? config.i18n : undefined
  return normalizeRouteMounts(
    config?.route,
    collectionI18n?.locales || fixture.locales,
    collectionI18n?.defaultLocale || fixture.defaultLocale
  )
}

const localizePath = (fixture: ProviderFixture, collection: string, path: string, locale?: string) => {
  const config = fixture.collections[collection]
  const collectionI18n = config?.i18n && typeof config.i18n === 'object' ? config.i18n : undefined
  return projectContentPathToLocale(
    path,
    locale,
    collectionI18n?.defaultLocale || fixture.defaultLocale,
    routeMountsFor(fixture, collection)
  )
}

const navFieldsFromDoc = (doc: ParsedContent, fields: string[] = []) =>
  Object.fromEntries(fields.filter(field => field in doc).map(field => [field, doc[field]]))

const navIdentityFromDoc = (doc: ParsedContent) => ({
  ref: doc.ref,
  stableId: doc.ref || doc._canonicalKey || doc._id
})

const normalizeCachePath = (path: string) => {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return normalized.replace(/\/{2,}/g, '/')
}

const documentEntryTag = (doc: ParsedContent) => `entry:${doc._collection}:${String(doc.ref || doc._canonicalKey || doc._id)}`
const collectionTag = (collection: string) => `collection:${collection}`
const routeTag = (path: string) => `route:${normalizeCachePath(path)}`

const collectStringValues = (value: unknown): string[] => {
  if (typeof value === 'string') {
    return [value]
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectStringValues)
  }
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(collectStringValues)
  }
  return []
}

const referenceEntryTags = (fixture: ProviderFixture, doc: ParsedContent) => {
  const knownRefs = new Map(fixture.documents
    .filter(document => document !== doc)
    .flatMap((document) => {
      const ref = typeof document.ref === 'string' ? document.ref : undefined
      const [collection, ...id] = ref?.split('.') || []
      return ref && collection && id.length
        ? [[ref, `entry:${collection}:${id.join('.')}`] as const]
        : []
    }))

  return Array.from(new Set(collectStringValues(doc)
    .map(value => knownRefs.get(value))
    .filter((tag): tag is `entry:${string}:${string}` => typeof tag === 'string')))
}

type ProviderFixtureRuntimeContext = {
  cacheHint?: ContentCacheHint | false
}

type ProviderFixtureH3Event = H3Event & {
  context: H3Event['context'] & {
    __contentRuntime?: ProviderFixtureRuntimeContext
  }
}

const getProviderFixtureRuntimeContext = (event: H3Event): ProviderFixtureRuntimeContext => {
  const context = ((event as ProviderFixtureH3Event).context ||= {}) as ProviderFixtureH3Event['context']
  context.__contentRuntime ||= {}
  return context.__contentRuntime
}

export const collectProviderFixtureCacheHint = (
  event: H3Event,
  hint: ContentCacheHint | false | undefined
) => {
  if (typeof hint === 'undefined') {
    return
  }

  const runtime = getProviderFixtureRuntimeContext(event)
  runtime.cacheHint = mergeContentCacheHints(runtime.cacheHint, hint)
}

export const getProviderFixtureCacheHint = (event: H3Event): ContentCacheHint | false | undefined =>
  getProviderFixtureRuntimeContext(event).cacheHint

const createCacheHintForDocument = (
  fixture: ProviderFixture,
  doc: ParsedContent,
  path: string
): ContentCacheHint => {
  const collection = doc._collection || 'content'
  return {
    tags: Array.from(new Set([
      documentEntryTag(doc),
      collectionTag(collection),
      routeTag(path),
      ...referenceEntryTags(fixture, doc)
    ])),
    paths: [normalizeCachePath(path)],
    lastModified: fixture.documents
      .map(document => document.updatedAt || document.date)
      .filter((value): value is string => typeof value === 'string')
      .map(value => new Date(value))
      .filter(date => Number.isFinite(date.getTime()))
      .sort((left, right) => right.getTime() - left.getTime())[0]
  }
}

const createProviderFixtureCacheState = (): ProviderFixtureCacheState => ({
  events: [],
  dependenciesByPath: new Map(),
  pathsByTag: new Map(),
  renderedPaths: new Set()
})

const recordRouteDependencies = (
  cache: ProviderFixtureCacheState,
  path: string,
  tags: string[]
) => {
  const normalizedPath = normalizeCachePath(path)
  const normalizedTags = Array.from(new Set(tags.filter(Boolean)))
  for (const oldTag of cache.dependenciesByPath.get(normalizedPath) || []) {
    const oldPaths = cache.pathsByTag.get(oldTag)
    oldPaths?.delete(normalizedPath)
    if (oldPaths && oldPaths.size === 0) {
      cache.pathsByTag.delete(oldTag)
    }
  }
  cache.events.push({
    type: cache.renderedPaths.has(normalizedPath) ? 'hit' : 'miss',
    key: normalizedPath,
    tags: normalizedTags,
    paths: [normalizedPath]
  })
  cache.renderedPaths.add(normalizedPath)
  cache.dependenciesByPath.set(normalizedPath, new Set(normalizedTags))
  for (const tag of normalizedTags) {
    const paths = cache.pathsByTag.get(tag) || new Set<string>()
    paths.add(normalizedPath)
    cache.pathsByTag.set(tag, paths)
  }
  cache.events.push({ type: 'set', key: normalizedPath, tags: normalizedTags, paths: [normalizedPath] })
}

const invalidateFixtureCache = (
  cache: ProviderFixtureCacheState,
  input: ContentCacheInvalidateInput
) => {
  const paths = new Set((input.paths || []).map(normalizeCachePath))
  for (const tag of input.tags || []) {
    for (const path of cache.pathsByTag.get(tag) || []) {
      paths.add(path)
    }
  }

  for (const path of paths) {
    const tags = Array.from(cache.dependenciesByPath.get(path) || [])
    cache.renderedPaths.delete(path)
    cache.dependenciesByPath.delete(path)
    for (const tag of tags) {
      const tagPaths = cache.pathsByTag.get(tag)
      tagPaths?.delete(path)
      if (tagPaths && tagPaths.size === 0) {
        cache.pathsByTag.delete(tag)
      }
    }
    cache.events.push({ type: 'purge', key: path, tags, paths: [path] })
  }
}

export const createProviderFixtureDocument = (
  input: Partial<ParsedContent> & Record<string, unknown>
): ParsedContent => {
  const collection = String(input._collection || 'docs')
  const locale = String(input._locale || 'en')
  const path = String(input._path || '/')
  const canonicalKey = String(input._canonicalKey || `${collection}:${trimSlashes(path) || 'index'}`)
  const extension = input._extension || (input._type === 'yaml' ? 'yml' : 'md')

  return {
    _id: String(input._id || `content:${locale}:${trimSlashes(path).replace(/\//g, ':') || 'index'}.${extension}`),
    _source: String(input._source || 'content'),
    _collection: collection,
    _locale: locale,
    _canonicalKey: canonicalKey,
    _path: path,
    _file: String(input._file || `/${locale}/${trimSlashes(path) || 'index'}.${extension}`),
    _type: (input._type || 'markdown') as ParsedContent['_type'],
    _extension: extension as ParsedContent['_extension'],
    title: String(input.title || canonicalKey),
    body: {
      type: 'root',
      children: []
    },
    ...input
  } as ParsedContent
}

export const createProviderFixture = (input: ProviderFixtureInput): ProviderFixture => {
  const defaultLocale = input.defaultLocale || 'en'
  const locales = Array.from(new Set([defaultLocale, ...(input.locales || [])]))
  const documents = input.documents.map(createProviderFixtureDocument)
  const graph = buildContentGraph(documents, { defaultLocale, locales })
  const localeFallback = input.localeFallback || Object.fromEntries(
    locales
      .filter(locale => locale !== defaultLocale)
      .map(locale => [locale, [defaultLocale]])
  )

  return {
    name: input.name || 'provider-fixture',
    providerName: input.providerName || 'fixture',
    defaultLocale,
    locales,
    localeFallback,
    collections: input.collections,
    documents,
    graph,
    runtime: {
      defaultLocale,
      locales,
      localeFallback,
      collections: input.collections
    }
  }
}

export const createProviderFixtureEvent = (options: ProviderFixtureEventOptions = {}): H3Event => {
  const query = options.query
  const queryString = query
    ? `?${new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)])).toString()}`
    : ''

  return {
    path: `/${queryString}`,
    context: {
      ...(options.fixture
        ? {
            contentRuntime: {
              ...options.fixture.runtime,
              provider: options.provider?.name || options.fixture.providerName
            },
            contentProvider: options.provider
          }
        : {}),
      ...(options.params ? { params: options.params } : {}),
      ...options.context
    },
    node: {
      req: {
        url: `/${queryString}`
      }
    }
  } as unknown as H3Event
}

export const createFixtureContentProvider = (fixture: ProviderFixture, name = fixture.providerName): ContentProvider & { cache: ProviderFixtureCacheState } => {
  const cache = createProviderFixtureCacheState()
  const assertCollection = (collection?: string) => {
    if (collection && !fixture.collections[collection]) {
      throw createContentProviderError('unknown_collection', `Unknown collection: ${collection}`, { collection })
    }
  }

  const query: ContentProvider['query'] = async (event, params) => {
    assertCollection(params.collection)
    const unsupported = findUnsupportedQueryOperator(params.where)
    if (unsupported) {
      throw createContentProviderError('unsupported_query_operator', `Unsupported query operator: ${unsupported}`, {
        operator: unsupported
      })
    }

    collectProviderFixtureCacheHint(event, {
      tags: params.collection ? [collectionTag(params.collection)] : []
    })

    return executeQueryPlan(
      fixture.graph,
      lowerQueryPlan(params),
      fixture.runtime
    )
  }

  const docsForNavigation = async (event: H3Event, params: ContentQueryBuilderParams) => {
    const response = await query<ParsedContent>(event, params)
    return normalizeQueryResult<ParsedContent>(unwrapResponseResult(response))
      .filter(doc => !doc._draft && !doc._partial && !doc._navigation && doc.navigation !== false && doc._path)
  }

  const provider: ContentProvider = {
    name: name as ContentProvider['name'],
    capabilities: {
      routeBackedCollections: true,
      dataCollections: true,
      localizedRoutes: true,
      translatedSlugs: true,
      navigation: true,
      surroundings: true,
      searchSections: true,
      sitemap: true,
      query: {
        operators: [...SUPPORTED_QUERY_OPERATORS],
        limit: true,
        skip: true,
        count: true
      }
    },
    query,
    navigationQuery: async (event, params) => {
      const docs = await docsForNavigation(event, params)
      collectProviderFixtureCacheHint(event, {
        tags: [
          ...(params.collection ? [collectionTag(params.collection)] : []),
          ...(params.resolveLocale?.locale ? [`nav:${params.collection || 'all'}:${params.resolveLocale.locale}`] : [])
        ]
      })
      const queryLocale = params.resolveLocale?.locale
      return docs.map(doc => ({
        title: doc.title,
        ...navIdentityFromDoc(doc),
        _path: doc._path,
        path: localizePath(fixture, doc._collection || params.collection || '', doc._path || '/', queryLocale || doc._requestedLocale || doc._locale),
        _locale: doc._locale
      })) as NavItem[]
    },
    navigation: async (event, collection, options = {}) => {
      assertCollection(collection)
      const fields = Array.isArray(options) ? options : options.fields || []
      const locale = typeof options === 'object' && !Array.isArray(options) ? options.locale : undefined
      collectProviderFixtureCacheHint(event, {
        tags: [`nav:${collection}:${locale || fixture.defaultLocale}`, collectionTag(collection)]
      })
      const docs = await docsForNavigation(event, {
        collection,
        resolveLocale: locale
          ? {
              locale,
              fallback: fixture.localeFallback[locale] || [fixture.defaultLocale]
            }
          : undefined,
        sort: [{ _path: 1 }]
      })
      return docs.map(doc => ({
        title: doc.title,
        ...navFieldsFromDoc(doc, fields),
        ...navIdentityFromDoc(doc),
        _path: doc._path,
        path: localizePath(fixture, collection, doc._path || '/', locale || doc._locale),
        _locale: doc._locale
      })) as NavItem[]
    },
    surroundings: async (event, collection, path, options = {}) => {
      assertCollection(collection)
      const locale = options.locale
      const docs = await docsForNavigation(event, {
        collection,
        resolveLocale: locale
          ? {
              locale,
              fallback: fixture.localeFallback[locale] || [fixture.defaultLocale]
            }
          : undefined,
        sort: [{ _path: 1 }]
      })
      const index = docs.findIndex(doc => doc._path === path || localizePath(fixture, collection, doc._path || '/', locale || doc._locale) === path)
      if (index === -1) return [null, null]
      return [docs[index - 1] || null, docs[index + 1] || null].map(doc => doc
        ? {
            title: doc.title,
            _path: doc._path,
            path: localizePath(fixture, collection, doc._path || '/', locale || doc._locale)
          }
        : null) as Array<NavItem | null>
    },
    searchSections: async (event, collection, options = {}) => {
      assertCollection(collection)
      collectProviderFixtureCacheHint(event, {
        tags: [`search:${options.locale || fixture.defaultLocale}`, collectionTag(collection)]
      })
      const docs = await docsForNavigation(event, {
        collection,
        where: options.filterQuery,
        resolveLocale: options.locale
          ? {
              locale: options.locale,
              fallback: fixture.localeFallback[options.locale] || [fixture.defaultLocale]
            }
          : undefined
      })
      const extraFields = options.extraFields || []
      return docs.map(doc => ({
        ...Object.fromEntries(extraFields
          .filter(field => field in doc)
          .map(field => [field, (doc as Record<string, unknown>)[field]])),
        id: localizePath(fixture, collection, doc._path || '/', options.locale || doc._locale),
        title: doc.title || '',
        titles: [doc.title || ''],
        content: String(doc.description || doc.title || ''),
        level: 1
      }))
    },
    search: async (_event, request) => {
      const term = request.term.toLocaleLowerCase()
      return fixture.documents
        .filter(doc => !request.collections?.length || request.collections.includes(doc._collection || ''))
        .filter(doc => !request.locale || doc._locale === request.locale)
        .filter(doc => String(doc.title || '').toLocaleLowerCase().includes(term))
        .map(doc => ({
          score: 1,
          collection: doc._collection || '',
          title: doc.title || '',
          excerpt: String(doc.description || ''),
          path: localizePath(fixture, doc._collection || '', doc._path || '/', doc._locale),
          locale: doc._locale
        }))
    },
    siteData: async (event, request) => {
      collectProviderFixtureCacheHint(event, {
        tags: [`site-data:${request.key}:${request.locale || fixture.defaultLocale}`]
      })
      return {
        key: request.key,
        locale: request.locale,
        data: null,
        updatedAt: 0
      }
    },
    page: async <T = ParsedContent>(event: H3Event, collection: string, routeOrPath = '/', options: ContentCollectionPageOptions = {}) => {
      assertCollection(collection)
      if (fixture.collections[collection]?.type === 'data') {
        throw createContentProviderError('data_collection_route_access', `${collection} is a data collection.`, { collection })
      }
      const segments = routeOrPath.split('/').filter(Boolean)
      const routeLocale = segments[0] && fixture.locales.includes(segments[0]) ? segments[0] : undefined
      const providerRoute = routeLocale ? `/${segments.slice(1).join('/')}` : routeOrPath
      const requestedLocale = options.locale || routeLocale
      const response = await query<ParsedContent>(event, {
        collection,
        first: true,
        resolveVariant: {
          route: providerRoute,
          locale: requestedLocale,
          fallback: options.fallback === false ? [] : fixture.localeFallback[requestedLocale || ''] || [fixture.defaultLocale],
          exact: options.exact
        }
      } as ContentQueryBuilderParams)
      const doc = unwrapResponseResult<ParsedContent>(response) as ParsedContent | undefined
      if (!doc) return null
      const page = localizePageResult(
        doc,
        requestedLocale || doc._resolvedLocale || doc._locale,
        fixture.defaultLocale,
        fixture.locales,
        routeMountsFor(fixture, collection)
      )
      const hint = createCacheHintForDocument(fixture, doc, page.path)
      collectProviderFixtureCacheHint(event, hint)
      recordRouteDependencies(cache, page.path, hint.tags || [])
      return page as unknown as ContentPageResult<T>
    },
    routeMeta: async (event, collection, routeOrPath = '/', options = {}) => {
      const page = await provider.page!(event, collection, routeOrPath, options)
      return page
        ? createRouteMeta(page as any, options.locale || (page as any).locale, fixture.defaultLocale, routeMountsFor(fixture, collection))
        : null
    },
    sitemapEntries: async (event, options = {}) => {
      collectProviderFixtureCacheHint(event, { tags: ['sitemap'] })
      const explicitInclude = Boolean(options.include?.length)
      const include = explicitInclude ? options.include! : Object.keys(fixture.collections)
      const entries = []
      for (const collection of include) {
        assertCollection(collection)
        if (fixture.collections[collection]?.type === 'data' || fixture.collections[collection]?.sitemap === false) {
          if (explicitInclude) {
            throw createContentProviderError('data_collection_sitemap_access', `${collection} cannot be listed in the sitemap.`, { collection })
          }
          continue
        }
        for (const doc of fixture.documents.filter(doc => doc._collection === collection && !doc._draft && !doc._partial && !doc._navigation)) {
          entries.push({
            loc: localizePath(fixture, collection, doc._path || '/', doc._locale)
          })
        }
      }
      return entries
    },
    invalidate: async (_event, input) => {
      invalidateFixtureCache(cache, input)
    }
  }

  return Object.assign(provider as ContentProvider, { cache })
}

export const createSaasProviderFixture = () => createProviderFixture({
  name: 'saas-i18n',
  providerName: 'fixture',
  defaultLocale: 'en',
  locales: ['en', 'de'],
  localeFallback: { de: ['en'] },
  collections: {
    docs: {
      type: 'page',
      i18n: { defaultLocale: 'en', locales: ['en', 'de'] },
      route: { en: '/docs', de: '/dokumentation' }
    },
    posts: {
      type: 'page',
      i18n: { defaultLocale: 'en', locales: ['en', 'de'] },
      route: { en: '/blog', de: '/magazin' }
    },
    authors: {
      type: 'page',
      i18n: { defaultLocale: 'en', locales: ['en', 'de'] },
      route: { en: '/authors', de: '/autoren' }
    },
    versions: {
      type: 'data',
      i18n: { defaultLocale: 'en', locales: ['en', 'de'] },
      sitemap: false
    }
  },
  documents: [
    {
      _collection: 'docs',
      _locale: 'en',
      _canonicalKey: 'docs:getting-started',
      _path: '/docs/getting-started',
      ref: 'docs.getting-started',
      title: 'Getting Started',
      description: 'Start here',
      order: 1
    },
    {
      _collection: 'docs',
      _locale: 'de',
      _canonicalKey: 'docs:getting-started',
      _path: '/dokumentation/einstieg',
      ref: 'docs.getting-started',
      title: 'Einstieg',
      description: 'Hier starten',
      order: 1
    },
    {
      _collection: 'docs',
      _locale: 'de',
      _canonicalKey: 'docs:getting-started-installation',
      _path: '/dokumentation/einstieg/installation',
      ref: 'docs.getting-started.installation',
      title: 'Installation',
      description: 'Installieren',
      order: 2
    },
    {
      _collection: 'docs',
      _locale: 'de',
      _canonicalKey: 'docs:getting-started-everyday',
      _path: '/dokumentation/einstieg/alltag',
      ref: 'docs.getting-started.everyday',
      title: 'Alltag',
      description: 'Arbeiten',
      order: 3
    },
    {
      _collection: 'docs',
      _locale: 'en',
      _canonicalKey: 'docs:markdown-syntax',
      _path: '/docs/essentials/markdown-syntax',
      ref: 'docs.markdown-syntax',
      title: 'Markdown Syntax',
      description: 'Writing docs',
      order: 4
    },
    {
      _collection: 'docs',
      _locale: 'en',
      _canonicalKey: 'docs:draft-roadmap',
      _path: '/docs/draft-roadmap',
      ref: 'docs.draft-roadmap',
      title: 'Draft Roadmap',
      description: 'Unpublished draft',
      _draft: true,
      order: 5
    },
    {
      _collection: 'docs',
      _locale: 'de',
      _canonicalKey: 'docs:markdown-syntax',
      _path: '/dokumentation/grundlagen/markdown-syntax',
      ref: 'docs.markdown-syntax',
      title: 'Markdown Syntax DE',
      description: 'Dokumentation schreiben',
      order: 4
    },
    {
      _collection: 'posts',
      _locale: 'en',
      _canonicalKey: 'posts:onboarding',
      _path: '/blog/multilingual-onboarding',
      ref: 'posts.onboarding',
      title: 'Multilingual Onboarding',
      description: 'Launch notes',
      date: '2026-01-02',
      authors: ['authors.emily']
    },
    {
      _collection: 'posts',
      _locale: 'de',
      _canonicalKey: 'posts:onboarding',
      _path: '/magazin/mehrsprachiges-onboarding',
      ref: 'posts.onboarding',
      title: 'Mehrsprachiges Onboarding',
      description: 'Startnotizen',
      date: '2026-01-03',
      authors: ['authors.emily']
    },
    {
      _collection: 'authors',
      _locale: 'en',
      _canonicalKey: 'authors:emily',
      _path: '/authors/emily',
      ref: 'authors.emily',
      title: 'Emily',
      name: 'Emily',
      description: 'Author'
    },
    {
      _collection: 'authors',
      _locale: 'de',
      _canonicalKey: 'authors:emily',
      _path: '/autoren/emily',
      ref: 'authors.emily',
      title: 'Emily DE',
      name: 'Emily',
      description: 'Autorin'
    },
    {
      _collection: 'versions',
      _locale: 'en',
      _canonicalKey: 'versions:launch-readiness',
      _path: '/changelog/launch-readiness',
      ref: 'versions.launch-readiness',
      title: 'Launch readiness',
      date: '2026-01-01'
    }
  ]
})

export const createAuthorDependencyProviderFixture = () => createProviderFixture({
  name: 'author-dependencies',
  providerName: 'fixture',
  defaultLocale: 'en',
  locales: ['en'],
  collections: {
    blog: { type: 'page', route: '/blog' },
    authors: { type: 'page', route: '/authors' }
  },
  documents: [
    { _collection: 'authors', _path: '/authors/alice', ref: 'authors.alice', title: 'Alice', name: 'Alice' },
    { _collection: 'authors', _path: '/authors/bob', ref: 'authors.bob', title: 'Bob', name: 'Bob' },
    ...Array.from({ length: 5 }, (_, index) => ({
      _collection: 'blog',
      _path: `/blog/post-${index + 1}`,
      ref: `blog.post-${index + 1}`,
      title: `Post ${index + 1}`,
      authors: ['authors.alice']
    })),
    {
      _collection: 'blog',
      _path: '/blog/post-6',
      ref: 'blog.post-6',
      title: 'Post 6',
      authors: ['authors.bob']
    }
  ]
})
