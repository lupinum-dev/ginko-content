import type { ContentCacheHint, ContentProvider, ContentProviderQuery } from '../public/provider'
import {
  CONTENT_DATA_SOURCE_LIMITS,
  createContentDataSourceError,
  type ContentDataSource,
  type ContentDataSourceControl,
  type ContentDataSourceResult,
} from '../public/data-source'
import { isContentProviderResult } from '../core/provider-result'
import type { H3Event } from 'h3'
import type { ContentQueryFindResponse, ContentQueryResponse } from '../types/api'
import type { ContentFileMeta, ParsedContent } from '../types/content'
import { buildContentGraph, type ContentGraph } from '../core/content/graph'
import { trimSlashes } from '../core/content/path'
import { executeQueryPlan } from '../core/query/execute'
import { PROVIDER_CAPABILITY_OPERATORS } from '../core/query/operators'
import { mergeContentCacheHints } from '../core/cache-hints'
import { normalizeContentPath } from '../features/localization/path'
import {
  normalizeProviderDocument,
  type ProviderDocumentInput,
  type ValidatedProviderDocument
} from '../public/provider-document'
import { createContentProviderError } from '../public/provider-errors'
import {
  resolveLocalePolicy,
  type ResolvedCollectionLocalePolicy
} from '../features/localization/locale-policy'
import { fromContentProviderQueryPlan } from '../features/query/query-plan-boundary'
import {
  mountProviderContentPath,
  unmountProviderContentPath
} from '../features/localization/route-projector'

export interface ProviderFixtureCollection {
  type: 'page' | 'data'
  i18n?: boolean | { locales?: string[], defaultLocale?: string }
  route?: string | Record<string, string>
  sitemap?: boolean
}

