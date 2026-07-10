import {
  createContentProviderError,
  shapeProviderDocument,
  withContentCache,
  type ContentPageResult,
  type ContentProvider,
  type ContentProviderQuery,
  type ContentSearchSection,
  type ProviderDocumentInput
} from '#content/server'
import {
  authors,
  postByPath,
  posts,
  providerCacheEvents
} from './cms-store'

// This provider is single-locale (`en`). Core derives the localized route
// envelope (`path`, `variants`, `localePaths`, `resolved`) from these options.
const shapeOptions = { defaultLocale: 'en', locales: ['en'] }

// A third-party provider emits ONLY the canonical envelope's required fields —
// `id`, `collection`, `locale`, `path`, `canonicalKey`, `type`, `body` (plus any
// frontmatter data) — and never hand-builds route/locale metadata. `file` is
// omitted because CMS-backed documents have no backing file.
const postDocument = (path: string): ProviderDocumentInput | null => {
  const post = postByPath(path)
  if (!post) return null

  const author = authors.get(post.author)
  return {
    id: `cms:blog:${post.id}`,
    collection: 'blog',
    locale: 'en',
    path: post.path,
    canonicalKey: `blog:${post.id}`,
    type: 'markdown',
    body: { type: 'root', children: [] },
    ref: post.id,
    title: post.title,
    author: post.author,
    authorName: author?.name
  }
}

const authorDocument = (path: string): ProviderDocumentInput | null => {
  const id = path.replace(/^\/authors\//, '')
  const author = authors.get(id)
  if (!author) return null

  return {
    id: `cms:authors:${author.id}`,
    collection: 'authors',
    locale: 'en',
    path: `/authors/${author.id}`,
    canonicalKey: `authors:${author.id}`,
    type: 'markdown',
    body: { type: 'root', children: [] },
    ref: author.id,
    title: author.name,
    name: author.name
  }
}

const documentFor = (collection: string, routeOrPath = '/'): ProviderDocumentInput | null => {
  if (collection === 'blog') return postDocument(routeOrPath)
  if (collection === 'authors') return authorDocument(routeOrPath)
  throw createContentProviderError('unknown_collection', `Unknown collection: ${collection}`, { collection })
}

const pageFor = (collection: string, routeOrPath = '/'): ContentPageResult<Record<string, unknown>> | null => {
  const document = documentFor(collection, routeOrPath)
  return document ? shapeProviderDocument(document, shapeOptions) : null
}

const listFor = (collection?: string) => {
  if (!collection || collection === 'blog') {
    return Array.from(posts.values())
      .map(post => pageFor('blog', post.path))
      .filter(Boolean) as ContentPageResult<Record<string, unknown>>[]
  }
  if (collection === 'authors') {
    return Array.from(authors.values())
      .map(author => pageFor('authors', `/authors/${author.id}`))
      .filter(Boolean) as ContentPageResult<Record<string, unknown>>[]
  }
  throw createContentProviderError('unknown_collection', `Unknown collection: ${collection}`, { collection })
}

export default {
  name: 'cms-demo',
  capabilities: {
    routeBackedCollections: true,
    dataCollections: true,
    localizedRoutes: false,
    translatedSlugs: false,
    navigation: true,
    surroundings: false,
    searchSections: true,
    sitemap: true,
    query: {
      operators: ['$eq'],
      pagination: ['offset']
    }
  },
  async query(_event, query: ContentProviderQuery) {
    const collection = query.collection ?? undefined
    return withContentCache(listFor(collection), {
      tags: collection ? [`collection:${collection}`] : ['collection:blog', 'collection:authors'],
      maxAge: 300,
      swr: 60
    })
  },
  async page(_event, collection, routeOrPath = '/') {
    const page = pageFor(collection, routeOrPath)
    if (!page) return null

    const tags = [
      `entry:${collection}:${String(page.ref)}`,
      `collection:${collection}`,
      `route:${page.path}`
    ]

    if (collection === 'blog' && typeof page.author === 'string') {
      tags.push(`entry:authors:${page.author}`)
    }

    return withContentCache(page, {
      tags,
      paths: [page.path],
      maxAge: 300,
      swr: 60,
      lastModified: new Date()
    })
  },
  async routeMeta(_event, collection, routeOrPath = '/') {
    return pageFor(collection, routeOrPath)
  },
  async navigation(_event, collection) {
    return withContentCache(listFor(collection).map(page => ({
      title: String(page.title),
      path: page.path
    })), {
      tags: [`nav:${collection}:en`, `collection:${collection}`],
      maxAge: 300
    })
  },
  async navigationQuery() {
    return withContentCache(Array.from(posts.values()).map(post => ({
      title: post.title,
      path: post.path
    })), {
      tags: ['nav:blog:en'],
      maxAge: 300
    })
  },
  async searchSections(): Promise<ContentSearchSection[]> {
    return Array.from(posts.values()).map(post => ({
      id: post.path,
      title: post.title,
      titles: [post.title],
      content: `${post.title} ${authors.get(post.author)?.name || ''}`,
      level: 1
    }))
  },
  async sitemapEntries() {
    return withContentCache(Array.from(posts.values()).map(post => ({
      loc: post.path
    })), {
      tags: ['sitemap', 'collection:blog']
    })
  },
  async invalidate(_event, input) {
    providerCacheEvents.push({ source: 'provider', ...input })
  }
} satisfies ContentProvider
