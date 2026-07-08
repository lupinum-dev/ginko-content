import type { H3Event } from 'h3'
import type { NavItem, ParsedContentMeta } from '../../types/content'
import type { ContentQueryBuilderParams, ContentQueryBuilderWhere, ContentQuerySortOptions } from '../../types/query'
import type { ContentProviderNavigationOptions, ContentProviderQuery } from '../../public/provider-query'
import type { FilterExpr, SortClause } from '../../core/query/plan'
import { isPlanRegex } from '../../core/query/plan'
import { resolveContentNavigationData } from '../../features/navigation/query'
import { buildCanonicalNavigation } from '../../features/navigation/build'
import { markCollectionNavigationRoot, projectNavigationTree, type CanonicalNavigationItem } from '../../features/navigation/canonical'
import { normalizeRouteMounts } from '../../features/localization/path'
import { getContentRuntimeConfig } from './runtime-config'
import { isPreview } from './preview'
import { cacheStorage } from './storage-access'
import { createServerContentQuery } from './storage'
import { resolveLocaleChain } from './manifest'

const reviveFilterValue = (value: unknown): unknown =>
  isPlanRegex(value) ? new RegExp(value.source, value.flags) : value

const conditionsToWhereCondition = (conditions: ContentQueryBuilderWhere[]): ContentQueryBuilderWhere => {
  if (!conditions.length) return {}
  if (conditions.length === 1) return conditions[0]!
  return { $and: conditions }
}

/**
 * Reconstruct builder `where` conditions from a lowered `FilterExpr` so the
 * navigation pipeline — which still composes queries through the builder — can
 * consume the wire plan. `and` flattens to sibling conditions (AND); `or`/`not`
 * map back to their `$or`/`$not` builder forms.
 */
const filterToWhereConditions = (filter: FilterExpr): ContentQueryBuilderWhere[] => {
  switch (filter.type) {
    case 'true':
      return []
    case 'compare':
      return [
        filter.operator === 'eq'
          ? { [filter.field]: reviveFilterValue(filter.value) } as ContentQueryBuilderWhere
          : { [filter.field]: { [`$${filter.operator}`]: reviveFilterValue(filter.value) } } as ContentQueryBuilderWhere
      ]
    case 'and':
      return filter.clauses.flatMap(filterToWhereConditions)
    case 'or':
      return [{ $or: filter.clauses.map(clause => conditionsToWhereCondition(filterToWhereConditions(clause))) }]
    case 'not':
      return [{ $not: conditionsToWhereCondition(filterToWhereConditions(filter.clause)) }]
    default:
      throw new TypeError(`Unknown query filter node: ${(filter as { type?: unknown }).type}`)
  }
}

const sortClausesToBuilder = (sort: SortClause[]): ContentQuerySortOptions[] =>
  sort.map(clause => ({
    [clause.field]: clause.direction,
    ...(clause.locale ? { $locale: clause.locale } : {}),
    ...(typeof clause.numeric === 'boolean' ? { $numeric: clause.numeric } : {}),
    ...(clause.caseFirst ? { $caseFirst: clause.caseFirst } : {}),
    ...(clause.sensitivity ? { $sensitivity: clause.sensitivity } : {})
  } as ContentQuerySortOptions))

/**
 * Rebuild the builder params the navigation pipeline expects from the wire
 * pair (CS-5): collection + user filter/sort come from the plan; `fields`,
 * `canonical`, and the raw `resolveLocale` come from the navigation options.
 */
const providerQueryToNavigationParams = (
  query: ContentProviderQuery,
  options: ContentProviderNavigationOptions
): ContentQueryBuilderParams => {
  const where = filterToWhereConditions(query.plan.filter)
  const sort = sortClausesToBuilder(query.plan.sort)
  return {
    ...(query.collection ? { collection: query.collection } : {}),
    ...(where.length ? { where } : {}),
    ...(sort.length ? { sort } : {}),
    ...(options.resolveLocale ? { resolveLocale: options.resolveLocale } : {}),
    ...(options.fields?.length ? { only: options.fields } : {}),
    ...(options.canonical ? { canonical: true } : {})
  }
}

