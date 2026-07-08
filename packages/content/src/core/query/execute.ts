/**
 * Executes a `ContentQueryPlan` (see `./plan.ts`) against a content graph.
 *
 * Three execution modes, dispatched from `executeQueryPlan`:
 *
 *  1. `executeVariantPlan` — the plan requested a specific **route path**,
 *     so we resolve the variant directly from the graph's route index, then
 *     pass it through the same filter/projection/finalization path as every
 *     other query.
 *  2. `executeLocalePlan` — the plan has a `resolveLocale` term, so we
 *     filter + sort first, then dedupe by canonical key picking the
 *     best-ranked locale per document.
 *  3. `executeStandardPlan` — no locale semantics; filter + sort +
 *     project + slice.
 *
 * Operator dispatch (`compareOperators` below) maps each `CompareOperator`
 * to a `(item, value) => boolean` comparator. Operand narrowing happens
 * here via type aliases (`Comparable`, `Haystack`) rather than `as any`.
 */
import type { ContentQueryFindResponse, ContentQueryResponse } from '../../types/api'
import type { ParsedContent } from '../../types/content'
import type { ContentGraph } from '../content/graph'
import type { ContentQueryPlan, FilterExpr, CompareOperator } from './plan'
import { resolveGraphCanonicalKey, resolveGraphRouteVariant, resolveGraphVariant, resolveLocaleChain, selectGraphDocuments } from '../content/graph'
import { ensureArray, get, omit, sortList, withKeys, withoutKeys } from './operators'
import { normalizeRouteMounts, routeToContentPathCandidates } from '../content/path'

// Comparable operands accepted by `>`/`>=`/`<`/`<=`. JS permits cross-type
// coercion here (string vs. number) and has always done so for content
// filters; we keep that behavior but make the type contract explicit.
type Comparable = number | string | Date

// String/array haystack. `contains`/`containsAny` accept either, and both
// shapes expose a compatible `.includes()`.
type Haystack = string | readonly unknown[]

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const includesEntry = (haystack: Haystack, entry: unknown): boolean =>
  typeof haystack === 'string'
    ? haystack.includes(String(entry))
    : haystack.includes(entry)

const compareOperators: Record<CompareOperator, (item: unknown, value: unknown) => boolean> = {
  eq: (item, value) => value instanceof RegExp ? value.test(String(item)) : item === value,
  ne: (item, value) => value instanceof RegExp ? !value.test(String(item)) : item !== value,
  gt: (item, value) => (item as Comparable) > (value as Comparable),
  gte: (item, value) => (item as Comparable) >= (value as Comparable),
  lt: (item, value) => (item as Comparable) < (value as Comparable),
  lte: (item, value) => (item as Comparable) <= (value as Comparable),
  in: (item, value) => ensureArray(value).some(entry => Array.isArray(item)
    ? item.includes(entry)
    : compareOperators.eq(item, entry)),
  contains: (item, value) => {
    const haystack: Haystack = Array.isArray(item) ? item : String(item)
    return ensureArray(value).every(entry => includesEntry(haystack, entry))
  },
  containsAny: (item, value) => {
    const haystack: Haystack = Array.isArray(item) ? item : String(item)
    return ensureArray(value).some(entry => includesEntry(haystack, entry))
  },
  icontains: (item, value) => {
    if (typeof value !== 'string') {
      throw new TypeError('$icontains requires a string condition')
    }

    return String(item).toLocaleLowerCase().includes(value.toLocaleLowerCase())
  },
  exists: (item, value) => (value ? typeof item !== 'undefined' : typeof item === 'undefined'),
  type: (item, value) => typeof item === String(value),
  prefix: (item, value) => String(item || '').startsWith(String(value)),
  regex: (item, value) => {
    if (value instanceof RegExp) {
      return value.test(String(item || ''))
    }

    const matched = String(value).match(/\/(.*)\/([dgimsuy]*)$/)
    const regex = matched?.[1] ? new RegExp(matched[1], matched[2] || '') : new RegExp(String(value))
    return regex.test(String(item || ''))
  }
}

export const evaluateQueryPlanFilter = (item: Record<string, unknown>, filter: FilterExpr): boolean => {
  switch (filter.type) {
    case 'true':
      return true
    case 'compare':
      return compareOperators[filter.operator](get(item, filter.field), filter.value)
    case 'and':
      return filter.clauses.every(clause => evaluateQueryPlanFilter(item, clause))
    case 'or':
      return filter.clauses.some(clause => evaluateQueryPlanFilter(item, clause))
    case 'not':
      return !evaluateQueryPlanFilter(item, filter.clause)
  }
}

