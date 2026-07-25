/**
 * The content graph is the precomputed, read-only index every query reads
 * from. `buildContentGraph(documents)` turns a flat list of parsed content
 * into the cross-referenced lookup tables below.
 *
 * Key concepts:
 *
 *  - **Canonical key**: the locale-independent identity of a document. Two
 *    locale variants of the same page share the same canonical key; the
 *    key is what refs point at and what navigation deduplicates on.
 *  - **`byId`**: lookup by the fully-qualified, locale-suffixed content id.
 *    One entry per file-on-disk variant.
 *  - **`byCollectionCanonical`**: the exact locale-aware identity index.
 *    Canonical keys are only unique within a collection.
 *  - **`byCanonical`**: a derived convenience index containing only keys
 *    that occur in one collection. Ambiguous unscoped lookups fail closed.
 *  - **`byRoute`**: locale plus route path → canonical key. Used by the
 *    page resolver when the request arrives as a localized URL.
 *  - **`byRef`**: normalized ref string → canonical key. This is how
 *    markdown links such as `[Ada]($authors.ada)` find their target without a scan.
 *  - **`referenceTargets`**: the `buildReferenceTargets` map — every shape
 *    the user might plausibly write to point at a document (canonical
 *    name, locale-prefixed path, short slug) pre-resolved to a canonical
 *    key.
 *
 * The graph is rebuilt from scratch on every request in dev; in production
 * it is memoized per-request via `memoizeRuntimeValue(event, 'graph', ...)`.
 */

import type { ParsedContent } from '../../types/content'
import type { ContentLocaleEntry } from '../../types/query'
import { isNavigationFile } from './structural'
import type { ContentVariantIdentity, ResolvedVariant } from '../../types/runtime'
import { normalizeReferenceValue, buildReferenceTargets } from '../references/resolve'
import { resolveLocaleChain, sortLocalesCanonically } from './locale'

export interface ContentGraphVariant extends ContentVariantIdentity {
  document: ParsedContent
}

export interface ContentGraph {
  documents: ParsedContent[]
  /** id → document. Keys include the locale suffix; one entry per source file. */
  byId: Record<string, ParsedContent>
  /** collection name → ordered list of document ids. */
  byCollection: Record<string, string[]>
  /** localized route path → list of document ids sharing that path. */
  byPath: Record<string, string[]>
  /** collection → canonical key → `{ [locale]: variant }`. Exact identity index. */
  byCollectionCanonical: Record<string, Record<string, Record<string, ContentGraphVariant>>>
  /** Unambiguous canonical keys only. Derived from `byCollectionCanonical`. */
  byCanonical: Record<string, Record<string, ContentGraphVariant>>
  /** Exact collection → ref → canonical key alias index. */
  byCollectionRef: Record<string, Record<string, string>>
  /** `"<locale>:<route path>"` → canonical key. Used by page resolution. */
  byRoute: Record<string, string>
  /** normalized ref string → canonical key. */
  byRef: Record<string, string>
  /** navigation path → `{ [locale]: document }`. Drives `.navigation.yml` merging. */
  byNavigationPath: Record<string, Record<string, ParsedContent>>
  /** Every user-writable reference shape pre-resolved to a canonical key. */
  referenceTargets: Map<string, string>
  /** Exact collection-scoped user-writable reference targets. */
  referenceTargetsByCollection: Record<string, Map<string, string>>
}

const normalizePath = (path: string) => {
  if (!path || path === '/') {
    return '/'
  }

  return path.startsWith('/') ? (path.endsWith('/') ? path.slice(0, -1) || '/' : path) : `/${path.replace(/\/+$/, '')}`
}

/**
 * Build a `ContentGraph` from a flat list of parsed documents.
 *
 * The function is pure: given the same documents it returns equivalent
 * lookup tables. Callers memoize this per-request — see
 * the filesystem provider query path and
 * `memoizeRuntimeValue(event, 'graph', ...)`.
 *
 * INVARIANT: documents without `path` are still indexed by id (so refs can
 * find them) but are excluded from path/route/canonical lookups. Partials
 * and navigation documents are likewise indexed by id only.
 */
