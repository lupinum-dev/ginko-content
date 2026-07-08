import {
  createContentProviderError,
  withContentCache,
  type ContentPageResult,
  type ContentProvider,
  type ContentProviderQuery,
  type ContentRouteMeta,
  type ContentSearchSection
} from '#content/server'
import {
  authors,
  postByPath,
  posts,
  providerCacheEvents
} from './cms-store'

const routeMeta = (path: string): ContentRouteMeta => ({
  locale: 'en',
  defaultLocale: 'en',
  path,
  canonicalPath: path,
  variants: [],
  localePaths: {
    en: {
      path,
      locale: 'en',
      translated: true
    }
  },
  resolved: {
    locale: 'en',
    requestedLocale: 'en',
    resolvedLocale: 'en',
    fallback: false,
    path,
    availableLocales: ['en']
  }
})

const postPage = (path: string): ContentPageResult<Record<string, unknown>> | null => {
  const post = postByPath(path)
  if (!post) return null

  const author = authors.get(post.author)
  return {
    _id: `cms:blog:${post.id}`,
    _path: post.path,
    _collection: 'blog',
    _locale: 'en',
    _source: 'cms-demo',
    _type: 'markdown',
    _extension: 'md',
    _canonicalKey: `blog:${post.id}`,
    ref: post.id,
    stem: post.id,
    title: post.title,
    author: post.author,
    authorName: author?.name,
    body: {
      type: 'root',
      children: []
    },
    ...routeMeta(post.path)
  }
}

const authorPage = (path: string): ContentPageResult<Record<string, unknown>> | null => {
  const id = path.replace(/^\/authors\//, '')
  const author = authors.get(id)
  if (!author) return null

  return {
    _id: `cms:authors:${author.id}`,
    _path: `/authors/${author.id}`,
    _collection: 'authors',
    _locale: 'en',
    _source: 'cms-demo',
    _type: 'markdown',
    _extension: 'md',
    _canonicalKey: `authors:${author.id}`,
    ref: author.id,
    stem: author.id,
    title: author.name,
    name: author.name,
    body: {
      type: 'root',
      children: []
    },
    ...routeMeta(`/authors/${author.id}`)
  }
}

const pageFor = (collection: string, routeOrPath = '/') => {
  if (collection === 'blog') return postPage(routeOrPath)
  if (collection === 'authors') return authorPage(routeOrPath)
  throw createContentProviderError('unknown_collection', `Unknown collection: ${collection}`, { collection })
}

const listFor = (collection?: string) => {
  if (!collection || collection === 'blog') {
    return Array.from(posts.values()).map(post => postPage(post.path)).filter(Boolean)
  }
  if (collection === 'authors') {
    return Array.from(authors.values()).map(author => authorPage(`/authors/${author.id}`)).filter(Boolean)
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
      limit: true,
      skip: true,
      count: true
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
      `entry:${collection}:${page.ref}`,
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
    const page = pageFor(collection, routeOrPath)
    return page ? routeMeta(page.path) : null
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
