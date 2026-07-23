/**
 * The one canonical route projector, resolver, candidate-lowering function,
 * and alternate synthesizer.
 *
 * This module is the sole place that turns canonical document facts plus a
 * resolved locale policy into a public route path, and the sole place that
 * turns a public route path back into graph identity. Every consumer
 * (query result route meta, navigation, search, sitemap, static-output,
 * locale-switcher, agent code) must call these functions or consume the
 * records they produce - nothing else may prepend or rewrite routes.
 *
 * It is deliberately a pure, Nuxt-free module so it is unit-testable without
 * booting a Nuxt instance and reusable by provider integrations.
 */

import type { ResolvedCollectionLocalePolicy } from './locale-policy'
import {
  mountContentPath,
  normalizeContentPath,
  prefixPathWithLocale,
  routeRemainder,
  routeToContentPathCandidates,
  type RouteMounts
} from '../../core/content/path'

export class RouteProjectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RouteProjectionError'
  }
}

/**
 * One concrete graph variant fact: a document that exists, in one locale,
 * with its own content. Used as the input to alternate synthesis and as the seed for `ContentProviderRouteFact` below.
 */
export interface ContentProviderVariantFact {
  collection: string
  canonicalKey: string
  locale: string
  /** Canonical, locale-agnostic, mount-agnostic content path (e.g. `/guide/intro`). */
  contentPath: string
  draft?: boolean
}

/**
 * A structural route-eligible fact: a `ContentProviderVariantFact` plus the
 * flags the projector and downstream sitemap/prerender/navigation surfaces
 * need to decide whether and how a document participates in public routing.
 * Data documents, partials, and navigation files never become route facts.
 */
export interface ContentProviderRouteFact extends ContentProviderVariantFact {
  navigationFile?: boolean
  sitemap?: boolean
  sitemapMetadata?: import('../sitemap/metadata').ContentSitemapMetadata
}

/**
 * One produced, canonical public route for one document variant. This is
 * the sole shape internal consumers read paths from.
 */
export interface ProjectedContentRouteRecord {
  collection: string
  canonicalKey: string
  locale: string
  contentPath: string
  /** The projected, normalized public path (locale-prefixed, mounted). */
  path: string
  draft: boolean
  sitemap: boolean
  sitemapMetadata?: import('../sitemap/metadata').ContentSitemapMetadata
}

/** One ordered candidate produced by lowering a public route to content paths. */
export interface RouteCandidate {
  locale: string
  contentPath: string
}

export interface RouteAlternate {
  collection: string
  canonicalKey: string
  locale: string
  path: string
  source: 'variant' | 'fallback'
  /**
   * Present only on fallback alternates: the locale that actually owns the
   * source content being served at this locale's URL.
   */
  resolvedLocale?: string
}

export interface ResolvedRoute {
  collection: string
  canonicalKey: string
  locale: string
  contentPath: string
}

const mountsFor = (policy: ResolvedCollectionLocalePolicy, locale: string): RouteMounts => {
  const mounts = policy.routeMounts
  if (mounts[locale]) {
    return mounts as RouteMounts
  }
  if (Object.keys(mounts).length === 0) {
    // No mount is configured for this collection at all (e.g. a data
    // collection with no `route`) - there is nothing to synthesize a
    // fallback from, so leave the mount absent rather than inventing '/'.
    return mounts as RouteMounts
  }
  const fallbackMount = mounts.default ?? Object.values(mounts)[0]
  return { ...mounts, [locale]: fallbackMount ?? '/' } as RouteMounts
}

/**
 * Project one document variant's canonical content path into its public
 * route for the given locale, honoring per-locale route mounts and
 * default-locale prefix suppression. This is the ONE function that turns
 * graph facts into a public path.
 */
export function projectContentRoute(
  fact: Pick<ContentProviderVariantFact, 'contentPath' | 'locale'>,
  policy: ResolvedCollectionLocalePolicy
): string {
  const mounts = mountsFor(policy, fact.locale)
  const mounted = mountContentPath(fact.contentPath, fact.locale, mounts)
  return policy.localized
    ? prefixPathWithLocale(mounted, fact.locale, policy.defaultLocale)
    : mounted
}