type ProviderFixtureRuntimeCollection = ProviderFixtureCollection & {
  localePolicy: ResolvedCollectionLocalePolicy
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
    collections: Record<string, ProviderFixtureRuntimeCollection>
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

/**
 * Every fixture document must belong to a declared collection, because the
 * collection is where its route mount lives. Falling back to an unmounted path
 * would let a conformance run pass while proving nothing about mounting.
 */
const collectionLocalePolicy = (
  collections: Record<string, ProviderFixtureRuntimeCollection>,
  collection: string | undefined
): ResolvedCollectionLocalePolicy => {
  const policy = collection ? collections[collection]?.localePolicy : undefined
  if (!policy) {
    throw new Error(
      `@lupinum/ginko-content: provider fixture document declares collection "${collection || ''}", `
      + `which is not one of the fixture's collections (${Object.keys(collections).join(', ') || 'none'}).`
    )
  }
  return policy
}

const normalizeQueryResult = <T>(value: T | T[] | number | undefined): T[] => {
  if (Array.isArray(value)) return value
  return value && typeof value === 'object' ? [value] : []
}

const collectionTag = (collection: string) => `collection:${collection}`

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

const createProviderFixtureCacheState = (): ProviderFixtureCacheState => ({
  events: [],
  dependenciesByPath: new Map(),
  pathsByTag: new Map(),
  renderedPaths: new Set()
})

export const createProviderFixtureDocument = (
  input: Partial<ParsedContent> & Record<string, unknown>
): ValidatedProviderDocument => {
  const { path: inputPath, resolved, route, resolution, dir, variants, localePaths, unprefixedPath, ...data } = input
  void resolved
  void route
  void resolution
  void dir
  void variants
  void localePaths
  void unprefixedPath
  const collection = String(input.collection || 'docs')
  const locale = String(input.locale || 'en')
  const path = String(inputPath || '/')
  const canonicalKey = String(input.canonicalKey || `${collection}:${trimSlashes(path) || 'index'}`)
  const type = (input.type || 'markdown') as ParsedContent['type']
  const extension = input.file?.extension || (input.type === 'yaml' ? 'yml' : 'md')

  // Route the fixture through the shared provider-document seam so the whole
  // conformance suite exercises the same normalization third-party providers
  // rely on. Identity fields are defaulted here (test ergonomics) and passed
  // through unchanged; `file`/`title`/`body` fixture defaults ride along.
  return normalizeProviderDocument({
    ...data,
    collection,
    locale,
    contentPath: path,
    canonicalKey,
    type,
    id: String(input.id || `content:${locale}:${trimSlashes(path).replace(/\//g, ':') || 'index'}.${extension}`),
    file: {
      source: String(input.file?.source || 'content'),
      path: String(input.file?.path || `/${locale}/${trimSlashes(path) || 'index'}.${extension}`),
      extension: extension as ContentFileMeta['extension']
    },
    title: String(input.title || canonicalKey),
    body: input.body ?? {
      type: 'root',
      children: []
    }
  })
}

export const createProviderFixture = (input: ProviderFixtureInput): ProviderFixture => {
  const defaultLocale = input.defaultLocale || 'en'
  const locales = Array.from(new Set([defaultLocale, ...(input.locales || [])]))
  const localeFallback = input.localeFallback || Object.fromEntries(
    locales
      .filter(locale => locale !== defaultLocale)
      .map(locale => [locale, [defaultLocale]])
  )
  const localePolicy = resolveLocalePolicy({
    nuxtI18n: { installed: false },
    content: { locales, defaultLocale, fallback: localeFallback },
    collections: Object.entries(input.collections).map(([name, collection]) => ({
      name,
      localized: Boolean(collection.i18n),
      ...(collection.i18n && typeof collection.i18n === 'object'
        ? {
            locales: collection.i18n.locales,
            defaultLocale: collection.i18n.defaultLocale
          }
        : {}),
      route: collection.route
    }))
  })
  const runtimeCollections = Object.fromEntries(
    Object.entries(input.collections).map(([name, collection]) => [
      name,
      { ...collection, localePolicy: localePolicy.collections[name]! }
    ])
  )
  const documents = input.documents.map((inputDocument) => {
    const document = createProviderFixtureDocument(inputDocument)
    // Mount validation is the point of this fixture: a document whose
    // collection was never declared must fail here rather than quietly skip
    // the unmount and let a conformance run pass without proving anything.
    const policy = collectionLocalePolicy(runtimeCollections, document.collection)
    return {
      ...document,
      path: unmountProviderContentPath(document.contentPath, document.locale || defaultLocale, policy)
    }
  })
  const graph = buildContentGraph(documents, { defaultLocale, locales })

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
      collections: runtimeCollections
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

  const execute = (providerQuery: ContentProviderQuery) => {
    assertCollection(providerQuery.collection ?? undefined)
    const policy = providerQuery.collection
      ? fixture.runtime.collections[providerQuery.collection]?.localePolicy
      : undefined
    const canonicalPlan = fromContentProviderQueryPlan(providerQuery.plan, providerQuery.collection, policy)
    return executeQueryPlan<ParsedContent>(
      fixture.graph,
      {
        ...canonicalPlan,
        filter: {
          type: 'and',
          clauses: [
            canonicalPlan.filter,
            { type: 'compare', field: 'draft', operator: 'ne', value: true }
          ]
        },
        // Preserve complete provider documents until the canonical response
        // shaper applies the public projection after normalization.
        projection: { only: [], without: [] }
      },
      { ...fixture.runtime, includeDrafts: false }
    )
  }

  const routeVariantsFor = (doc: ParsedContent) => fixture.documents
    .filter(candidate =>
      candidate.canonicalKey === doc.canonicalKey
      && candidate.path
      && candidate.locale
      && candidate.draft !== true
      && candidate.partial !== true
      && candidate.navigationFile !== true
    )
    .map(candidate => ({
      locale: candidate.locale!,
      contentPath: mountProviderContentPath({
        locale: candidate.locale!,
        contentPath: normalizeContentPath(candidate.path!)
      }, collectionLocalePolicy(fixture.runtime.collections, candidate.collection))
    }))

  const toRawDocument = (doc: ParsedContent) => {
    const { path, resolved, route, resolution, dir, variants, localePaths, unprefixedPath, ...data } = doc as ParsedContent & Record<string, unknown>
    void route
    void resolution
    void dir
    void variants
    void localePaths
    void unprefixedPath
    return {
      ...data,
      id: doc.id,
      collection: doc.collection || '',
      canonicalKey: doc.canonicalKey || '',
      locale: doc.locale || '',
      contentPath: (() => {
        const policy = fixture.runtime.collections[doc.collection || '']?.localePolicy
        return policy
          ? mountProviderContentPath({
              locale: doc.locale || fixture.defaultLocale,
              contentPath: normalizeContentPath(path || '/')
            }, policy)
          : normalizeContentPath(path || '/')
      })(),
      routeVariants: routeVariantsFor(doc),
      type: doc.type,
      body: doc.body ?? null,
      ...(doc.file ? { file: doc.file } : {})
    }
  }

  const mapResponse = (response: ContentQueryResponse<ParsedContent>): ContentQueryResponse<ProviderDocumentInput> => {
    if (typeof response.result === 'number') return { result: response.result }
    if (Array.isArray(response.result)) {
      const list = response as ContentQueryFindResponse<ParsedContent>
      const result = response.result.map(toRawDocument)
      return list.mode === 'cursor'
        ? { mode: 'cursor', result, limit: list.limit, pageInfo: list.pageInfo }
        : {
            ...(list.mode === 'offset' ? { mode: 'offset' as const } : {}),
            result,
            skip: list.skip,
            limit: list.limit,
            total: list.total,
          }
    }
    return { result: response.result ? toRawDocument(response.result) : undefined }
  }

  const query: ContentProvider['query'] = async (event: H3Event, providerQuery: ContentProviderQuery) => {
    collectProviderFixtureCacheHint(event, {
      tags: providerQuery.collection ? [collectionTag(providerQuery.collection)] : []
    })
    return mapResponse(execute(providerQuery))
  }

  const navigationDocuments = (providerQuery: ContentProviderQuery) => {
    // Projection governs the extra fields returned by navigation; it must not
    // remove the identity and eligibility facts needed to build raw routes.
    const response = execute({
      ...providerQuery,
      plan: {
        ...providerQuery.plan,
        projection: { only: [], without: [] }
      }
    })
    return normalizeQueryResult<ParsedContent>(response.result as ParsedContent | ParsedContent[] | number | undefined)
      .filter(doc => !doc.draft && !doc.partial && !doc.navigationFile && doc.navigation !== false && doc.path)
  }

  const routeFact = (doc: ParsedContent) => {
    const collection = doc.collection || ''
    const locale = doc.locale || fixture.defaultLocale
    const policy = fixture.runtime.collections[collection]?.localePolicy
    return {
      collection,
      canonicalKey: doc.canonicalKey || '',
      locale,
      contentPath: policy
        ? mountProviderContentPath({
            locale,
            contentPath: normalizeContentPath(doc.path || '/')
          }, policy)
        : normalizeContentPath(doc.path || '/')
    }
  }

  const provider: ContentProvider = {
    name: name as ContentProvider['name'],
    capabilities: {
      query: {
        operators: [
          ...PROVIDER_CAPABILITY_OPERATORS
        ],
        pagination: ['offset', 'cursor']
      }
    },
    query,
    navigation: async (event, providerQuery) => {
      const docs = navigationDocuments(providerQuery)
      const collection = providerQuery.collection ?? undefined
      const queryLocale = providerQuery.plan.resolveLocale?.locale
      collectProviderFixtureCacheHint(event, {
        tags: [
          ...(collection ? [collectionTag(collection)] : []),
          ...(queryLocale ? [`nav:${collection || 'all'}:${queryLocale}`] : [])
        ]
      })
      return docs.map(doc => ({
        title: String(doc.title || ''),
        ...Object.fromEntries(providerQuery.plan.projection.only
          .filter(field => !['path', 'href', 'localePath', 'alternates', 'route', 'resolution'].includes(field) && field in doc)
          .map(field => [field, (doc as Record<string, unknown>)[field]])),
        route: routeFact(doc)
      }))
    },
    surroundings: async (event, collection, contentPath, options = {}) => {
      assertCollection(collection)
      collectProviderFixtureCacheHint(event, { tags: [collectionTag(collection)] })
      const docs = fixture.documents
        .filter(doc => doc.collection === collection && !doc.draft && !doc.partial && !doc.navigationFile && doc.path)
        .filter(doc => !options.locale || doc.locale === options.locale)
        .sort((a, b) => String(a.path).localeCompare(String(b.path)))
      const policy = fixture.runtime.collections[collection]?.localePolicy
      const canonicalPath = policy
        ? unmountProviderContentPath(contentPath, options.locale || policy.defaultLocale, policy)
        : normalizeContentPath(contentPath)
      const index = docs.findIndex(doc => normalizeContentPath(doc.path || '/') === canonicalPath)
      if (index === -1) return [null, null]
      return [docs[index - 1] || null, docs[index + 1] || null].map(doc => doc
        ? {
            title: String(doc.title || ''),
            ...Object.fromEntries((options.select || [])
              .filter(field => field in doc)
              .map(field => [field, (doc as Record<string, unknown>)[field]])),
            route: routeFact(doc)
          }
        : null)
    },
    search: async (_event, request) => {
      const term = request.term.toLocaleLowerCase()
      return fixture.documents
        .filter(doc => !doc.draft)
        .filter(doc => !request.collections?.length || request.collections.includes(doc.collection || ''))
        .filter(doc => !request.locale || doc.locale === request.locale)
        .filter(doc => String(doc.title || '').toLocaleLowerCase().includes(term))
        .map(doc => ({
          score: 1,
          title: doc.title || '',
          excerpt: String(doc.description || ''),
          route: routeFact(doc)
        }))
    },
    siteData: async (event, request) => {
      collectProviderFixtureCacheHint(event, {
        tags: [`site-data:${request.key}:${request.locale || fixture.defaultLocale}`]
      })
      return {
        data: null,
        updatedAt: 0
      }
    },
    routes: async (event) => {
      collectProviderFixtureCacheHint(event, { tags: ['sitemap'] })
      return fixture.documents
        .filter(doc => fixture.collections[doc.collection || '']?.type !== 'data')
        .filter(doc => !doc.partial && !doc.navigationFile && doc.path)
        .map(doc => ({
          ...routeFact(doc),
          ...(doc.draft ? { draft: true } : {}),
          ...(doc.sitemap === false ? { sitemap: false as const } : {})
        }))
    }
  }

  return Object.assign(provider as ContentProvider, { cache })
}

const fixtureResult = <T>(value: T | import('../public/provider').ContentProviderResult<T>): ContentDataSourceResult<T> => ({
  data: isContentProviderResult(value) ? value.data : value,
  cache: false,
})

const assertFixtureControl = (control: ContentDataSourceControl) => {
  control.signal.throwIfAborted()
  if (Date.now() >= control.deadlineAt) throw createContentDataSourceError('BACKEND_FAILURE')
}

/** In-memory reference adapter for tests, examples, and adapter prototyping. */
export const createFixtureContentDataSource = (
  fixture: ProviderFixture,
  name = fixture.providerName,
): ContentDataSource<unknown> => {
  const provider = createFixtureContentProvider(fixture, name)
  const event = () => createProviderFixtureEvent({ fixture, provider })
  return {
    name,
    capabilities: {
      protocol: 'ginko-content-data-source/v1',
      query: {
        operators: provider.capabilities.query.operators,
        pagination: provider.capabilities.query.pagination,
        maxPageSize: CONTENT_DATA_SOURCE_LIMITS.maxQueryPageSize,
      },
    },
    async query(_context, query, control) {
      assertFixtureControl(control)
      return fixtureResult(await provider.query(event(), query))
    },
    async navigation(_context, query, _options, control) {
      assertFixtureControl(control)
      return fixtureResult(await provider.navigation!(event(), query))
    },
    async surroundings(_context, collection, contentPath, options, control) {
      assertFixtureControl(control)
      return fixtureResult(await provider.surroundings!(event(), collection, contentPath, options))
    },
    async search(_context, request, control) {
      assertFixtureControl(control)
      const value = fixtureResult(await provider.search!(event(), request))
      return { ...value, data: value.data.slice(0, request.limit) }
    },
    async siteData(_context, request, control) {
      assertFixtureControl(control)
      const value = fixtureResult(await provider.siteData!(event(), request))
      return {
        ...value,
        data: {
          key: request.key,
          locale: request.locale ?? null,
          data: value.data.data,
          updatedAt: value.data.updatedAt ?? null,
        },
      }
    },
    async routes(_context, request, control) {
      assertFixtureControl(control)
      const value = fixtureResult(await provider.routes!(event()))
      const prefix = 'fixture:'
      const offset = request.cursor === null
        ? 0
        : request.cursor.startsWith(prefix)
          ? Number(request.cursor.slice(prefix.length))
          : Number.NaN
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > value.data.length) {
        throw createContentDataSourceError('QUERY_CURSOR_INVALID')
      }
      const items = value.data.slice(offset, offset + request.limit)
      const nextOffset = offset + items.length
      return {
        ...value,
        data: {
          items,
          nextCursor: nextOffset < value.data.length ? `${prefix}${nextOffset}` : null,
          snapshot: fixture.name,
        },
      }
    },
  }
}