export async function resolveContentNavigation (
  event: H3Event,
  query: ContentProviderQuery,
  navigationOptions: ContentProviderNavigationOptions = {}
) {
  const inputQuery = providerQueryToNavigationParams(query, navigationOptions)
  const runtimeConfig = getContentRuntimeConfig()
  const requestedFields = [
    ...(Array.isArray(inputQuery.only) ? inputQuery.only.map(String) : []),
    ...(Array.isArray(inputQuery.navigationFields) ? inputQuery.navigationFields : [])
  ]
  const sourceQuery = { ...inputQuery }
  if ('canonical' in sourceQuery) {
    delete sourceQuery.canonical
  }
  if ('navigationFields' in sourceQuery) {
    delete sourceQuery.navigationFields
  }
  if ('only' in sourceQuery) {
    delete sourceQuery.only
  }
  if ('resolveLocale' in sourceQuery) {
    delete sourceQuery.resolveLocale
  }

  return await resolveContentNavigationData({
    defaultLocale: runtimeConfig.content.defaultLocale,
    localeFallback: runtimeConfig.content.localeFallback,
    navigation: runtimeConfig.public.content.navigation,
    cacheEnabled: true,
    isPreview: isPreview(event)
  }, {
    query: inputQuery,
    readCache: async () => {
      const cached = await cacheStorage(event).getItem('_nav.json')
      return cached as NavItem[] | null
    },
    loadLocaleNavigation: async (locale?: string) => {
      let contentsQuery = createServerContentQuery(event, sourceQuery)
        .where('partial', '=', false)
        .where('type', '=', 'markdown')
        .where('navigation', '!=', false)

      if (locale) {
        contentsQuery = contentsQuery.where('locale', '=', locale)
      }

      let dirConfigsQuery = createServerContentQuery(event)
        .where('navigationFile', '=', true)
        .where('partial', '=', true)

      if (locale) {
        dirConfigsQuery = dirConfigsQuery.where('locale', '=', locale)
      }

      const contents = await contentsQuery.all()
      const dirConfigs = await dirConfigsQuery.all()
      const configs = dirConfigs.reduce((accumulator, config) => {
        accumulator[config.path || '/'] = {
          ...config,
          ...config.body
        } as ParsedContentMeta
        return accumulator
      }, {} as Record<string, ParsedContentMeta>)

      const configuredFields = runtimeConfig.public.content.navigation === false ? [] : runtimeConfig.public.content.navigation.fields
      return buildCanonicalNavigation(contents as ParsedContentMeta[], configs, [...new Set([...configuredFields, ...requestedFields])]) as NavItem[]
    },
    resolveLocaleChain,
    localizeNavigation: async (items, locale, _unusedFallback = [], collection, canonical) => {
      const collectionI18n = collection ? runtimeConfig.content.collections?.[collection]?.i18n : undefined
      const collectionLocales = collectionI18n && typeof collectionI18n === 'object' ? collectionI18n.locales : undefined
      const collectionDefault = collectionI18n && typeof collectionI18n === 'object' ? collectionI18n.defaultLocale : undefined
      const locales = collectionLocales?.length ? collectionLocales : runtimeConfig.content.locales
      const defaultLocale = collectionDefault || runtimeConfig.content.defaultLocale
      const routeMounts = collection
        ? normalizeRouteMounts(runtimeConfig.content.collections?.[collection]?.route, locales, defaultLocale)
        : undefined
      const navigation = markCollectionNavigationRoot(items as CanonicalNavigationItem[], collection, { routeMounts })
      return projectNavigationTree(navigation, {
        locale,
        defaultLocale,
        routeMounts,
        collection,
        canonical
      }) as NavItem[]
    }
  })
}