const collectFieldComparisons = (filter: FilterExpr, field: string): Array<string | RegExp> => {
  switch (filter.type) {
    case 'true':
      return []
    case 'compare':
      if (filter.field !== field) {
        return []
      }

      if (filter.operator === 'eq' && typeof filter.value === 'string') {
        return [filter.value]
      }

      if (filter.operator === 'regex' && filter.value instanceof RegExp) {
        return [filter.value]
      }

      if (filter.operator === 'regex' && typeof filter.value === 'string') {
        return [new RegExp(filter.value)]
      }

      if (filter.operator === 'prefix' && typeof filter.value === 'string') {
        return [new RegExp(`^${escapeRegExp(filter.value)}`)]
      }

      return []
    case 'and':
      return filter.clauses.flatMap(clause => collectFieldComparisons(clause, field))
    case 'or':
    case 'not':
      return []
  }
}

const applyQueryPlanSort = <T extends Record<string, unknown>>(matched: T[], plan: ContentQueryPlan) => {
  for (const clause of [...plan.sort].reverse()) {
    sortList(matched, {
      [clause.field]: clause.direction,
      ...(clause.locale ? { $locale: clause.locale } : {}),
      ...(typeof clause.numeric === 'boolean' ? { $numeric: clause.numeric } : {}),
      ...(clause.caseFirst ? { $caseFirst: clause.caseFirst } : {}),
      ...(clause.sensitivity ? { $sensitivity: clause.sensitivity } : {})
    })
  }
}

export const applyQueryPlanProjection = <T>(items: T[], plan: ContentQueryPlan) => {
  return items.map((item) => {
    const without = withoutKeys(plan.projection.without)(item as Record<string, unknown>)
    return withKeys(plan.projection.only)(without) as T
  })
}

export const finalizeQueryPlanResponse = <T>(matched: T[], plan: ContentQueryPlan): ContentQueryResponse<T> => {
  if (plan.mode === 'count') {
    return {
      result: matched.length
    }
  }

  const skipped = plan.skip ? matched.slice(plan.skip) : matched
  const limited = typeof plan.limit === 'number' ? skipped.slice(0, plan.limit) : skipped
  const projected = applyQueryPlanProjection(limited, plan)

  if (plan.mode === 'first') {
    return {
      ...omit(['skip', 'limit', 'total'])(({
        result: projected,
        skip: plan.skip,
        limit: plan.limit || 0,
        total: matched.length
      } as ContentQueryFindResponse<T>) as unknown as Record<string, unknown>),
      result: projected[0]
    }
  }

  return {
    result: projected,
    skip: plan.skip,
    limit: plan.limit || 0,
    total: matched.length
  }
}

const findDirConfig = (graph: ContentGraph, path?: string, locale?: string) => {
  if (!path) {
    return null
  }

  const byLocale = graph.byNavigationPath[path]
  if (!byLocale) {
    return null
  }

  if (locale && byLocale[locale]) {
    return byLocale[locale]
  }

  return Object.values(byLocale)[0] || null
}

const withDirConfig = <T extends ParsedContent>(content: T | undefined, dirConfig: ParsedContent | null) => {
  if (!content || !dirConfig) {
    return content
  }

  return {
    ...content,
    _dir: {
      ...dirConfig,
      ...dirConfig.body
    }
  } as T
}

export const executeQueryPlanOnDocuments = <T>(documents: T[], plan: ContentQueryPlan): ContentQueryResponse<T> => {
  const matched = documents
    .filter(item => (!plan.collection || (item as Partial<ParsedContent> | undefined)?.collection === plan.collection))
    .filter(item => evaluateQueryPlanFilter(item as Record<string, unknown>, plan.filter))
    .map(item => ({ ...item })) as T[]

  applyQueryPlanSort(matched as Array<Record<string, unknown>>, plan)

  return finalizeQueryPlanResponse(matched, plan)
}

const executeStandardPlan = <T>(graph: ContentGraph, plan: ContentQueryPlan): ContentQueryResponse<T> => {
  const candidates = selectGraphDocuments(graph, {
    collection: plan.collection,
    paths: collectFieldComparisons(plan.filter, 'path')
  }) as Array<Record<string, unknown>>

  const matched = candidates
    .filter(item => evaluateQueryPlanFilter(item, plan.filter))
    .map(item => ({ ...item })) as T[]

  applyQueryPlanSort(matched as Array<Record<string, unknown>>, plan)

  return finalizeQueryPlanResponse(matched, plan)
}