export const buildContentGraph = (
  documents: ParsedContent[],
  options: {
    locales?: string[]
    defaultLocale?: string
    referencePathAliases?: (document: ParsedContent) => readonly string[]
  } = {}
): ContentGraph => {
  const byId: Record<string, ParsedContent> = {}
  const byCollection: ContentGraph['byCollection'] = {}
  const byPath: ContentGraph['byPath'] = {}
  const byCollectionCanonical: ContentGraph['byCollectionCanonical'] = {}
  const byCanonical: ContentGraph['byCanonical'] = {}
  const byCollectionRef: ContentGraph['byCollectionRef'] = {}
  const byRef: ContentGraph['byRef'] = {}
  const byRoute: ContentGraph['byRoute'] = {}
  const byNavigationPath: Record<string, Record<string, ParsedContent>> = {}
  const defaultLocale = options.defaultLocale || ''

  for (const document of documents) {
    const documentId = document.id || `${document.collection || 'content'}:${document.path || 'document'}`
    byId[documentId] = document as ParsedContent

    if (!document.path) {
      continue
    }

    const path = normalizePath(document.path)
    byPath[path] ||= []
    // Default-locale document lists first under a path — the route resolver
    // reaches for the head of the list when no locale is requested, so this
    // ordering is load-bearing.
    if (document.locale === defaultLocale) {
      byPath[path]!.unshift(documentId)
    } else {
      byPath[path]!.push(documentId)
    }

    if (document.collection) {
      byCollection[document.collection] ||= []
      byCollection[document.collection]!.push(documentId)
    }

    if (isNavigationFile(document)) {
      const locale = document.locale || defaultLocale
      byNavigationPath[path] ||= {}
      byNavigationPath[path]![locale] = document
    }

    // Only real variant documents enter the canonical/ref indices.
    // Partials and navigation docs support other documents; they are not
    // themselves resolvable by ref or route.
    const isVariantDocument = !document.partial && !isNavigationFile(document) && document.canonicalKey
    if (!isVariantDocument) {
      continue
    }

    const locale = document.locale || defaultLocale
    const collection = document.collection || 'content'
    const variant: ContentGraphVariant = {
      canonicalKey: document.canonicalKey!,
      contentId: documentId,
      locale,
      path,
      document
    }

    byCollectionCanonical[collection] ||= {}
    byCollectionCanonical[collection]![document.canonicalKey!] ||= {}
    byCollectionCanonical[collection]![document.canonicalKey!]![locale] = variant
    byRoute[`${locale}:${path}`] = document.canonicalKey!
    if (document.type === 'markdown' && typeof document.ref === 'string' && document.ref.length) {
      byCollectionRef[collection] ||= {}
      byCollectionRef[collection]![document.ref] = document.canonicalKey!
    }
  }

  const collectionsByCanonical = new Map<string, string[]>()
  for (const [collection, canonicalEntries] of Object.entries(byCollectionCanonical)) {
    for (const canonicalKey of Object.keys(canonicalEntries)) {
      collectionsByCanonical.set(canonicalKey, [...(collectionsByCanonical.get(canonicalKey) || []), collection])
    }
  }

  for (const [canonicalKey, collections] of collectionsByCanonical) {
    if (collections.length !== 1) continue
    const collection = collections[0]!
    byCanonical[canonicalKey] = byCollectionCanonical[collection]![canonicalKey]!
  }

  const collectionsByRef = new Map<string, string[]>()
  for (const [collection, refs] of Object.entries(byCollectionRef)) {
    for (const ref of Object.keys(refs)) {
      collectionsByRef.set(ref, [...(collectionsByRef.get(ref) || []), collection])
    }
  }
  for (const [ref, collections] of collectionsByRef) {
    if (collections.length === 1) byRef[ref] = byCollectionRef[collections[0]!]![ref]!
  }

  const referenceTargetsByCollection = Object.fromEntries(
    Object.keys(byCollectionCanonical).map(collection => [
      collection,
      buildReferenceTargets(
        documents.filter(document => (document.collection || 'content') === collection && !document.partial && !isNavigationFile(document)),
        options.locales || [],
        options.referencePathAliases
      )
    ])
  )
  const referenceTargetCollections = new Map<string, string[]>()
  for (const [collection, targets] of Object.entries(referenceTargetsByCollection)) {
    for (const identity of targets.keys()) {
      referenceTargetCollections.set(identity, [...(referenceTargetCollections.get(identity) || []), collection])
    }
  }
  const referenceTargets = new Map<string, string>()
  for (const [identity, collections] of referenceTargetCollections) {
    if (collections.length === 1) referenceTargets.set(identity, referenceTargetsByCollection[collections[0]!]!.get(identity)!)
  }

  return {
    documents,
    byId,
    byCollection,
    byPath,
    byCollectionCanonical,
    byCanonical,
    byCollectionRef,
    byRoute,
    byRef,
    byNavigationPath,
    referenceTargets,
    referenceTargetsByCollection
  }
}