export const createDefaultProviderFixture = () => createProviderFixture({
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
      collection: 'docs',
      locale: 'en',
      canonicalKey: 'docs:getting-started',
      path: '/docs/getting-started',
      ref: 'docs.getting-started',
      title: 'Getting Started',
      description: 'Start here',
      tags: ['guide', 'start'],
      featured: true,
      rating: 5,
      order: 1
    },
    {
      collection: 'docs',
      locale: 'de',
      canonicalKey: 'docs:getting-started',
      path: '/dokumentation/einstieg',
      ref: 'docs.getting-started',
      title: 'Einstieg',
      description: 'Hier starten',
      order: 1
    },
    {
      collection: 'docs',
      locale: 'de',
      canonicalKey: 'docs:getting-started-installation',
      path: '/dokumentation/einstieg/installation',
      ref: 'docs.getting-started.installation',
      title: 'Installation',
      description: 'Installieren',
      order: 2
    },
    {
      collection: 'docs',
      locale: 'de',
      canonicalKey: 'docs:getting-started-everyday',
      path: '/dokumentation/einstieg/alltag',
      ref: 'docs.getting-started.everyday',
      title: 'Alltag',
      description: 'Arbeiten',
      order: 3
    },
    {
      collection: 'docs',
      locale: 'en',
      canonicalKey: 'docs:markdown-syntax',
      path: '/docs/essentials/markdown-syntax',
      ref: 'docs.markdown-syntax',
      title: 'Markdown Syntax',
      description: 'Writing docs',
      order: 4
    },
    {
      collection: 'docs',
      locale: 'en',
      canonicalKey: 'docs:draft-roadmap',
      path: '/docs/draft-roadmap',
      ref: 'docs.draft-roadmap',
      title: 'Draft Roadmap',
      description: 'Unpublished draft',
      draft: true,
      order: 5
    },
    {
      collection: 'docs',
      locale: 'de',
      canonicalKey: 'docs:markdown-syntax',
      path: '/dokumentation/grundlagen/markdown-syntax',
      ref: 'docs.markdown-syntax',
      title: 'Markdown Syntax DE',
      description: 'Dokumentation schreiben',
      order: 4
    },
    {
      collection: 'posts',
      locale: 'en',
      canonicalKey: 'posts:onboarding',
      path: '/blog/multilingual-onboarding',
      ref: 'posts.onboarding',
      title: 'Multilingual Onboarding',
      description: 'Launch notes',
      date: '2026-01-02',
      authors: ['authors.emily']
    },
    {
      collection: 'posts',
      locale: 'de',
      canonicalKey: 'posts:onboarding',
      path: '/magazin/mehrsprachiges-onboarding',
      ref: 'posts.onboarding',
      title: 'Mehrsprachiges Onboarding',
      description: 'Startnotizen',
      date: '2026-01-03',
      authors: ['authors.emily']
    },
    {
      collection: 'authors',
      locale: 'en',
      canonicalKey: 'authors:emily',
      path: '/authors/emily',
      ref: 'authors.emily',
      title: 'Emily',
      name: 'Emily',
      description: 'Author'
    },
    {
      collection: 'authors',
      locale: 'de',
      canonicalKey: 'authors:emily',
      path: '/autoren/emily',
      ref: 'authors.emily',
      title: 'Emily DE',
      name: 'Emily',
      description: 'Autorin'
    },
    {
      collection: 'versions',
      locale: 'en',
      canonicalKey: 'versions:launch-readiness',
      path: '/changelog/launch-readiness',
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
    { collection: 'authors', path: '/authors/alice', ref: 'authors.alice', title: 'Alice', name: 'Alice' },
    { collection: 'authors', path: '/authors/bob', ref: 'authors.bob', title: 'Bob', name: 'Bob' },
    ...Array.from({ length: 5 }, (_, index) => ({
      collection: 'blog',
      path: `/blog/post-${index + 1}`,
      ref: `blog.post-${index + 1}`,
      title: `Post ${index + 1}`,
      authors: ['authors.alice']
    })),
    {
      collection: 'blog',
      path: '/blog/post-6',
      ref: 'blog.post-6',
      title: 'Post 6',
      authors: ['authors.bob']
    }
  ]
})
