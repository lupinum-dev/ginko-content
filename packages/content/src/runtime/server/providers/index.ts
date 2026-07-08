import { useRuntimeConfig } from 'nitropack/runtime'
import { loadExternalContentProvider } from '#content/virtual/providers'
import type { H3Event } from 'h3'
import type { ContentProvider, ContentProviderQuery } from '../../../public/provider'
import type { FilterExpr } from '../../../core/query/plan'
import { createContentProviderError } from '../../../public/provider-errors'
import { wrapContentProviderCacheResults, type RuntimeContentProvider } from '../provider-result'

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const requiredCapabilityBooleans = [
  'routeBackedCollections',
  'dataCollections',
  'localizedRoutes',
  'translatedSlugs',
  'navigation',
  'surroundings',
  'searchSections',
  'sitemap'
] as const

const assertProviderField = (providerName: string, condition: boolean, field: string) => {
  if (!condition) {
    throw createContentProviderError('provider_module_invalid', `Content provider ${providerName} has an invalid ${field} field.`, {
      provider: providerName,
      field
    })
  }
}

const assertProviderMethod = (providerName: string, provider: Record<string, unknown>, method: keyof ContentProvider) => {
  assertProviderField(providerName, typeof provider[method] === 'function', method)
}

/**
 * Derive the operator vocabulary a plan actually exercises by walking its
 * `FilterExpr` tree (CS-5 trap 3). Only `compare` nodes carry operators; we
 * recurse through `and`/`or`/`not` to reach every one. Operators are reported
 * in the builder's `$`-prefixed vocabulary so they compare directly against
 * `capabilities.query.operators`.
 */
export const collectPlanFilterOperators = (filter: FilterExpr, operators: Set<string> = new Set()): Set<string> => {
  switch (filter.type) {
    case 'true':
      break
    case 'compare':
      operators.add(`$${filter.operator}`)
      break
    case 'and':
    case 'or':
      for (const clause of filter.clauses) {
        collectPlanFilterOperators(clause, operators)
      }
      break
    case 'not':
      collectPlanFilterOperators(filter.clause, operators)
      break
  }
  return operators
}

/**
 * Detect a value that would not survive `JSON.parse(JSON.stringify(value))`
 * unchanged — a live `RegExp`, `Date`, `Map`, `Set`, class instance, function,
 * `bigint`, or `symbol`. `undefined` is allowed (JSON drops it to an absent
 * key, which the plan's optional fields rely on). Returns the offending path,
 * or `undefined` when the value is JSON-pure.
 */
const findNonJsonValue = (value: unknown, path: string): string | undefined => {
  if (value === null || value === undefined) return undefined
  const kind = typeof value
  if (kind === 'string' || kind === 'number' || kind === 'boolean') return undefined
  if (kind === 'function' || kind === 'bigint' || kind === 'symbol') return path
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const offender = findNonJsonValue(value[index], `${path}[${index}]`)
      if (offender) return offender
    }
    return undefined
  }
  if (kind === 'object') {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return path
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const offender = findNonJsonValue(child, `${path}.${key}`)
      if (offender) return offender
    }
    return undefined
  }
  return path
}

/**
 * Dev-mode guard: the provider wire is JSON-pure by contract (CS-5). A stray
 * `RegExp`/`Date` in `plan.filter` would corrupt any provider that serializes
 * the query, so we fail fast in dev instead of shipping a silently mangled
 * wire. No-op in production (the walk is not free).
 */
export const assertJsonPureProviderQuery = (provider: ContentProvider, query: ContentProviderQuery): void => {
  if (!import.meta.dev) return
  const offender = findNonJsonValue(query, 'query')
  if (offender) {
    throw createContentProviderError('provider_query_not_json_pure', `${provider.name} received a non-JSON-pure query at ${offender}. Provider queries must survive JSON.parse(JSON.stringify(query)) — lower RegExp operands to { source, flags }.`, {
      provider: provider.name,
      field: offender
    })
  }
}

const assertProviderQuerySupported = (provider: ContentProvider, query: ContentProviderQuery) => {
  const capabilities = provider.capabilities.query
  const supported = new Set(capabilities.operators)
  const usedOperators = collectPlanFilterOperators(query.plan.filter)
  for (const operator of usedOperators) {
    if (!supported.has(operator)) {
      throw createContentProviderError('unsupported_query_operator', `${provider.name} does not support query operator: ${operator}`, {
        provider: provider.name,
        operator
      })
    }
  }

  if (!capabilities.limit && query.plan.limit !== undefined) {
    throw createContentProviderError('unsupported_query_shape', `${provider.name} does not support query limits.`, {
      provider: provider.name,
      field: 'limit'
    })
  }

  if (!capabilities.skip && query.plan.skip > 0) {
    throw createContentProviderError('unsupported_query_shape', `${provider.name} does not support query offsets.`, {
      provider: provider.name,
      field: 'skip'
    })
  }

  if (!capabilities.count && query.plan.mode === 'count') {
    throw createContentProviderError('unsupported_query_shape', `${provider.name} does not support count queries.`, {
      provider: provider.name,
      field: 'count'
    })
  }
}

const assertProviderOperationSupported = (
  provider: ContentProvider,
  supported: boolean,
  operation: string
) => {
  if (!supported) {
    throw createContentProviderError('unsupported_provider_operation', `${provider.name} does not support ${operation}.`, {
      provider: provider.name,
      operation
    })
  }
}