/** Resolve the exact collection-scoped variant set, or an unambiguous one. */
export const getGraphCanonicalVariants = (
  graph: ContentGraph,
  canonicalKey: string,
  collection?: string
): Record<string, ContentGraphVariant> | undefined => {
  return collection
    ? graph.byCollectionCanonical[collection]?.[canonicalKey]
    : graph.byCanonical[canonicalKey]
}

const getGraphVariantLocales = (graph: ContentGraph, collection?: string) => {
  const canonicalEntries = collection
    ? Object.values(graph.byCollectionCanonical[collection] || {})
    : Object.values(graph.byCollectionCanonical).flatMap(entries => Object.values(entries))
  return canonicalEntries.flatMap(variants => Object.keys(variants))
}

/**
 * Resolve a canonical key to a concrete locale variant.
 *
 * `exact: true` disables fallback — the caller only wants the requested
 * locale, period. Without `exact`, the locale chain (requested → explicit
 * `fallback` → configured `localeFallback` → `defaultLocale`) is walked
 * until a variant is found.
 *
 * Returns `null` if the canonical key does not exist *or* if `exact` is
 * set and the requested locale has no variant.
 */
export const resolveGraphVariant = (
  graph: ContentGraph,
  canonicalKey: string,
  requestedLocale?: string,
  options: {
    defaultLocale?: string
    locales?: string[]
    fallback?: string[]
    exact?: boolean
    localeFallback?: Record<string, string[]>
    /**
     * Restrict the locale variants considered to ones that live in this
     * collection. Without this, a canonical key shared by two collections
     * (e.g. `authors` and `docs` cross-referencing the same id) can resolve
     * to a wrong-collection variant whose post-hoc filter then drops the
     * result entirely — even though the requested collection has a perfectly
     * good variant in another locale.
     */
    collection?: string
  } = {}
): ResolvedVariant | null => {
  const variants = getGraphCanonicalVariants(graph, canonicalKey, options.collection)
  if (!variants) {
    return null
  }

  const availableLocales = sortLocalesCanonically(Object.keys(variants), options)
  const hasExplicitFallback = options.fallback !== undefined
  const localeChain = options.exact
    ? (requestedLocale ? [requestedLocale] : [])
    : (hasExplicitFallback
        ? Array.from(new Set([requestedLocale, ...(options.fallback || [])].filter(Boolean) as string[]))
        : resolveLocaleChain(requestedLocale, options.defaultLocale, options.localeFallback || {}))

  const resolvedLocale = localeChain.find(locale => variants[locale]) || (options.exact || hasExplicitFallback ? undefined : availableLocales[0])
  if (resolvedLocale === undefined) {
    return null
  }

  const variant = variants[resolvedLocale]
  return {
    canonicalKey,
    contentId: variant.contentId,
    locale: variant.locale,
    path: variant.path,
    requestedLocale,
    resolvedLocale,
    fallback: Boolean(requestedLocale && resolvedLocale !== requestedLocale),
    availableLocales
  }
}

/**
 * Resolve a **route path** (the URL the user visited) to a locale variant.
 *
 * Walks the locale chain and consults `byRoute` (keyed `${locale}:${path}`)
 * for each candidate. Falls back to scanning every locale in the graph if
 * the chain is empty — this is what powers language-agnostic dev links
 * where the locale has to be inferred from the content.
 */
