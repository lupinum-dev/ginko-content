import { createError, type H3Event } from 'h3'
import type { ContentQueryFindResponse, ContentQueryResponse } from '../../types/api'
import type { ContentQueryPlan, FilterExpr } from '../../core/query/plan'
import { isContentProviderVariantSelector, isPlanRegex } from '../../core/query/plan'
import { executeQueryPlan } from '../../core/query/execute'
import { ContentError, type ContentErrorCode } from '../../core/errors'
import { assertFilesystemPreviewSupported, resolveIncludeDrafts, resolveRuntimeEnvironment } from '../../core/visibility'
import { withResolvedRefs, withResolvedRefsList } from '../../storage/references'
import { getContentGraph } from '../../storage/graph'
import { getContentRuntimeConfig } from './runtime-config'
import { isPreview } from '../../integrations/nitro/preview'

const notFound = (plan: ContentQueryPlan, description = 'Could not find document for the given query.') => {
  throw createError({
    statusMessage: 'Document not found!',
    statusCode: 404,
    data: {
      description,
      query: plan
    }
  })
}

/**
 * HTTP-boundary mapping for typed content errors.
 *
 * Content-shape failures are author-visible (500-class: the build is broken),
 * not request-visible (4xx). `INVALID_REF_VALUE` is the exception: it's a
 * single malformed frontmatter value we surface as a 422 so CI can isolate
 * the offending file without a stack trace.
 */
const statusForContentError: Partial<Record<ContentErrorCode, number>> = {
  INVALID_REF_VALUE: 422
}

const toHttpError = (error: ContentError, plan: ContentQueryPlan) => createError({
  statusCode: statusForContentError[error.code] ?? 500,
  statusMessage: error.code,
  message: error.message,
  data: { code: error.code, context: error.context, query: plan }
})

const badQuery = (message: string) => {
  throw createError({
    statusCode: 400,
    statusMessage: 'Invalid content query',
    message
  })
}

/**
 * Detect a regex operand anywhere in a lowered filter tree. After lowering, a
 * `$regex` clause becomes a `regex` compare node and a bare `/.../` operand
 * becomes an `eq` node whose value is a tagged `PlanRegex` — the
 * public HTTP query surface rejects both, so untrusted callers cannot run
 * arbitrary regular expressions against the corpus.
 */
const planFilterContainsRegex = (filter: FilterExpr): boolean => {
  switch (filter.type) {
    case 'true':
      return false
    case 'compare':
      return filter.operator === 'regex' || isPlanRegex(filter.value)
    case 'and':
    case 'or':
      return filter.clauses.some(planFilterContainsRegex)
    case 'not':
      return planFilterContainsRegex(filter.clause)
    default:
      throw new TypeError(`Unknown query filter node: ${(filter as { type?: unknown }).type}`)
  }
}

/**
 * Combine a base filter with additional AND clauses, keeping the plan minimal
 * (identity `true` nodes drop out; a single surviving clause is not wrapped).
 */
const andPlanFilters = (base: FilterExpr, ...extra: FilterExpr[]): FilterExpr => {
  const clauses = [base, ...extra].filter(clause => clause.type !== 'true')
  if (!clauses.length) return { type: 'true' }
  if (clauses.length === 1) return clauses[0]!
  return { type: 'and', clauses }
}

/**
 * The filesystem provider's public-query policy, applied to the wire plan it
 * receives: require a collection target, reject untrusted regex, clamp
 * limit/skip to the public ceilings, and enforce the one core
 * publication-visibility decision (draft) plus structural eligibility
 * (`partial` and `navigationFile`).
 *
 * This enforcement is unconditional (AND-combined with whatever the caller's
 * own filter already says), not skipped when the caller already filters on
 * `draft`/`partial` — this is the untrusted public boundary, so an explicit
 * `{ draft: true }` from the caller must not be able to unlock drafts the
 * environment says are hidden. Every other filesystem-backed consumer
 * (navigation, sitemap, search, agent output) applies this same decision
 * through its own trusted path; this is only the untrusted-HTTP instance of
 * it, applied here because the filesystem operator surface is fully known
 * (a generic third-party provider is not — see `createProviderQuery`).
 */
const applyFilesystemQueryPolicy = (plan: ContentQueryPlan, includeDrafts: boolean): ContentQueryPlan => {
  if (!plan.collection) {
    badQuery('Public content queries must target a collection.')
  }

  if (planFilterContainsRegex(plan.filter)) {
    badQuery('Public content queries do not accept RegExp filters.')
  }

  const visibilityClauses: FilterExpr[] = [
    { type: 'compare', field: 'partial', operator: 'ne', value: true },
    { type: 'compare', field: 'navigationFile', operator: 'ne', value: true }
  ]
  if (!includeDrafts) {
    visibilityClauses.push({ type: 'compare', field: 'draft', operator: 'ne', value: true })
  }
  const filter = andPlanFilters(plan.filter, ...visibilityClauses)

  return {
    ...plan,
    filter
  }
}

const requestedVariantLocale = (plan: ContentQueryPlan): string | undefined => {
  const variant = plan.variant
  return variant
    ? isContentProviderVariantSelector(variant) ? variant.requestedLocale : variant.locale
    : undefined
}

export const executeFilesystemContentQuery = async <T = unknown>(event: H3Event, inputPlan: ContentQueryPlan): Promise<ContentQueryResponse<T>> => {
  // Fail before any query dispatch touches the sealed snapshot. `getContentGraph` enforces this same guard for every other
  // filesystem-backed consumer (navigation, sitemap, search, agent output);
  // asserting it here too keeps the untrusted HTTP boundary's failure
  // directly attributable to query dispatch, not to a graph-loading detail.
  assertFilesystemPreviewSupported({
    environment: resolveRuntimeEnvironment(),
    previewAuthorized: isPreview(event)
  })

  const config = getContentRuntimeConfig().content || {}
  const includeDrafts = resolveIncludeDrafts({
    environment: resolveRuntimeEnvironment(),
    previewAuthorized: isPreview(event)
  })
  const plan = applyFilesystemQueryPolicy(inputPlan, includeDrafts)
  let graph
  try {
    graph = await getContentGraph(event)
  } catch (cause) {
    if (cause instanceof ContentError) {
      throw toHttpError(cause, plan)
    }
    throw cause
  }
  const response = executeQueryPlan(graph, plan, {
    defaultLocale: config.defaultLocale,
    localeFallback: config.localeFallback,
    collections: config.collections,
    includeDrafts
  })

  if (plan.mode === 'count') {
    return response as ContentQueryResponse<T>
  }

  const requestedLocale = requestedVariantLocale(plan) || plan.resolveLocale?.locale

  if (plan.mode === 'first') {
    const content = response.result
    if (!content) {
      notFound(plan, plan.variant ? 'Could not find document for the given route variant.' : undefined)
    }

    return {
      result: await withResolvedRefs(event, content, requestedLocale) as T
    }
  }

  const listResponse = response as ContentQueryFindResponse<T>
  return {
    ...listResponse,
    result: await withResolvedRefsList(event, Array.isArray(response.result) ? response.result : [], requestedLocale) as T[]
  }
}
