import type { H3Event } from 'h3'
import type { ParsedContentMeta } from '../../types/content'
import type { CanonicalQueryPlan, FilterExpr } from '../../core/query/plan'
import { executeQueryPlan } from '../../core/query/execute'
import { resolveContentNavigationData } from '../../features/navigation/query'
import { buildCanonicalNavigation } from '../../features/navigation/build'
import { resolveIncludeDrafts, resolveRuntimeEnvironment } from '../../core/visibility'
import { emitRuntimeDiagnostics, shouldEmitRuntimeDiagnostics } from '../../core/runtime-diagnostics'
import {
  collectUnknownNavigationSelectDiagnostics,
  collectUnmatchedNavigationConfigDiagnostics,
  type NavigationDiagnosticCollections
} from '../../features/navigation/diagnostics'
import { getContentRuntimeConfig } from './runtime-config'
import { resolveLocaleChain } from '../../core/content/locale'
import { getContentGraph } from '../../storage/graph'
import { isPreview } from '../../integrations/nitro/preview'
import { canonicalizeSourcePath, generatePath, normalizeContentPath } from '../../core/content/path'
import { resolveRuntimeCollectionLocalePolicy } from '../../features/localization/config'

interface CanonicalNavigationQuery {
  collection: string
  plan: CanonicalQueryPlan
}

const sourceSegments = (document: ParsedContentMeta) => {
  const path = document.file?.path || document.id.split(':').slice(1).join('/')
  const segments = path.replace(/^\/+/, '').split('/').filter(Boolean)
  return document.locale && segments[0] === document.locale ? segments.slice(1) : segments
}

const sourceDirectory = (document: ParsedContentMeta) =>
  `/${sourceSegments(document).slice(0, -1).join('/')}`

const sourceFilePath = (document: ParsedContentMeta) =>
  `/${sourceSegments(document).join('/')}`

const isDirectoryAncestor = (directory: string, file: string) =>
  directory === '/' || file.startsWith(`${directory}/`)

const andFilters = (...filters: FilterExpr[]): FilterExpr => {
  const clauses = filters.filter(filter => filter.type !== 'true')
  if (!clauses.length) return { type: 'true' }
  if (clauses.length === 1) return clauses[0]!
  return { type: 'and', clauses }
}

const trustedNavigationPlan = (
  source: CanonicalQueryPlan,
  collection: string | null,
  filter: FilterExpr,
  sort = source.sort
): CanonicalQueryPlan => {
  const {
    collection: _collection,
    pagination: _pagination,
    resolveLocale: _resolveLocale,
    variant: _variant,
    ...base
  } = source
  return {
    ...base,
    ...(collection ? { collection } : {}),
    filter,
    sort: [...sort],
    projection: { only: [], without: [] },
    pagination: { mode: 'slice', skip: 0 },
    mode: 'all'
  }
}

export async function resolveContentNavigation (
  event: H3Event,
  query: CanonicalNavigationQuery
) {
  const runtimeConfig = getContentRuntimeConfig()
  const collectionPolicy = resolveRuntimeCollectionLocalePolicy(query.collection, runtimeConfig.content)
  if (!collectionPolicy) {
    throw new Error(`Missing resolved locale policy for content collection "${query.collection}".`)
  }
  const environment = resolveRuntimeEnvironment()
  const requestedFields = query.plan.projection.only.map(String)
  const diagnosticsEnabled = shouldEmitRuntimeDiagnostics(environment, Boolean(import.meta.prerender))

  if (diagnosticsEnabled) {
    emitRuntimeDiagnostics(collectUnknownNavigationSelectDiagnostics(
      requestedFields,
      query.collection,
      runtimeConfig.content.collections as NavigationDiagnosticCollections | undefined
    ))
  }

  return await resolveContentNavigationData({
    defaultLocale: runtimeConfig.content.defaultLocale,
    localeFallback: runtimeConfig.content.localeFallback,
    navigation: runtimeConfig.public.content.navigation
  }, {
    request: query.plan.resolveLocale || {},
    loadLocaleNavigation: async (locale?: string) => {
      const graph = await getContentGraph(event)
      const includeDrafts = resolveIncludeDrafts({
        environment,
        previewAuthorized: isPreview(event)
      })
      const localeFilter: FilterExpr = locale
        ? { type: 'compare', field: 'locale', operator: 'eq', value: locale }
        : { type: 'true' }
      const draftFilter: FilterExpr = includeDrafts
        ? { type: 'true' }
        : { type: 'compare', field: 'draft', operator: 'ne', value: true }
      const contentsPlan = trustedNavigationPlan(query.plan, query.collection, andFilters(
        query.plan.filter,
        { type: 'compare', field: 'partial', operator: 'eq', value: false },
        { type: 'compare', field: 'type', operator: 'eq', value: 'markdown' },
        { type: 'compare', field: 'navigation', operator: 'ne', value: false },
        localeFilter,
        draftFilter
      ))
      // Navigation files are collection-neutral structural metadata. Ownership
      // is established below by joining their real directory to actual pages
      // selected for this collection.
      const configsPlan = trustedNavigationPlan(query.plan, null, andFilters(
        { type: 'compare', field: 'navigationFile', operator: 'eq', value: true },
        { type: 'compare', field: 'partial', operator: 'eq', value: true },
        localeFilter,
        draftFilter
      ), [])
      const queryOptions = {
        defaultLocale: runtimeConfig.content.defaultLocale,
        localeFallback: runtimeConfig.content.localeFallback,
        collections: runtimeConfig.content.collections,
        includeDrafts
      }
      const contentsResult = executeQueryPlan<ParsedContentMeta>(graph, contentsPlan, queryOptions)
      const configsResult = executeQueryPlan<ParsedContentMeta>(graph, configsPlan, queryOptions)
      const contents = Array.isArray(contentsResult.result) ? contentsResult.result : []
      const dirConfigs = Array.isArray(configsResult.result) ? configsResult.result : []
      if (diagnosticsEnabled) {
        emitRuntimeDiagnostics(collectUnmatchedNavigationConfigDiagnostics(graph.documents, {
          locale,
          defaultLocale: runtimeConfig.content.defaultLocale
        }))
      }
      const pageFiles = contents.map(sourceFilePath)
      const configs = dirConfigs.reduce((accumulator, config) => {
        const directory = normalizeContentPath(sourceDirectory(config))
        if (!pageFiles.some(file => isDirectoryAncestor(directory, file))) {
          return accumulator
        }
        const configLocale = config.locale || locale || collectionPolicy.defaultLocale
        const mount = collectionPolicy.localized
          ? collectionPolicy.routeMounts[configLocale]
          : collectionPolicy.routeMounts.default
        if (!mount) {
          throw new Error(`Missing route mount for navigation locale "${configLocale}".`)
        }
        const canonicalPath = canonicalizeSourcePath(generatePath(directory), mount).path
        if (accumulator[canonicalPath]) {
          throw new Error(
            `Navigation configuration conflict: more than one file resolves to canonical directory "${canonicalPath}".`
          )
        }
        accumulator[canonicalPath] = {
          ...config,
          path: canonicalPath,
          ...(config.body && typeof config.body === 'object' && !Array.isArray(config.body)
            ? config.body as Record<string, unknown>
            : {})
        } as ParsedContentMeta
        return accumulator
      }, {} as Record<string, ParsedContentMeta>)

      const configuredFields = runtimeConfig.public.content.navigation === false ? [] : runtimeConfig.public.content.navigation.fields
      return buildCanonicalNavigation(contents, configs, [...new Set([...configuredFields, ...requestedFields])])
    },
    resolveLocaleChain
  })
}