export const resolveGraphRouteVariant = (
  graph: ContentGraph,
  routePath: string,
  requestedLocale?: string,
  options: {
    defaultLocale?: string
    locales?: string[]
    fallback?: string[]
    exact?: boolean
    localeFallback?: Record<string, string[]>
    collection?: string
  } = {}
): ResolvedVariant | null => {
  const normalizedPath = normalizePath(routePath)
  const localeChain = options.exact
    ? (requestedLocale ? [requestedLocale] : [])
    : (options.fallback !== undefined
        ? Array.from(new Set([requestedLocale, ...(options.fallback || [])].filter(Boolean) as string[]))
        : resolveLocaleChain(requestedLocale, options.defaultLocale, options.localeFallback || {}))
  const localesToSearch = localeChain.length
    ? localeChain
    : sortLocalesCanonically(getGraphVariantLocales(graph, options.collection), options)

  for (const locale of localesToSearch) {
    const canonicalKey = graph.byRoute[`${locale}:${normalizedPath}`]
    if (!canonicalKey) {
      continue
    }

    const variant = resolveGraphVariant(graph, canonicalKey, requestedLocale, options)
    if (variant) return variant
    // The byRoute hit was in a different collection — keep walking the
    // locale chain so a same-collection variant in another locale can still
    // be returned via fallback.
  }

  return null
}

/**
 * Turn a user-written identity string (`'guide/intro'`, `'intro'`,
 * `'de/leitfaden/einstieg'`) into its canonical key, optionally scoped to
 * a collection.
 *
 * Consults — in order — `byCanonical` (already canonical), `byRef`
 * (explicit `ref:` field in front-matter), then the full
 * `referenceTargets` index (built from every plausible shape). Returns
 * `null` if nothing matches.
 *
 * GOTCHA: when `collection` is provided but the collection is empty, we
 * short-circuit to `null` rather than letting a stale canonical match
 * leak through.
 */
export const resolveGraphCanonicalKey = (
  graph: ContentGraph,
  identity: string,
  collection?: string
) => {
  const normalizedIdentity = normalizeReferenceValue(identity)
  if (!normalizedIdentity) {
    return null
  }

  const hasCollectionVariant = (canonicalKey: string) => {
    return Boolean(getGraphCanonicalVariants(graph, canonicalKey, collection))
  }

  if (hasCollectionVariant(normalizedIdentity)) {
    return normalizedIdentity
  }

  const refCanonicalKey = collection
    ? graph.byCollectionRef[collection]?.[normalizedIdentity]
    : graph.byRef[normalizedIdentity]
  if (refCanonicalKey && hasCollectionVariant(refCanonicalKey)) {
    return refCanonicalKey
  }

  if (collection && !(graph.byCollection[collection] || []).length) {
    return null
  }

  const targetCanonicalKey = collection
    ? graph.referenceTargetsByCollection[collection]?.get(normalizedIdentity)
    : graph.referenceTargets.get(normalizedIdentity)
  return targetCanonicalKey && hasCollectionVariant(targetCanonicalKey) ? targetCanonicalKey : null
}

export const resolveGraphCollectionLocales = (
  graph: ContentGraph,
  identity: string,
  collection?: string
): ContentLocaleEntry[] => {
  const canonicalKey = resolveGraphCanonicalKey(graph, identity, collection)
  if (!canonicalKey) {
    return []
  }

  return Object.values(getGraphCanonicalVariants(graph, canonicalKey, collection) || {})
    .sort((a, b) => a.locale.localeCompare(b.locale))
    .map(variant => ({
      canonicalKey,
      locale: variant.locale,
      ...(variant.path ? { path: variant.path } : {})
    }))
}

export const selectGraphDocuments = (
  graph: ContentGraph,
  options: {
    collection?: string
    paths?: Array<string | RegExp>
  } = {}
) => {
  const { collection, paths = [] } = options
  const hasIndexedFilter = Boolean(collection || paths.length)
  let ids = collection ? [...(graph.byCollection[collection] || [])] : [] as string[]

  if (paths.length) {
    const pathIds = Array.from(new Set(paths.flatMap((path) => {
      return Object.keys(graph.byPath)
        .filter(key => path instanceof RegExp ? path.test(key) : key === path)
        .flatMap(key => graph.byPath[key] || [])
    })))
    ids = ids.length ? pathIds.filter(id => ids.includes(id)) : pathIds
  }

  if (!ids.length) {
    if (hasIndexedFilter) {
      return []
    }

    return graph.documents
  }

  return ids.map(id => graph.byId[id]).filter(Boolean)
}