/**
 * Lower a public route path into an ORDERED list of `{locale, contentPath}`
 * candidates using the resolved locale policy's mounts and fallback order.
 * Pure core function consumed by both the resolver below and provider query
 * dispatch.
 */
export function lowerRouteToCandidates(
  route: string,
  policy: ResolvedCollectionLocalePolicy,
  requestedLocale?: string
): RouteCandidate[] {
  if (!policy.localized) {
    // Mount-agnostic contentPath contract: strip the collection mount here
    // too, exactly like the localized branch below, so `contentPath` always
    // means the same thing regardless of whether the collection localizes.
    const mounts = policy.routeMounts as RouteMounts
    const mount = mounts.default ?? Object.values(mounts)[0]
    const contentPath = mount ? routeRemainder(route, mount) : normalizeContentPath(route)
    return [{ locale: requestedLocale ?? policy.defaultLocale ?? '', contentPath }]
  }

  const localeChain = requestedLocale
    ? [requestedLocale, ...(policy.fallback[requestedLocale] ?? [])]
    : [...policy.locales]

  const mounts = policy.routeMounts as RouteMounts
  const mounted = routeToContentPathCandidates(
    route,
    requestedLocale,
    localeChain,
    policy.defaultLocale,
    mounts
  )

  // `routeToContentPathCandidates` returns paths with the per-locale mount
  // still applied (its historical contract). This module's `contentPath` is
  // mount-agnostic, so strip each candidate's own
  // mount back off to keep the two notions of "content path" consistent.
  return mounted.map(({ locale, path }) => {
    const mount = mounts[locale]
    return { locale, contentPath: mount ? routeRemainder(path, mount) : path }
  })
}

/**
 * In-memory index built once from concrete route records so alternate
 * synthesis and route resolution are local, deterministic round trips
 * - never per-call HTTP or provider lookups.
 */
export interface RouteIndex {
  /** `"<locale> <path>"` -> the concrete record that owns that exact public path. */
  byPath: Map<string, ResolvedRoute>
  /**
   * `"<locale> <contentPath>"` -> the concrete record at that graph identity.
   * The resolver uses this after lowering a public URL into ordered locale
   * candidates, which makes fallback URLs round-trip through the same path as
   * ordinary requests instead of relying on a separate identity check.
   */
  byLocaleContentPath: Map<string, ResolvedRoute>
}

/**
 * Build the canonical route records for a collection from its concrete
 * route facts, and the in-memory index the resolver uses for round trips.
 * Fails loudly on duplicate projected paths within the same locale - two
 * canonical keys may never own the same concrete route.
 */
export function buildRouteRecords(
  facts: readonly ContentProviderRouteFact[],
  policy: ResolvedCollectionLocalePolicy
): { records: ProjectedContentRouteRecord[], index: RouteIndex } {
  const records: ProjectedContentRouteRecord[] = []
  const byPath = new Map<string, ResolvedRoute>()
  const byLocaleContentPath = new Map<string, ResolvedRoute>()

  const eligible = facts.filter(fact => !fact.navigationFile)

  for (const fact of eligible) {
    const path = projectContentRoute(fact, policy)
    const key = `${fact.locale} ${path}`
    const existing = byPath.get(key)
    if (existing && existing.canonicalKey !== fact.canonicalKey) {
      throw new RouteProjectionError(
        '@lupinum/ginko-content: route collision -- canonical keys '
        + `"${existing.canonicalKey}" and "${fact.canonicalKey}" both project to path `
        + `"${path}" in locale "${fact.locale}" for collection "${fact.collection}". `
        + 'Two documents may not own the same public route.'
      )
    }

    const resolved: ResolvedRoute = {
      collection: fact.collection,
      canonicalKey: fact.canonicalKey,
      locale: fact.locale,
      contentPath: fact.contentPath
    }
    byPath.set(key, resolved)
    byLocaleContentPath.set(`${fact.locale} ${normalizeContentPath(fact.contentPath)}`, resolved)

    records.push({
      collection: fact.collection,
      canonicalKey: fact.canonicalKey,
      locale: fact.locale,
      contentPath: fact.contentPath,
      path,
      draft: Boolean(fact.draft),
      sitemap: fact.sitemap !== false,
      ...(fact.sitemapMetadata ? { sitemapMetadata: fact.sitemapMetadata } : {})
    })
  }

  records.sort((a, b) =>
    a.collection.localeCompare(b.collection)
    || a.canonicalKey.localeCompare(b.canonicalKey)
    || a.locale.localeCompare(b.locale)
    || a.contentPath.localeCompare(b.contentPath)
  )

  return { records, index: { byPath, byLocaleContentPath } }
}

