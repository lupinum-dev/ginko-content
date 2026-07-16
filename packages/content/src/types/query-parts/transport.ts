/**
 * Internal query IR — NOT public, NOT the provider wire contract.
 *
 * `ContentQueryBuilderParams` / `ContentQueryBuilderWhere` and the fluent
 * `ContentQueryBuilder` are the intermediate representation the unified query
 * grammar (`src/types/query-parts/public.ts`, the public API) lowers through on
 * its way to the `ContentQueryPlan` AST (`src/core/query/plan.ts`). They are a
 * compiler IR: fine as internal plumbing, but not part of any boundary.
 *
 * - The public query vocabulary is the unified API (`one`/`many`/`paginate`/…
 *   with `QueryWhere`/`QueryOperators`).
 * - The provider wire contract is `ContentProviderQuery`
 *   (`src/public/provider-query.ts`).
 *
 * Nothing in this file is exported from `#content/server` or `#content/client`.
 * Do not promote these through a public facade. Any future replacement must
 * preserve the public query and provider boundaries described in ADR 0016.
 */
import type { ContentQueryResponse } from '../api'
import type { ParsedContentInternalMeta, ParsedContentMeta } from '../content'
import type { ContentProviderPaging } from '../../core/query/plan'

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

export interface ContentQueryBuilderWhere extends Partial<Record<keyof ParsedContentInternalMeta, string | number | boolean | RegExp | ContentQueryBuilderWhere>> {
  $and?: ContentQueryBuilderWhere[]
  $or?: ContentQueryBuilderWhere[]
  $not?: string | number | boolean | RegExp | ContentQueryBuilderWhere
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

  [key: string]: string | number | boolean | RegExp | ContentQueryBuilderWhere | Array<string | number | boolean | ContentQueryBuilderWhere> | undefined
}

export interface ContentQueryBuilderParams {
  collection?: string
  first?: boolean
  skip?: number
  limit?: number
  only?: string[]
  without?: string[]
  sort?: ContentQuerySortOptions[]
  where?: ContentQueryBuilderWhere[] | ContentQueryBuilderWhere
  canonical?: boolean
  navigationFields?: string[]
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

  [key: string]: unknown
}

type QueryScalar = string | number | boolean
type InternalQueryKeys = Extract<keyof ParsedContentInternalMeta, `_${string}`>
export type CollectionQueryKey<T> = Extract<keyof T, string> | InternalQueryKeys
export type CollectionQueryField<T> = CollectionQueryKey<T>

export type CollectionQueryFieldValue<T, K extends CollectionQueryField<T>> =
  K extends keyof T
    ? NonNullable<T[K]>
    : K extends InternalQueryKeys
      ? NonNullable<ParsedContentInternalMeta[K]>
      : never

type EqualityValue<T> = T extends QueryScalar ? T | RegExp : T
type ComparableValue<T> = T extends string | number ? T : never
type MembershipValue<T> = T extends Array<infer U>
  ? Array<U>
  : T extends QueryScalar
    ? Array<T>
    : never
type ContainsValue<T> = T extends string
  ? string
  : T extends Array<infer U>
    ? U | Array<U>
    : never
type ContainsAnyValue<T> = T extends Array<infer U>
  ? Array<U>
  : never
type RegexValue<T> = T extends string ? RegExp | string : never
type IContainsValue<T> = T extends string ? string : never
type TypeValue = 'string' | 'number' | 'boolean' | 'object' | 'undefined'

export type CollectionQueryOperator<T> =
  | '='
  | '!='
  | 'EXISTS'
  | 'TYPE'
  | (ComparableValue<T> extends never ? never : '>' | '>=' | '<' | '<=')
  | (MembershipValue<T> extends never ? never : 'IN' | 'NOT IN')
  | (ContainsValue<T> extends never ? never : 'CONTAINS')
  | (ContainsAnyValue<T> extends never ? never : 'CONTAINS_ANY')
  | (RegexValue<T> extends never ? never : 'REGEX')
  | (IContainsValue<T> extends never ? never : 'ICONTAINS')

export type CollectionQueryValue<T, O extends CollectionQueryOperator<T>> =
  O extends '=' | '!=' ? EqualityValue<T>
    : O extends '>' | '>=' | '<' | '<=' ? ComparableValue<T>
      : O extends 'IN' | 'NOT IN' ? MembershipValue<T>
        : O extends 'CONTAINS' ? ContainsValue<T>
          : O extends 'CONTAINS_ANY' ? ContainsAnyValue<T>
            : O extends 'REGEX' ? RegexValue<T>
              : O extends 'ICONTAINS' ? IContainsValue<T>
                : O extends 'EXISTS' ? boolean | undefined
                  : O extends 'TYPE' ? TypeValue
                    : never

export type QueryOrderDirection = 'ASC' | 'DESC'

export interface QueryOrderOptions {
  locale?: string
  numeric?: boolean
  caseFirst?: ContentQuerySortParams['$caseFirst']
  sensitivity?: ContentQuerySortParams['$sensitivity']
}

export interface QueryGroupBuilder<T = ParsedContentMeta> {
  where<K extends CollectionQueryField<T>, O extends CollectionQueryOperator<CollectionQueryFieldValue<T, K>>>(
    field: K,
    operator: O,
    value?: CollectionQueryValue<CollectionQueryFieldValue<T, K>, O>
  ): QueryGroupBuilder<T>
  andWhere(groupFactory: QueryGroupFunction<T>): QueryGroupBuilder<T>
  orWhere(groupFactory: QueryGroupFunction<T>): QueryGroupBuilder<T>
}

export type QueryGroupFunction<T = ParsedContentMeta> = (group: QueryGroupBuilder<T>) => QueryGroupBuilder<T>

export interface ContentQueryBuilder<T = ParsedContentMeta> {
  where<K extends CollectionQueryField<T>, O extends CollectionQueryOperator<CollectionQueryFieldValue<T, K>>>(
    field: K,
    operator: O,
    value?: CollectionQueryValue<CollectionQueryFieldValue<T, K>, O>
  ): ContentQueryBuilder<T>
  andWhere(groupFactory: QueryGroupFunction<T>): ContentQueryBuilder<T>
  orWhere(groupFactory: QueryGroupFunction<T>): ContentQueryBuilder<T>
  select<const K extends readonly Extract<keyof T, string>[]>(...fields: K): ContentQueryBuilder<Pick<T, K[number]>>
  order<K extends CollectionQueryField<T>>(field: K, direction: QueryOrderDirection, options?: QueryOrderOptions): ContentQueryBuilder<T>
  limit(count: number): ContentQueryBuilder<T>
  skip(count: number): ContentQueryBuilder<T>
  params: () => ContentQueryBuilderParams
  locale(locale: string, options?: { fallback?: boolean | string[] }): ContentQueryBuilder<T>
  all(): Promise<Array<T>>
  first(): Promise<T | undefined>
  count(): Promise<number>
}

export interface CollectionQueryBuilder<T = ParsedContentMeta> extends ContentQueryBuilder<T> {
  select<const K extends readonly Extract<keyof T, string>[]>(...fields: K): CollectionQueryBuilder<Pick<T, K[number]>>
}

export interface ContentQueryRequest {
  params(): ContentQueryBuilderParams
}

export type ContentQueryFetcher<T> = (query: ContentQueryRequest) => Promise<ContentQueryResponse<T>>
export type QueryMatchOperator = (item: unknown, condition: unknown) => boolean
