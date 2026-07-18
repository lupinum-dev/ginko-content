import type { H3Event } from 'h3'
import type { ParsedContentMeta } from '../../types/content'
import type { ContentProviderNavigationOptions, ContentProviderQuery } from '../../public/provider-query'
import type { ContentQueryPlan, FilterExpr } from '../../core/query/plan'
import { executeQueryPlan } from '../../core/query/execute'
import { resolveContentNavigationData } from '../../features/navigation/query'
import { buildCanonicalNavigation, requireNavigationDocumentPath } from '../../features/navigation/build'
import { resolveIncludeDrafts, resolveRuntimeEnvironment } from '../../core/visibility'
import { getObjectShape, getSchemaTypeName, unwrapSchema } from '../../core/references/schema'
import { getContentRuntimeConfig } from './runtime-config'
import { resolveLocaleChain } from '../../core/content/locale'
import { getContentGraph } from '../../storage/graph'
import { isPreview } from '../../integrations/nitro/preview'

const andFilters = (...filters: FilterExpr[]): FilterExpr => {
  const clauses = filters.filter(filter => filter.type !== 'true')
  if (!clauses.length) return { type: 'true' }
  if (clauses.length === 1) return clauses[0]!
  return { type: 'and', clauses }
}

const navigationDiagnosticKeys = new Set<string>()
const navigationSharedVocabulary = new Set([
  'badge',
  'description',
  'hidden',
  'icon',
  'navigation',
  'order',
  'sidebar',
  'title'
])
const navigationRequiredFields = new Set([
  'id',
  'path',
  'file',
  'canonicalKey',
  'locale',
  'draft',
  'navigation',
  'title'
])

const warnNavigationDiagnostic = (key: string, message: string) => {
  if (navigationDiagnosticKeys.has(key)) {
    return
  }

  navigationDiagnosticKeys.add(key)
  console.warn(`[ginko-content] ${message}`)
}

const collectCollectionSchemaFields = (schema: unknown): Set<string> | null => {
  const current = unwrapSchema(schema)
  if (!current || getSchemaTypeName(current) !== 'ZodObject') {
    return null
  }

  return new Set(Object.keys(getObjectShape(current)))
}

const warnUnknownNavigationSelectFields = (
  fields: readonly string[],
  collection: string | null,
  collections: Record<string, { schema?: unknown }> | undefined
) => {
  if (!collection) {
    return
  }

  const schemaFields = collectCollectionSchemaFields(collections?.[collection]?.schema)
  if (!schemaFields) {
    return
  }

  for (const field of fields) {
    if (
      navigationRequiredFields.has(field)
      || navigationSharedVocabulary.has(field)
      || schemaFields.has(field)
    ) {
      continue
    }

    warnNavigationDiagnostic(
      `select:${collection}:${field}`,
      `Navigation select field "${field}" is not declared in collection "${collection}" or the shared navigation vocabulary.`
    )
  }
}

const normalizeNavigationDiagnosticPath = (path: string) =>
  path !== '/' && path.endsWith('/') ? path.replace(/\/+$/, '') : path

const warnUnmatchedNavigationConfigs = (
  configs: readonly ParsedContentMeta[],
  contents: readonly ParsedContentMeta[],
  locale?: string
) => {
  const contentPaths = contents
    .map(content => typeof content.path === 'string' ? normalizeNavigationDiagnosticPath(content.path) : undefined)
    .filter((path): path is string => Boolean(path))

  for (const config of configs) {
    if (typeof config.path !== 'string') {
      continue
    }

    const configPath = normalizeNavigationDiagnosticPath(config.path)
    const matchesContent = contentPaths.some(path => path === configPath || path.startsWith(`${configPath}/`))
    if (matchesContent) {
      continue
    }

    warnNavigationDiagnostic(
      `config:${locale || '*'}:${config.file?.path || config.id}:${configPath}`,
      `.navigation.yml "${config.file?.path || config.id}" does not match any navigation folder for locale "${locale || 'default'}".`
    )
  }
}

const trustedNavigationPlan = (
  source: ContentQueryPlan,
  collection: string | null,
  filter: FilterExpr,
  sort = source.sort
): ContentQueryPlan => {
  const {
    collection: _collection,
    limit: _limit,
    paging: _paging,
    resolveLocale: _resolveLocale,
    resolveVariant: _resolveVariant,
    variantSelector: _variantSelector,
    ...base
  } = source
  return {
    ...base,
    ...(collection ? { collection } : {}),
    filter,
    sort: [...sort],
    projection: { only: [], without: [] },
    skip: 0,
    mode: 'all'
  }
}

export async function resolveContentNavigation (
  event: H3Event,
  query: ContentProviderQuery,
  navigationOptions: ContentProviderNavigationOptions = {}
) {
  const runtimeConfig = getContentRuntimeConfig()
  const environment = resolveRuntimeEnvironment()
  const requestedFields = query.plan.projection.only.map(String)
  const diagnosticsEnabled = environment === 'development'

  if (diagnosticsEnabled) {
    warnUnknownNavigationSelectFields(
      requestedFields,
      query.collection,
      runtimeConfig.content.collections as Record<string, { schema?: unknown }> | undefined
    )
  }

  return await resolveContentNavigationData({
    defaultLocale: runtimeConfig.content.defaultLocale,
    localeFallback: runtimeConfig.content.localeFallback,
    navigation: runtimeConfig.public.content.navigation
  }, {
    request: {
      ...(navigationOptions.locale ? { locale: navigationOptions.locale } : {}),
      ...(navigationOptions.fallback !== undefined ? { fallback: navigationOptions.fallback } : {}),
      ...(navigationOptions.exact ? { exact: true } : {})
    },
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
      // `.navigation.yml` files are path-keyed structural metadata, not
      // collection members: collection sources typically glob `*.md`, so these
      // rows carry no `collection` field and a collection-scoped plan would
      // never find them. Querying without a collection is safe — the builder
      // only consults `configs[folderPath]` for paths inside this tree.
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
        warnUnmatchedNavigationConfigs(dirConfigs, contents, locale)
      }
      const configs = dirConfigs.reduce((accumulator, config) => {
        requireNavigationDocumentPath(config, 'directory configuration')
        accumulator[config.path] = {
          ...config,
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
