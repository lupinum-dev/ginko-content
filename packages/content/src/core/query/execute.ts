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
import type { ContentQueryResponse } from '../../types/api'
import type { ParsedContent } from '../../types/content'
import type { ContentGraph } from '../content/graph'
import type { ContentQueryPlan, FilterExpr, CompareOperator } from './plan'
import { isPlanRegex } from './plan'
import { resolveLocaleChain, sortLocalesCanonically } from '../content/locale'
import { getGraphCanonicalVariants, resolveGraphCanonicalKey, resolveGraphRouteVariant, resolveGraphVariant, selectGraphDocuments } from '../content/graph'
import { ensureArray, get, sortList, withKeys, withoutKeys } from './operators'
import { normalizeRouteMounts, routeToContentPathCandidates } from '../content/path'
import { createContentProviderError } from '../provider-errors'

interface ExecuteQueryPlanOptions {
  defaultLocale?: string
  localeFallback?: Record<string, string[]>
  collections?: Record<string, { route?: string | Record<string, string>, i18n?: boolean | { locales?: string[], defaultLocale?: string } }>
  /** Whether locale metadata may expose draft variants. Omit for trusted internal callers. */
  includeDrafts?: boolean
}

// Comparable operands accepted by `>`/`>=`/`<`/`<=`. JS permits cross-type
// coercion here (string vs. number) and has always done so for content
// filters; we keep that behavior but make the type contract explicit.
type Comparable = number | string

// String/array haystack. `contains`/`containsAny` accept either, and both
// shapes expose a compatible `.includes()`.
type Haystack = string | readonly unknown[]

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Reconstruct a live `RegExp` from the JSON-pure tagged wire operand produced
// by lowering (see `PlanRegex`). Non-regex operands pass
// through so equality/comparison semantics are unchanged.
const reviveRegex = (value: unknown): unknown =>
  isPlanRegex(value) ? new RegExp(value.source, value.flags) : value

const includesEntry = (haystack: Haystack, entry: unknown): boolean =>
  typeof haystack === 'string'
    ? isPlanRegex(entry) ? (reviveRegex(entry) as RegExp).test(haystack) : haystack.includes(String(entry))
    : haystack.some(value => compareOperators.eq(value, entry))

