import {
  normalizeProviderDocument,
  type ContentProvider,
  type ContentProviderQuery
} from '@lupinum/ginko-content/provider'

const documents = [
  {
    id: 'provider-native-doc-en-001',
    canonicalKey: 'docs:provider-guide',
    collection: 'docs',
    title: 'Provider English Guide',
    contentPath: '/docs/provider-guide',
    locale: 'en',
    ref: 'docs.provider-guide',
    excerpt: 'Provider-owned search result from the CMS fixture.',
    body: null
  },
  {
    id: 'provider-native-doc-de-001',
    canonicalKey: 'docs:provider-guide',
    collection: 'docs',
    title: 'Provider Deutscher Leitfaden',
    contentPath: '/dokumentation/provider-leitfaden',
    locale: 'de',
    ref: 'docs.provider-guide',
    excerpt: 'Provider-owned localized search result from the CMS fixture.',
    body: null
  }
]

const routeVariants = documents.map(({ locale, contentPath }) => ({ locale, contentPath }))
const providerDocument = (document: (typeof documents)[number]) => normalizeProviderDocument({
  ...document,
  routeVariants
})
const providerDocuments = documents.map(providerDocument)

type QueryPlan = ContentProviderQuery['plan']
type QueryFilter = QueryPlan['filter']

const fieldValue = (document: Record<string, unknown>, field: string): unknown =>
  field.split('.').reduce<unknown>((value, segment) =>
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)[segment]
      : undefined, document)

const matchesFilter = (document: Record<string, unknown>, filter: QueryFilter): boolean => {
  switch (filter.type) {
    case 'true':
      return true
    case 'compare':
      if (filter.operator !== 'eq') {
        throw new TypeError(`Unsupported fixture-search operator: ${filter.operator}`)
      }
      return fieldValue(document, filter.field) === filter.value
    case 'and':
      return filter.clauses.every(clause => matchesFilter(document, clause))
    case 'or':
      return filter.clauses.some(clause => matchesFilter(document, clause))
    case 'not':
      return !matchesFilter(document, filter.clause)
  }
}

const compareValues = (left: unknown, right: unknown, clause: QueryPlan['sort'][number]): number => {
  if (left === right) return 0
  if (left === undefined || left === null) return -1
  if (right === undefined || right === null) return 1
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return new Intl.Collator(clause.locale, {
    ...(clause.numeric !== undefined ? { numeric: clause.numeric } : {}),
    ...(clause.caseFirst !== undefined ? { caseFirst: clause.caseFirst } : {}),
    ...(clause.sensitivity !== undefined ? { sensitivity: clause.sensitivity } : {})
  }).compare(String(left), String(right))
}

const selectQueryDocuments = (plan: QueryPlan) => {
  let selected = providerDocuments
    .filter(document => !plan.collection || document.collection === plan.collection)
    .filter(document => matchesFilter(document, plan.filter))

  const selector = plan.variantSelector
  if (selector?.by === 'route') {
    selected = selector.candidates.flatMap(candidate => {
      const match = selected.find(document =>
        document.locale === candidate.locale
        && document.contentPath === candidate.contentPath)
      return match ? [match] : []
    })
  }
  else if (selector?.by === 'ref') {
    selected = selector.localeChain.flatMap(locale => {
      const match = selected.find(document => document.ref === selector.ref && document.locale === locale)
      return match ? [match] : []
    })
  }
  else if (plan.resolveLocale?.locale) {
    const localeChain = [plan.resolveLocale.locale, ...(plan.resolveLocale.fallback || [])]
    const byCanonicalKey = new Map<string, (typeof selected)[number]>()
    for (const locale of localeChain) {
      for (const document of selected) {
        if (document.locale === locale && !byCanonicalKey.has(document.canonicalKey)) {
          byCanonicalKey.set(document.canonicalKey, document)
        }
      }
    }
    selected = [...byCanonicalKey.values()]
  }

  return [...selected].sort((left, right) => {
    for (const clause of plan.sort) {
      const compared = compareValues(
        fieldValue(left, clause.field),
        fieldValue(right, clause.field),
        clause
      )
      if (compared !== 0) return compared * clause.direction
    }
    return 0
  })
}

export default {
  name: 'fixture-search',
  capabilities: {
    query: {
      operators: ['$eq'],
      pagination: ['offset']
    }
  },
  async query (_event, query) {
    const selected = selectQueryDocuments(query.plan)
    if (query.plan.mode === 'count') {
      return { result: selected.length }
    }
    if (query.plan.mode === 'first') {
      return { result: selected[0] }
    }

    if (query.plan.paging?.mode === 'cursor') {
      throw new TypeError('fixture-search does not advertise cursor pagination')
    }
    const skip = query.plan.paging?.mode === 'offset'
      ? query.plan.paging.skip
      : query.plan.skip
    const limit = query.plan.paging?.mode === 'offset'
      ? query.plan.paging.limit
      : (query.plan.limit ?? 100)
    return {
      ...(query.plan.paging?.mode === 'offset' ? { mode: 'offset' as const } : {}),
      result: selected.slice(skip, skip + limit),
      skip,
      limit,
      total: selected.length
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
