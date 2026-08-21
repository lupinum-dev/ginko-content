/**
 * Low-level query input shared by the public provider-lowering helpers and the
 * internal unified-query compiler. It is not the provider wire contract:
 * providers receive the closed `ContentProviderQuery` plan envelope instead.
 *
 * Application consumers should normally use the unified query vocabulary
 * (`one`/`many`/`paginate` with `QueryWhere`/`QueryOperators`). Provider authors
 * may use `ContentProviderQueryInput` with `toContentProviderQuery` when they
 * need to exercise the provider contract directly.
 */
import type { ParsedContentInternalMeta } from '../content'
import type { ContentProviderPaging } from '../../core/query/plan'

export const CONTENT_QUERY_INPUT_KEYS = [
  'collection', 'first', 'count', 'skip', 'limit', 'only', 'without', 'sort',
  'where', 'resolveLocale', 'resolveVariant', 'paging'
] as const
export const CONTENT_QUERY_RESOLUTION_KEYS = ['locale', 'fallback', 'exact'] as const
export const CONTENT_QUERY_VARIANT_SELECTOR_KEYS = ['path', 'route', 'ref'] as const
export const CONTENT_QUERY_OFFSET_PAGING_KEYS = ['mode', 'skip', 'limit'] as const
export const CONTENT_QUERY_CURSOR_PAGING_KEYS = ['mode', 'after', 'limit'] as const

export interface ContentQuerySortParams {
  $locale?: string
  $numeric?: boolean
  $caseFirst?: 'upper' | 'lower' | 'false'
  $sensitivity?: 'base' | 'accent' | 'case' | 'variant'
}

export interface ContentQuerySortFields {
  [field: string]: -1 | 1
}

export type ContentQuerySortOptions = ContentQuerySortParams | ContentQuerySortFields

export interface ContentProviderQueryWhere extends Partial<Record<keyof ParsedContentInternalMeta, string | number | boolean | RegExp | ContentProviderQueryWhere>> {
  $and?: ContentProviderQueryWhere[]
  $or?: ContentProviderQueryWhere[]
  $not?: ContentProviderQueryWhere
  $eq?: string | number | boolean | RegExp
  $ne?: string | number | boolean | RegExp
  $gt?: number | string
  $gte?: number | string
  $lt?: number | string
  $lte?: number | string
  $regex?: RegExp | string
  $prefix?: string
  $type?: string
  $exists?: boolean
  $contains?: Array<string | number | boolean> | string | number | boolean
  $containsAny?: Array<string | number | boolean>
  $icontains?: string
  $in?: Array<string | number | boolean>
  $nin?: Array<string | number | boolean>

  [key: string]: string | number | boolean | RegExp | ContentProviderQueryWhere | Array<string | number | boolean | ContentProviderQueryWhere> | undefined
}

export interface ContentProviderQueryInput {
  collection?: string
  first?: boolean
  count?: boolean
  skip?: number
  limit?: number
  only?: string[]
  without?: string[]
  sort?: ContentQuerySortOptions[]
  where?: ContentProviderQueryWhere[] | ContentProviderQueryWhere
  resolveLocale?: {
    locale?: string
    fallback?: string[] | boolean
    exact?: boolean
  }
  resolveVariant?: {
    path?: string
    route?: string
    ref?: string
    locale?: string
    fallback?: string[] | boolean
    exact?: boolean
  }
  /** Explicit wire pagination-mode request — see `ContentProviderPaging`. */
  paging?: ContentProviderPaging
}

/** HTTP/in-process orchestration input. `populate` is consumed by Ginko and never sent to providers. */
export interface ContentQueryTransportInput extends ContentProviderQueryInput {
  populate?: Record<string, string>
}
