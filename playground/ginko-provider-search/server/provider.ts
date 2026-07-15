import {
  normalizeProviderDocument,
  type ContentProvider
} from '@lupinum/ginko-content/provider'

const documents = [
  {
    id: 'provider-native-doc-en-001',
    canonicalKey: 'docs:provider-guide',
    collection: 'docs',
    title: 'Provider English Guide',
    contentPath: '/docs/provider-guide',
    locale: 'en',
    excerpt: 'Provider-owned search result from the CMS fixture.',
    body: null
  },
  {
    id: 'provider-native-doc-de-001',
    canonicalKey: 'docs:provider-guide',
    collection: 'docs',
    title: 'Provider Deutscher Leitfaden',
    contentPath: '/de/dokumentation/provider-leitfaden',
    locale: 'de',
    excerpt: 'Provider-owned localized search result from the CMS fixture.',
    body: null
  }
]

const emptyList = {
  result: [],
  skip: 0,
  limit: 0,
  total: 0
}

const routeVariants = documents.map(({ locale, contentPath }) => ({ locale, contentPath }))
const providerDocument = (document: (typeof documents)[number]) => normalizeProviderDocument({
  ...document,
  routeVariants
})

export default {
  name: 'fixture-search',
  capabilities: {
    query: {
      operators: ['$eq'],
      pagination: ['offset']
    }
  },
  async query (_event, query) {
    if (query.plan.mode === 'count') {
      return { result: 0 }
    }
    if (query.plan.mode === 'first') {
      const selector = query.plan.variantSelector
      const candidates = selector?.by === 'route' ? selector.candidates : []
      const document = candidates
        .map(candidate => documents.find(item =>
          item.contentPath === candidate.contentPath
        ))
        .find(Boolean)
      return { result: document ? providerDocument(document) : undefined }
    }
    const result = documents.map(providerDocument)
    return {
      ...emptyList,
      result,
      limit: query.plan.limit || result.length,
      total: result.length
    }
  },
  async routes () {
    return documents.map(document => ({
      collection: document.collection,
      canonicalKey: document.canonicalKey,
      locale: document.locale,
      contentPath: document.contentPath,
      sitemap: { lastmod: '2026-06-08T00:00:00.000Z' }
    }))
  },
  async search (_event, request) {
    const term = request.term.trim().toLowerCase()
    if (!term) {
      return []
    }

    return documents
      .filter(document => !request.locale || document.locale === request.locale)
      .filter(document => `${document.title} ${document.excerpt}`.toLowerCase().includes(term))
      .map(document => ({
        title: document.title,
        excerpt: document.excerpt,
        score: 1,
        route: {
          collection: document.collection,
          canonicalKey: document.canonicalKey,
          locale: document.locale,
          contentPath: document.contentPath
        }
      }))
  }
} satisfies ContentProvider
