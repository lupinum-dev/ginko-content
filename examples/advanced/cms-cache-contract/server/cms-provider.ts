import {
  createContentProviderError,
  withContentCache,
  type ContentProvider,
  type ContentProviderQuery,
  type ContentProviderRouteFact,
  type ProviderDocumentInput
} from '@lupinum/ginko-content/provider'
import { authors, postByPath, posts, providerCacheEvents } from './cms-store'

/**
 * This example deliberately returns raw provider facts. Ginko Content owns
 * route projection and the app-facing document envelope; a CMS adapter only
 * needs to preserve stable identity plus the source's content path.
 */
const routeFact = (document: ProviderDocumentInput): ContentProviderRouteFact => ({
  collection: document.collection,
  canonicalKey: document.canonicalKey,
  locale: document.locale,
  contentPath: document.contentPath
})

const postDocument = (contentPath: string): ProviderDocumentInput | null => {
  const post = postByPath(contentPath)
  if (!post) return null

  const author = authors.get(post.author)
  return {
    id: `cms:blog:${post.id}`,
    collection: 'blog',
    locale: 'en',
    contentPath: post.path,
    canonicalKey: `blog:${post.id}`,
    type: 'markdown',
    body: { type: 'root', children: [] },
    ref: post.id,
    title: post.title,
    author: post.author,
    authorName: author?.name
  }
}

const authorDocument = (contentPath: string): ProviderDocumentInput | null => {
  const id = contentPath.replace(/^\/authors\//, '')
  const author = authors.get(id)
  if (!author) return null

  return {
    id: `cms:authors:${author.id}`,
    collection: 'authors',
    locale: 'en',
    contentPath: `/authors/${author.id}`,
    canonicalKey: `authors:${author.id}`,
    type: 'markdown',
    body: { type: 'root', children: [] },
    ref: author.id,
    title: author.name,
    name: author.name
  }
}

const documentsFor = (collection: string | null): ProviderDocumentInput[] => {
  if (collection === null || collection === 'blog') {
    return Array.from(posts.values()).flatMap(post => {
      const document = postDocument(post.path)
      return document ? [document] : []
    })
  }
  if (collection === 'authors') {
    return Array.from(authors.values()).flatMap(author => {
      const document = authorDocument(`/authors/${author.id}`)
      return document ? [document] : []
    })
  }
  throw createContentProviderError('unknown_collection', `Unknown collection: ${collection}`, { collection })
}

/** Resolve the closed route selector supplied by core; providers never guess mounts. */
const selectDocuments = (query: ContentProviderQuery): ProviderDocumentInput[] => {
  const documents = documentsFor(query.collection)
  const selector = query.plan.variantSelector
  if (!selector) return documents

  if (selector.by === 'route') {
    const candidates = new Set(selector.candidates.map(candidate => `${candidate.locale}:${candidate.contentPath}`))
    return documents.filter(document => candidates.has(`${document.locale}:${document.contentPath}`))
  }
  return documents.filter(document => document.canonicalKey === selector.ref || document.ref === selector.ref)
}

export default {
  name: 'cms-demo',
  capabilities: {
    query: {
      operators: ['$eq'],
      pagination: ['offset']
    }
  },
  async query(_event, query) {
    const documents = selectDocuments(query)
    const result = query.plan.mode === 'count'
      ? { result: documents.length }
      : query.plan.mode === 'first'
        ? { result: documents[0] }
        : {
            mode: 'offset' as const,
            result: documents.slice(query.plan.skip, query.plan.limit === undefined ? undefined : query.plan.skip + query.plan.limit),
            skip: query.plan.skip,
            limit: query.plan.limit ?? documents.length,
            total: documents.length
          }

    return withContentCache(result, {
      tags: query.collection ? [`collection:${query.collection}`] : ['collection:blog', 'collection:authors'],
      maxAge: 300,
      swr: 60
    })
  },
  async navigation(_event, query) {
    return withContentCache(selectDocuments(query).map(document => ({
      title: String(document.title),
      route: routeFact(document)
    })), {
      tags: [`nav:${query.collection ?? 'all'}:en`],
      maxAge: 300
    })
  },
  async search(_event, request) {
    const term = request.term.toLocaleLowerCase()
    return Array.from(posts.values())
      .filter(post => `${post.title} ${authors.get(post.author)?.name || ''}`.toLocaleLowerCase().includes(term))
      .map(post => {
        const document = postDocument(post.path)!
        return { title: post.title, score: 1, route: routeFact(document) }
      })
  },
  async routes() {
    return Array.from(posts.values()).map(post => routeFact(postDocument(post.path)!))
  },
  async invalidate(_event, input) {
    providerCacheEvents.push({ source: 'provider', ...input })
  }
} satisfies ContentProvider