export const enforceProviderCapabilities = (provider: ContentProvider): ContentProvider => ({
  ...provider,
  query: async (event, query) => {
    assertJsonPureProviderQuery(provider, query)
    assertProviderQuerySupported(provider, query)
    return await provider.query(event, query)
  },
  navigationQuery: provider.navigationQuery
    ? async (event, query, options) => {
        assertProviderOperationSupported(provider, provider.capabilities.navigation, 'navigation')
        assertJsonPureProviderQuery(provider, query)
        return await provider.navigationQuery!(event, query, options)
      }
    : undefined,
  navigation: provider.navigation
    ? async (...args) => {
        assertProviderOperationSupported(provider, provider.capabilities.navigation, 'navigation')
        return await provider.navigation!(...args)
      }
    : undefined,
  surroundings: provider.surroundings
    ? async (...args) => {
        assertProviderOperationSupported(provider, provider.capabilities.surroundings, 'surroundings')
        return await provider.surroundings!(...args)
      }
    : undefined,
  searchSections: provider.searchSections
    ? async (...args) => {
        assertProviderOperationSupported(provider, provider.capabilities.searchSections, 'search sections')
        return await provider.searchSections!(...args)
      }
    : undefined,
  page: provider.page
    ? async (...args) => {
        assertProviderOperationSupported(provider, provider.capabilities.routeBackedCollections, 'route-backed pages')
        return await provider.page!(...args)
      }
    : undefined,
  routeMeta: provider.routeMeta
    ? async (...args) => {
        assertProviderOperationSupported(provider, provider.capabilities.routeBackedCollections, 'route metadata')
        return await provider.routeMeta!(...args)
      }
    : undefined,
  sitemapEntries: provider.sitemapEntries
    ? async (...args) => {
        assertProviderOperationSupported(provider, provider.capabilities.sitemap, 'sitemap entries')
        return await provider.sitemapEntries!(...args)
      }
    : undefined
})

const validateContentProvider = (providerName: string, provider: unknown): ContentProvider => {
  if (!isObject(provider)) {
    throw createContentProviderError('provider_module_invalid', `Content provider module for ${providerName} did not export a provider object.`, {
      provider: providerName
    })
  }

  if (typeof provider.name !== 'string') {
    throw createContentProviderError('provider_module_invalid', `Content provider ${providerName} is missing a string name.`, {
      provider: providerName,
      field: 'name'
    })
  }

  if (!isObject(provider.capabilities) || !isObject(provider.capabilities.query)) {
    throw createContentProviderError('provider_module_invalid', `Content provider ${providerName} is missing capabilities.`, {
      provider: providerName,
      field: 'capabilities'
    })
  }

  for (const key of requiredCapabilityBooleans) {
    assertProviderField(providerName, typeof provider.capabilities[key] === 'boolean', `capabilities.${key}`)
  }

  const queryCapabilities = provider.capabilities.query
  assertProviderField(
    providerName,
    Array.isArray(queryCapabilities.operators) && queryCapabilities.operators.every(operator => typeof operator === 'string'),
    'capabilities.query.operators'
  )
  assertProviderField(providerName, typeof queryCapabilities.limit === 'boolean', 'capabilities.query.limit')
  assertProviderField(providerName, typeof queryCapabilities.skip === 'boolean', 'capabilities.query.skip')
  assertProviderField(providerName, typeof queryCapabilities.count === 'boolean', 'capabilities.query.count')

  assertProviderMethod(providerName, provider, 'query')

  if (provider.capabilities.navigation) {
    assertProviderMethod(providerName, provider, 'navigationQuery')
    assertProviderMethod(providerName, provider, 'navigation')
  }

  if (provider.capabilities.surroundings) {
    assertProviderMethod(providerName, provider, 'surroundings')
  }

  if (provider.capabilities.searchSections) {
    assertProviderMethod(providerName, provider, 'searchSections')
  }

  if (provider.capabilities.sitemap) {
    assertProviderMethod(providerName, provider, 'sitemapEntries')
  }

  if (provider.capabilities.routeBackedCollections || provider.capabilities.localizedRoutes) {
    assertProviderMethod(providerName, provider, 'page')
    assertProviderMethod(providerName, provider, 'routeMeta')
  }

  return provider as unknown as ContentProvider
}

export async function getContentProvider(): Promise<ContentProvider>
export async function getContentProvider(event: H3Event): Promise<RuntimeContentProvider>
export async function getContentProvider(event?: H3Event): Promise<ContentProvider | RuntimeContentProvider> {
  const runtime = event ? useRuntimeConfig(event) : useRuntimeConfig()
  const eventContent = event?.context?.contentRuntime as { provider?: unknown } | undefined
  const provider = eventContent?.provider || runtime.content?.provider || runtime.public?.content?.provider || 'filesystem'

  if (provider === 'filesystem') {
    const { filesystemProvider } = await import('./filesystem.js')
    const enforced = enforceProviderCapabilities(filesystemProvider)
    return event ? wrapContentProviderCacheResults(event, enforced) : enforced
  }

  if (typeof provider === 'string') {
    try {
      const externalProvider = await loadExternalContentProvider(provider)
      if (externalProvider) {
        const validated = enforceProviderCapabilities(validateContentProvider(provider, externalProvider))
        return event ? wrapContentProviderCacheResults(event, validated) : validated
      }
    } catch (error) {
      if (isObject(error) && error.statusMessage === 'provider_module_invalid') {
        throw error
      }
      throw createContentProviderError('provider_module_missing', `Content provider module for ${provider} could not be loaded.`, {
        provider,
        cause: error instanceof Error ? error.message : String(error)
      })
    }
  }

  throw createContentProviderError('unknown_provider', `Unknown content provider: ${provider}`, { provider })
}
