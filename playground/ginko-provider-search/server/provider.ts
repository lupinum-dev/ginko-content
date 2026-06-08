import type { ContentProvider } from '@lupinum/ginko-content/server'

const documents = [
  {
    id: 'provider-native-doc-en-001',
    title: 'Provider English Guide',
    path: '/docs/provider-guide',
    locale: 'en',
    excerpt: 'Provider-owned search result from the CMS fixture.'
  },
  {
    id: 'provider-native-doc-de-001',
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
    sitemap: true,
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
  async sitemapEntries () {
    return documents.map(document => ({
      loc: document.path,
      alternatives: [
        { hreflang: 'en', href: '/docs/provider-guide' },
        { hreflang: 'de', href: '/de/dokumentation/provider-leitfaden' }
      ],
      lastmod: '2026-06-08'
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
        collection: 'docs',
        path: document.path,
        title: document.title,
        excerpt: document.excerpt,
        locale: document.locale,
        score: 1
      }))
  }
} satisfies ContentProvider
