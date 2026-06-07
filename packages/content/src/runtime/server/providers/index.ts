import { useRuntimeConfig } from 'nitropack/runtime'
import { loadExternalContentProvider } from '#content/virtual/providers'
import type { H3Event } from 'h3'
import type { ContentQueryBuilderParams } from '../../../types/query'
import type { ContentProvider } from '../../../public/provider'
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

const findProviderUnsupportedOperator = (value: unknown, supportedOperators: ReadonlySet<string>): string | undefined => {
  if (!value || typeof value !== 'object') return undefined

  if (Array.isArray(value)) {
    for (const child of value) {
      const unsupported = findProviderUnsupportedOperator(child, supportedOperators)
      if (unsupported) return unsupported
    }
    return undefined
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key.startsWith('$') && !supportedOperators.has(key)) return key
    const unsupported = findProviderUnsupportedOperator(child, supportedOperators)
    if (unsupported) return unsupported
  }
}

const assertProviderQuerySupported = (provider: ContentProvider, query: ContentQueryBuilderParams) => {
  const capabilities = provider.capabilities.query
  const unsupportedOperator = findProviderUnsupportedOperator(query.where, new Set(capabilities.operators))
  if (unsupportedOperator) {
    throw createContentProviderError('unsupported_query_operator', `${provider.name} does not support query operator: ${unsupportedOperator}`, {
      provider: provider.name,
      operator: unsupportedOperator
    })
  }

  if (!capabilities.limit && query.limit !== undefined) {
    throw createContentProviderError('unsupported_query_shape', `${provider.name} does not support query limits.`, {
      provider: provider.name,
      field: 'limit'
    })
  }

  if (!capabilities.skip && query.skip !== undefined) {
    throw createContentProviderError('unsupported_query_shape', `${provider.name} does not support query offsets.`, {
      provider: provider.name,
      field: 'skip'
    })
  }

  if (!capabilities.count && query.count === true) {
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

const enforceProviderCapabilities = (provider: ContentProvider): ContentProvider => ({
  ...provider,
  query: async (event, query) => {
    assertProviderQuerySupported(provider, query)
    return await provider.query(event, query)
  },
  navigationQuery: provider.navigationQuery
    ? async (...args) => {
        assertProviderOperationSupported(provider, provider.capabilities.navigation, 'navigation')
        return await provider.navigationQuery!(...args)
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