/**
 * Execute a locale-aware plan: keep only the best-ranked variant per
 * canonical key.
 *
 * Why this exists: when `resolveLocale` is set, we want one result per
 * logical document — not one per locale variant. Two pages that share a
 * canonical key but disagree on locale should collapse to the better
 * locale for the request.
 *
 * Approach:
 *   1. Gather candidates and filter by the plan's where clause.
 *   2. Rank each candidate by its position in the resolved locale chain.
 *   3. For each canonical key, keep the lowest rank (best match).
 *
 * GOTCHA: `exact: true` short-circuits rank dedup — we only keep
 * documents in the exact requested locale. No fallback, no substitution.
 */
const executeLocalePlan = <T>(graph: ContentGraph, plan: ContentQueryPlan, options: {
  defaultLocale?: string
  localeFallback?: Record<string, string[]>
}): ContentQueryResponse<T> => {
  const requestedLocale = plan.resolveLocale?.locale
  const candidates = selectGraphDocuments(graph, {
    collection: plan.collection,
    paths: collectFieldComparisons(plan.filter, 'path')
  }) as Array<Record<string, unknown> & ParsedContent>

  const localeChain = resolveLocaleChain(
    requestedLocale,
    options.defaultLocale,
    requestedLocale
      ? { [requestedLocale]: plan.resolveLocale?.fallback || options.localeFallback?.[requestedLocale] || [] }
      : {}
  )
  const localeRank = new Map(localeChain.map((locale, index) => [locale, index]))
  const merged: Array<{ rank: number, item: T }> = []
  const indexByCanonical = new Map<string, number>()

  for (const item of candidates.filter(item => evaluateQueryPlanFilter(item, plan.filter))) {
    if (plan.resolveLocale?.exact && item.locale !== requestedLocale) {
      continue
    }

    const key = item.canonicalKey || item.id || item.id || item.path
    const rank = localeRank.get(item.locale || '') ?? Number.MAX_SAFE_INTEGER
    const availableLocales = item.canonicalKey
      ? Object.keys(graph.byCanonical[item.canonicalKey] || {})
      : [item.locale].filter(Boolean) as string[]
    const enriched = {
      ...item,
      resolved: {
        ...(item.resolved || {}),
        requestedLocale,
        locale: item.locale,
        fallback: item.locale !== requestedLocale,
        availableLocales
      }
    } as T

    if (typeof key !== 'string') {
      continue
    }

    if (!indexByCanonical.has(key)) {
      indexByCanonical.set(key, merged.length)
      merged.push({ rank, item: enriched })
      continue
    }

    const index = indexByCanonical.get(key)!
    if (rank < merged[index]!.rank) {
      merged[index] = { rank, item: enriched }
    }
  }

  const matched = merged.map(entry => entry.item)
  applyQueryPlanSort(matched as Array<Record<string, unknown>>, plan)

  return finalizeQueryPlanResponse(matched, plan)
}