/**
 * Resolve a public route back to graph identity using the same policy-aware
 * lowering used by provider queries. Exact concrete routes take the fast
 * path. A synthesized fallback URL is then lowered into the requested locale
 * followed by its configured fallback chain until a concrete variant owns a
 * candidate. This preserves the route projection round trip.
 */
export function resolveContentRoute(
  path: string,
  locale: string,
  policy: ResolvedCollectionLocalePolicy,
  index: RouteIndex
): ResolvedRoute | undefined {
  const normalizedPath = normalizeContentPath(path)
  const exact = index.byPath.get(`${locale} ${normalizedPath}`)
  if (exact) {
    return exact
  }

  for (const candidate of lowerRouteToCandidates(normalizedPath, policy, locale)) {
    const resolved = index.byLocaleContentPath.get(
      `${candidate.locale} ${normalizeContentPath(candidate.contentPath)}`
    )
    if (resolved) {
      return resolved
    }
  }
}

/**
 * Synthesize alternates for one canonical document from its concrete graph
 * variants:
 *
 * 1. emit one `variant` alternate per concrete variant;
 * 2. for locales without a concrete variant, walk the fallback chain
 *    (skipped entirely when fallback is disabled for the operation);
 * 3. project the first available source variant into the requested locale
 *    and resolve that candidate's content-path identity through the
 *    canonical resolver;
 * 4. emit the fallback alternate only when the resolver round-trips to the
 *    ORIGINAL canonical key (guards against another document's content-path
 *    identity silently colliding with this fallback candidate);
 * 5. sort deterministically in canonical locale order.
 */
export function synthesizeAlternates(
  canonicalKey: string,
  variants: readonly ContentProviderVariantFact[],
  policy: ResolvedCollectionLocalePolicy,
  index: RouteIndex,
  options: { allowFallback?: boolean } = {}
): RouteAlternate[] {
  const allowFallback = options.allowFallback ?? true
  const own = variants.filter(variant => variant.canonicalKey === canonicalKey)
  if (!own.length) {
    return []
  }

  const collection = own[0]!.collection
  const byLocale = new Map(own.map(variant => [variant.locale, variant] as const))
  const alternates: RouteAlternate[] = []

  for (const variant of own) {
    alternates.push({
      collection,
      canonicalKey,
      locale: variant.locale,
      path: projectContentRoute(variant, policy),
      source: 'variant'
    })
  }

  if (allowFallback) {
    for (const locale of policy.locales) {
      if (byLocale.has(locale)) {
        continue
      }

      const chain = policy.fallback[locale] ?? []
      const sourceVariant = chain
        .map(target => byLocale.get(target))
        .find((candidate): candidate is ContentProviderVariantFact => Boolean(candidate))
      if (!sourceVariant) {
        // Missing source variant: this locale's whole fallback chain has no
        // concrete content to serve. Emit no candidate.
        continue
      }

      const candidatePath = projectContentRoute({ contentPath: sourceVariant.contentPath, locale }, policy)
      const resolved = resolveContentRoute(candidatePath, locale, policy, index)
      if (resolved?.canonicalKey !== canonicalKey) {
        // The projected candidate is absent, ambiguous, or resolves to a
        // different document through the requested locale's fallback chain.
        continue
      }

      alternates.push({
        collection,
        canonicalKey,
        locale,
        path: candidatePath,
        source: 'fallback',
        resolvedLocale: sourceVariant.locale
      })
    }
  }

  const localeOrder = new Map(policy.locales.map((locale, i) => [locale, i]))
  alternates.sort((a, b) => (localeOrder.get(a.locale) ?? 0) - (localeOrder.get(b.locale) ?? 0))

  return alternates
}

export { routeRemainder }
