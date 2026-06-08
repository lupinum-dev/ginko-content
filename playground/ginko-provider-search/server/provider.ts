import type { ContentProvider } from '@lupinum/ginko-content/server'

const documents = [
  {
    title: 'Provider English Guide',
    path: '/docs/provider-guide',
    locale: 'en',
    excerpt: 'Provider-owned search result from the CMS fixture.'
  },
  {
    title: 'Provider Deutscher Leitfaden',
    path: '/de/dokumentation/provider-leitfaden',
    locale: 'de',
    excerpt: 'Provider-owned localized search result from the CMS fixture.'
  }
]

const emptyList = {
  result: [],
  skip: 0,
  limit: 0,
  total: 0
}

export default {
  name: 'fixture-search',
  capabilities: {
    routeBackedCollections: true,
    dataCollections: false,
    localizedRoutes: true,
    translatedSlugs: false,
    navigation: false,
    surroundings: false,
    searchSections: false,
    sitemap: false,
    query: {
      operators: ['$eq'],
      limit: true,
      skip: true,
      count: true
    }
  },
  async query (_event, query) {
    if (query.count) {
      return { result: 0 }
    }
    if (query.first) {
      return { result: undefined }
    }
    return emptyList
  },
  async page () {
    return null
  },
  async routeMeta () {
    return null
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
        collection: 'docs',
        path: document.path,
        title: document.title,
        excerpt: document.excerpt,
        locale: document.locale,
        score: 1
      }))
  }
} satisfies ContentProvider