const executeVariantPlan = <T>(graph: ContentGraph, plan: ContentQueryPlan, options: {
  defaultLocale?: string
  localeFallback?: Record<string, string[]>
  collections?: Record<string, { route?: string | Record<string, string>, i18n?: boolean | { locales?: string[], defaultLocale?: string } }>
}): ContentQueryResponse<T> => {
  if (!plan.resolveVariant) {
    return { result: undefined }
  }

  // `ref` selectors short-circuit through the canonical-key index. We
  // translate ref → canonical key first, then defer to `resolveGraphVariant`
  // so locale fallback semantics are identical to a path-based lookup.
  // Both branches scope variant selection to the requested collection so a
  // shared canonical key (cross-collection reference, common with author
  // refspaces) doesn't return a wrong-collection variant.
  const collectionConfig = plan.collection ? options.collections?.[plan.collection] : undefined
  const collectionI18n = collectionConfig?.i18n && typeof collectionConfig.i18n === 'object' ? collectionConfig.i18n : undefined
  const defaultLocale = collectionI18n?.defaultLocale || options.defaultLocale
  const localeFallback = options.localeFallback
  const routeMounts = normalizeRouteMounts(collectionConfig?.route, collectionI18n?.locales || [], defaultLocale)

  const variant = plan.resolveVariant.ref
    ? (() => {
        const canonicalKey = resolveGraphCanonicalKey(graph, plan.resolveVariant!.ref!, plan.collection)
        if (!canonicalKey) return null
        return resolveGraphVariant(graph, canonicalKey, plan.resolveVariant!.locale, {
          defaultLocale,
          fallback: plan.resolveVariant!.fallback,
          exact: plan.resolveVariant!.exact,
          localeFallback,
          collection: plan.collection
        })
      })()
    : plan.resolveVariant.route
      ? (() => {
          const localeChain = plan.resolveVariant!.exact
            ? (plan.resolveVariant!.locale ? [plan.resolveVariant!.locale] : [])
            : (plan.resolveVariant!.fallback?.length
                ? Array.from(new Set([plan.resolveVariant!.locale, ...plan.resolveVariant!.fallback].filter(Boolean) as string[]))
                : resolveLocaleChain(plan.resolveVariant!.locale, defaultLocale, localeFallback || {}))
          const candidateLocales = localeChain.length
            ? localeChain
            : Array.from(new Set(Object.values(graph.byCanonical).flatMap(variants => Object.keys(variants))))
          if (!candidateLocales.length) {
            candidateLocales.push('')
          }
          const candidates = routeToContentPathCandidates(
            plan.resolveVariant!.route!,
            plan.resolveVariant!.locale,
            candidateLocales,
            defaultLocale,
            routeMounts
          )
          for (const candidate of candidates) {
            const canonicalKey = graph.byRoute[`${candidate.locale}:${candidate.path}`]
            if (!canonicalKey) {
              continue
            }
            const resolved = resolveGraphVariant(graph, canonicalKey, plan.resolveVariant!.locale, {
              defaultLocale,
              fallback: plan.resolveVariant!.fallback,
              exact: plan.resolveVariant!.exact,
              localeFallback,
              collection: plan.collection
            })
            if (resolved) return resolved
          }
          return null
        })()
      : resolveGraphRouteVariant(
          graph,
          plan.resolveVariant.path!,
          plan.resolveVariant.locale,
          {
            defaultLocale,
            fallback: plan.resolveVariant.fallback,
            exact: plan.resolveVariant.exact,
            localeFallback,
            collection: plan.collection
          }
        )

  if (!variant) {
    return { result: undefined }
  }

  // Belt-and-braces: even with collection-scoped resolution above, double-
  // check the resolved doc actually lives in the expected collection.
  const content = graph.byId[variant.contentId] as ParsedContent | undefined
  if (plan.collection && content?.collection !== plan.collection) {
    return { result: undefined }
  }
  const dirConfig = findDirConfig(graph, content?.path, variant.resolvedLocale)
  const variantPaths = Object.fromEntries(
    Object.entries(graph.byCanonical[variant.canonicalKey] || {}).map(([locale, entry]) => [locale, entry.path])
  )

  const enriched = {
    ...withDirConfig(content, dirConfig),
    resolved: {
      ...((content as ParsedContent | undefined)?.resolved || {}),
      ...(plan.resolveVariant.path ? { requestedPath: plan.resolveVariant.path } : {}),
      ...(plan.resolveVariant.route ? { requestedRoute: plan.resolveVariant.route } : {}),
      ...(plan.resolveVariant.ref ? { requestedRef: plan.resolveVariant.ref } : {}),
      requestedLocale: variant.requestedLocale,
      locale: variant.resolvedLocale,
      fallback: variant.fallback,
      availableLocales: variant.availableLocales,
      variantPaths
    }
  } as T

  const matched = evaluateQueryPlanFilter(enriched as Record<string, unknown>, plan.filter)
    ? [enriched]
    : []

  return finalizeQueryPlanResponse(matched, plan)
}

/**
 * Top-level dispatcher. Picks the right execution strategy based on the
 * plan's resolution terms, then returns a uniform `ContentQueryResponse<T>`.
 */
export const executeQueryPlan = <T>(graph: ContentGraph, plan: ContentQueryPlan, options: {
  defaultLocale?: string
  localeFallback?: Record<string, string[]>
  collections?: Record<string, { route?: string | Record<string, string>, i18n?: boolean | { locales?: string[], defaultLocale?: string } }>
} = {}): ContentQueryResponse<T> => {
  if (plan.resolveVariant) {
    return executeVariantPlan<T>(graph, plan, options)
  }

  if (plan.resolveLocale?.locale) {
    return executeLocalePlan<T>(graph, plan, options)
  }

  return executeStandardPlan<T>(graph, plan)
}

export const resolveQueryPlanVariant = (
  graph: ContentGraph,
  plan: ContentQueryPlan,
  options: {
    defaultLocale?: string
    localeFallback?: Record<string, string[]>
    collections?: Record<string, { route?: string | Record<string, string>, i18n?: boolean | { locales?: string[], defaultLocale?: string } }>
  } = {}
) => {
  if (plan.resolveVariant) {
    return resolveGraphRouteVariant(graph, plan.resolveVariant.path || plan.resolveVariant.route || '', plan.resolveVariant.locale, {
      defaultLocale: options.defaultLocale,
      fallback: plan.resolveVariant.fallback,
      exact: plan.resolveVariant.exact,
      localeFallback: options.localeFallback
    })
  }

  return null
}
