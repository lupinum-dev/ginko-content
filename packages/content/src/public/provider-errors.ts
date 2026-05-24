import { createError } from 'h3'

export type ContentProviderErrorCode =
  | 'unknown_provider'
  | 'unknown_collection'
  | 'unsupported_provider_operation'
  | 'unsupported_query_operator'
  | 'unsupported_query_shape'
  | 'data_collection_route_access'
  | 'data_collection_search_access'
  | 'data_collection_sitemap_access'
  | 'missing_locale_route'
  | 'provider_config_missing'
  | 'provider_module_missing'
  | 'provider_module_invalid'
  | 'unsupported_provider_search_index'
  | 'unsupported_provider_search'
  | 'unsupported_provider_site_data'
  | 'unsupported_provider_prerender'

const statusForProviderError: Record<ContentProviderErrorCode, number> = {
  unknown_provider: 400,
  unknown_collection: 400,
  unsupported_provider_operation: 400,
  unsupported_query_operator: 400,
  unsupported_query_shape: 400,
  data_collection_route_access: 400,
  data_collection_search_access: 400,
  data_collection_sitemap_access: 400,
  missing_locale_route: 404,
  provider_config_missing: 500,
  provider_module_missing: 500,
  provider_module_invalid: 500,
  unsupported_provider_search_index: 400,
  unsupported_provider_search: 400,
  unsupported_provider_site_data: 400,
  unsupported_provider_prerender: 400
}

export const createContentProviderError = (
  code: ContentProviderErrorCode,
  message: string,
  details: Record<string, unknown> = {}
) => createError({
  statusCode: statusForProviderError[code],
  statusMessage: code,
  message,
  data: {
    code,
    ...details
  }
})