const compareOperators: Record<CompareOperator, (item: unknown, value: unknown) => boolean> = {
  eq: (item, value) => {
    const operand = reviveRegex(value)
    return operand instanceof RegExp ? operand.test(String(item)) : item === operand
  },
  ne: (item, value) => {
    const operand = reviveRegex(value)
    return operand instanceof RegExp ? !operand.test(String(item)) : item !== operand
  },
  gt: (item, value) => (item as Comparable) > (value as Comparable),
  gte: (item, value) => (item as Comparable) >= (value as Comparable),
  lt: (item, value) => (item as Comparable) < (value as Comparable),
  lte: (item, value) => (item as Comparable) <= (value as Comparable),
  in: (item, value) => ensureArray(value).some(entry => Array.isArray(item)
    ? item.some(itemEntry => compareOperators.eq(itemEntry, entry))
    : compareOperators.eq(item, entry)),
  nin: (item, value) => !compareOperators.in(item, value),
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
    const operand = reviveRegex(value)
    if (operand instanceof RegExp) {
      return operand.test(String(item || ''))
    }

    // An object operand that survived `reviveRegex` untagged is NOT a
    // `PlanRegex` (`isPlanRegex` rejected it). Stringifying it would yield
    // `'[object Object]'`, which `new RegExp` reads as the char-class
    // `[objectObject ]` that matches almost any string — an old-wire untagged
    // `{ source, flags }` regex would silently return wrong matches. Reject it
    // instead of guessing.
    if (typeof operand === 'object' && operand !== null) {
      throw new TypeError(
        '$regex operand must be a plain string or a tagged { __ginkoContentQueryValue: \'RegExp\', source, flags } wire value produced by the current PROVIDER_QUERY_VERSION lowering; received an untagged object (likely an old-wire { source, flags } regex predating PROVIDER_QUERY_VERSION)'
      )
    }

    const matched = String(operand).match(/\/(.*)\/([dgimsuy]*)$/)
    const regex = matched?.[1] ? new RegExp(matched[1], matched[2] || '') : new RegExp(String(operand))
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
    default:
      throw new TypeError(`Unknown query filter node: ${(filter as { type?: unknown }).type}`)
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

      if (filter.operator === 'regex' && isPlanRegex(filter.value)) {
        return [new RegExp(filter.value.source, filter.value.flags)]
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
    default:
      throw new TypeError(`Unknown query filter node: ${(filter as { type?: unknown }).type}`)
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

/**
 * Opaque forward-cursor encoding for the filesystem provider's `cursor`
 * pagination mode. The filesystem provider always has
 * the full matched set in memory, so its cursor is internally just an
 * offset — but that encoding is a filesystem implementation detail, never a
 * public contract; applications and other providers must not parse it.
 */
const FILESYSTEM_CURSOR_PREFIX = 'o:'

const encodeFilesystemCursor = (offset: number): string => {
  const raw = `${FILESYSTEM_CURSOR_PREFIX}${offset}`
  return typeof Buffer !== 'undefined' ? Buffer.from(raw).toString('base64') : btoa(raw)
}

const invalidFilesystemCursor = (): never => {
  throw createContentProviderError(
    'unsupported_query_shape',
    'The filesystem provider received an invalid cursor.',
    { provider: 'filesystem', field: 'paging.after' }
  )
}

const decodeFilesystemCursor = (cursor: string | null | undefined): number => {
  if (cursor === null || cursor === undefined) {
    return 0
  }

  try {
    const bytes = typeof Buffer !== 'undefined'
      ? Buffer.from(cursor, 'base64')
      : Uint8Array.from(atob(cursor), character => character.charCodeAt(0))
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const offsetText = raw.startsWith(FILESYSTEM_CURSOR_PREFIX)
      ? raw.slice(FILESYSTEM_CURSOR_PREFIX.length)
      : ''

    // The textual offset is canonical decimal: no sign, exponent, fraction,
    // leading zeroes, or values outside JavaScript's exact integer range.
    if (!/^(?:0|[1-9]\d*)$/u.test(offsetText)) {
      return invalidFilesystemCursor()
    }

    const offset = Number(offsetText)
    if (!Number.isSafeInteger(offset) || offset < 0) {
      return invalidFilesystemCursor()
    }

    // Buffer/atob accept several noncanonical base64 spellings. Requiring the
    // exact filesystem encoding also proves the prefix and integer spelling
    // round-trip without normalization.
    if (encodeFilesystemCursor(offset) !== cursor) {
      return invalidFilesystemCursor()
    }

    return offset
  } catch {
    return invalidFilesystemCursor()
  }
}

export const finalizeQueryPlanResponse = <T>(matched: T[], plan: ContentQueryPlan): ContentQueryResponse<T> => {
  if (plan.mode === 'count') {
    return {
      result: matched.length
    }
  }

  if (plan.mode === 'all' && plan.pagination.mode === 'cursor') {
    const { limit } = plan.pagination
    const skip = decodeFilesystemCursor(plan.pagination.after)
    const page = matched.slice(skip, skip + limit)
    const projected = applyQueryPlanProjection(page, plan)
    const hasNext = skip + limit < matched.length
    return {
      mode: 'cursor',
      result: projected,
      limit,
      pageInfo: {
        endCursor: hasNext ? encodeFilesystemCursor(skip + limit) : null,
        hasNext
      }
    }
  }

  const effectiveSkip = plan.pagination.mode === 'cursor' ? 0 : plan.pagination.skip
  const effectiveLimit = plan.pagination.limit
  const skipped = effectiveSkip ? matched.slice(effectiveSkip) : matched
  const limited = typeof effectiveLimit === 'number' ? skipped.slice(0, effectiveLimit) : skipped
  const projected = applyQueryPlanProjection(limited, plan)

  if (plan.mode === 'first') {
    return { result: projected[0] }
  }

  return {
    ...(plan.pagination.mode === 'offset' ? { mode: 'offset' as const } : {}),
    result: projected,
    skip: effectiveSkip,
    limit: effectiveLimit || 0,
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
  const dirBody = dirConfig.body && typeof dirConfig.body === 'object' && !Array.isArray(dirConfig.body)
    ? dirConfig.body as Record<string, unknown>
    : {}

  return {
    ...content,
    dir: {
      ...dirConfig,
      ...dirBody
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
const executeLocalePlan = <T>(graph: ContentGraph, plan: ContentQueryPlan, options: ExecuteQueryPlanOptions): ContentQueryResponse<T> => {
  const requestedLocale = plan.resolveLocale?.locale
  const collectionConfig = plan.collection ? options.collections?.[plan.collection] : undefined
  const collectionI18n = collectionConfig?.i18n && typeof collectionConfig.i18n === 'object' ? collectionConfig.i18n : undefined
  const defaultLocale = collectionI18n?.defaultLocale || options.defaultLocale
  const locales = collectionI18n?.locales?.length ? collectionI18n.locales : []
  const candidates = selectGraphDocuments(graph, {
    collection: plan.collection,
    paths: collectFieldComparisons(plan.filter, 'path')
  }) as Array<Record<string, unknown> & ParsedContent>

  const localeChain = plan.resolveLocale?.exact
    ? (requestedLocale ? [requestedLocale] : [])
    : plan.resolveLocale?.fallback !== undefined
      ? Array.from(new Set([requestedLocale, ...plan.resolveLocale.fallback].filter(Boolean) as string[]))
      : resolveLocaleChain(requestedLocale, defaultLocale, requestedLocale
        ? { [requestedLocale]: options.localeFallback?.[requestedLocale] || [] }
        : {})
  const localeRank = new Map(localeChain.map((locale, index) => [locale, index]))
  const hasExplicitLocalePolicy = plan.resolveLocale?.exact === true || plan.resolveLocale?.fallback !== undefined
  const merged: Array<{ rank: number, item: T }> = []
  const indexByCanonical = new Map<string, number>()

  for (const item of candidates.filter(item => evaluateQueryPlanFilter(item, plan.filter))) {
    if (plan.resolveLocale?.exact && item.locale !== requestedLocale) {
      continue
    }
    if (hasExplicitLocalePolicy && !localeRank.has(item.locale || '')) {
      continue
    }

    const identity = item.canonicalKey || item.id || item.path
    const key = typeof identity === 'string' ? `${item.collection || 'content'}\0${identity}` : identity
    const rank = localeRank.get(item.locale || '') ?? Number.MAX_SAFE_INTEGER
    const allCanonicalVariants = item.canonicalKey
      ? getGraphCanonicalVariants(graph, item.canonicalKey, item.collection)
      : undefined
    const canonicalVariants = allCanonicalVariants && options.includeDrafts === false
      ? Object.fromEntries(Object.entries(allCanonicalVariants).filter(([, entry]) => !entry.document.draft))
      : allCanonicalVariants
    const availableLocales = canonicalVariants
      ? sortLocalesCanonically(Object.keys(canonicalVariants), { defaultLocale, locales })
      : [item.locale].filter(Boolean) as string[]
    const variantPaths = canonicalVariants
      ? Object.fromEntries(Object.entries(canonicalVariants).map(([locale, entry]) => [locale, entry.path]))
      : undefined
    const enriched = {
      ...item,
      resolved: {
        ...(item.resolved || {}),
        requestedLocale,
        locale: item.locale,
        fallback: item.locale !== requestedLocale,
        availableLocales,
        ...(variantPaths ? { variantPaths } : {})
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

const executeVariantPlan = <T>(graph: ContentGraph, plan: ContentQueryPlan, options: ExecuteQueryPlanOptions): ContentQueryResponse<T> => {
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
          locales: collectionI18n?.locales,
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
            : (plan.resolveVariant!.fallback !== undefined
                ? Array.from(new Set([plan.resolveVariant!.locale, ...plan.resolveVariant!.fallback].filter(Boolean) as string[]))
                : resolveLocaleChain(plan.resolveVariant!.locale, defaultLocale, localeFallback || {}))
          const collectionVariants = plan.collection
            ? Object.values(graph.byCollectionCanonical[plan.collection] || {})
            : Object.values(graph.byCollectionCanonical).flatMap(entries => Object.values(entries))
          const candidateLocales = localeChain.length
            ? localeChain
            : sortLocalesCanonically(collectionVariants.flatMap(variants => Object.keys(variants)), { defaultLocale, locales: collectionI18n?.locales })
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
              locales: collectionI18n?.locales,
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
            locales: collectionI18n?.locales,
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
  const allCanonicalVariants = getGraphCanonicalVariants(graph, variant.canonicalKey, content?.collection) || {}
  const visibleCanonicalVariants = options.includeDrafts === false
    ? Object.fromEntries(Object.entries(allCanonicalVariants).filter(([, entry]) => !entry.document.draft))
    : allCanonicalVariants
  const availableLocales = sortLocalesCanonically(Object.keys(visibleCanonicalVariants), {
    defaultLocale,
    locales: collectionI18n?.locales
  })
  const variantPaths = Object.fromEntries(
    Object.entries(visibleCanonicalVariants).map(([locale, entry]) => [locale, entry.path])
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
      availableLocales,
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
export const executeQueryPlan = <T>(graph: ContentGraph, plan: ContentQueryPlan, options: ExecuteQueryPlanOptions = {}): ContentQueryResponse<T> => {
  if (plan.resolveVariant) {
    return executeVariantPlan<T>(graph, plan, options)
  }

  if (plan.resolveLocale?.locale) {
    return executeLocalePlan<T>(graph, plan, options)
  }

  return executeStandardPlan<T>(graph, plan)
}
