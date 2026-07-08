export type ContentProviderErrorCode =
  | 'unknown_provider'
  | 'unknown_collection'
  | 'unsupported_provider_operation'
  | 'unsupported_query_operator'
  | 'unsupported_query_shape'
  | 'provider_query_not_json_pure'
  | 'data_collection_route_access'
  | 'data_collection_search_access'
  | 'data_collection_sitemap_access'
  | 'missing_locale_route'
  | 'provider_config_missing'
  | 'provider_module_missing'
  | 'provider_module_invalid'
  | 'provider_result_invalid'
  | 'unsupported_provider_search_index'
  | 'unsupported_provider_search'
  | 'unsupported_provider_site_data'
  | 'unsupported_provider_prerender'

export const statusForProviderError: Record<ContentProviderErrorCode, number> = {
  unknown_provider: 400,
  unknown_collection: 400,
  unsupported_provider_operation: 400,
  unsupported_query_operator: 400,
  unsupported_query_shape: 400,
  provider_query_not_json_pure: 500,
  data_collection_route_access: 400,
  data_collection_search_access: 400,
  data_collection_sitemap_access: 400,
  missing_locale_route: 404,
  provider_config_missing: 500,
  provider_module_missing: 500,
  provider_module_invalid: 500,
  provider_result_invalid: 500,
  unsupported_provider_search_index: 400,
  unsupported_provider_search: 400,
  unsupported_provider_site_data: 400,
  unsupported_provider_prerender: 400
}

export interface ContentProviderError extends Error {
  statusCode: number
  statusMessage: ContentProviderErrorCode
  data: Record<string, unknown> & { code: ContentProviderErrorCode }
}

export const createContentProviderError = (
  code: ContentProviderErrorCode,
  message: string,
  details: Record<string, unknown> = {}
): ContentProviderError => Object.assign(new Error(message), {
  statusCode: statusForProviderError[code],
  statusMessage: code,
  data: {
    code,
    ...details
  }
})
