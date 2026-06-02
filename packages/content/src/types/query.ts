import type { ContentQueryResponse } from './api'
import type { ContentCollectionHandle } from './config'
import type { ContentNavigationItem, ParsedContent, ParsedContentInternalMeta, ParsedContentMeta, StrictParsedContent, StrictParsedContentMeta } from './content'
/**
 * Query
 */

export interface ContentQuerySortParams {
  /**
   * Locale specifier for sorting
   * A string with a BCP 47 language tag
   *
   * @default undefined
   */
  $locale?: string
  /**
   * Whether numeric collation should be used, such that "1" < "2" < "10".
   * Possible values are `true` and `false`;
   *
   * @default false
   */
  $numeric?: boolean
  /**
   * Whether upper case or lower case should sort first.
   * Possible values are `"upper"`, `"lower"`, or `"false"`
   *
   * @default "depends on locale"
   */
  $caseFirst?: 'upper' | 'lower' | 'false'
  /**
   * Which differences in the strings should lead to non-zero result values. Possible values are:
   *  - "base": Only strings that differ in base letters compare as unequal. Examples: a ≠ b, a = á, a = A.
   *  - "accent": Only strings that differ in base letters or accents and other diacritic marks compare as unequal. Examples: a ≠ b, a ≠ á, a = A.
   *  - "case": Only strings that differ in base letters or case compare as unequal. Examples: a ≠ b, a = á, a ≠ A.
   *  - "variant": Strings that differ in base letters, accents and other diacritic marks, or case compare as unequal. Other differences may also be taken into consideration. Examples: a ≠ b, a ≠ á, a ≠ A.
   *
   * @default "variant"
   */
  $sensitivity?: 'base' | 'accent' | 'case' | 'variant'
}

export interface ContentQuerySortFields {
  [field: string]: -1 | 1
}

export type ContentQuerySortOptions = ContentQuerySortParams | ContentQuerySortFields

/**
 * @internal
 */
export interface ContentQueryBuilderWhere extends Partial<Record<keyof ParsedContentInternalMeta, string | number | boolean | RegExp | ContentQueryBuilderWhere>> {
  /**
   * Match only if all nested conditions are true.
   **/
  $and?: ContentQueryBuilderWhere[]
  /**
   * Match if any nested condition is true.
   **/
  $or?: ContentQueryBuilderWhere[]
  /**
   * Match when the nested condition is false.
   **/
  $not?: string | number | boolean | RegExp | ContentQueryBuilderWhere
  /**
   * Match if item equals condition.
   **/
  $eq?: string | number | boolean | RegExp
  /**
   * Match if item does not equal condition.
   **/
  $ne?: string | number | boolean | RegExp
  /**
   * Check if item is greater than condition.
   */
  $gt?: number | string
  /**
   * Check if item is greater than or equal to condition.
   */
  $gte?: number | string
  /**
   * Check if item is less than condition.
   */
  $lt?: number | string
  /**
   * Check if item is less than or equal to condition.
   */
  $lte?: number | string
  /**
   * Provides regular expression capabilities for pattern matching strings.
   */
  $regex?: RegExp | string
  /**
   * Match when a string field starts with the given prefix.
   */
  $prefix?: string
  /**
   * Match if type of item equals condition.
   */
  $type?: string
  /**
   * Check key existence.
   */
  $exists?: boolean
  /**
   * Match if item contains every condition or every rule in the condition array.
   **/
  $contains?: Array<string | number | boolean> | string | number | boolean
  /**
   * Match if item contains at least one rule from the condition array.
   */
  $containsAny?: Array<string | number | boolean>
  /**
   * Ignore case when checking string containment.
   **/
  $icontains?: string
  /**
   * Match if item is in condition array.
   **/
  $in?: Array<string | number | boolean>

  [key: string]: string | number | boolean | RegExp | ContentQueryBuilderWhere | Array<string | number | boolean | ContentQueryBuilderWhere> | undefined
}

/**
 * @internal
 */
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

  [key: string]: unknown
}

type QueryScalar = string | number | boolean | Date
type InternalQueryKeys = Extract<keyof ParsedContentInternalMeta, `_${string}`>
type CollectionQueryKey<T> = Extract<keyof T, string> | InternalQueryKeys
type CollectionQueryField<T> = CollectionQueryKey<T>

type CollectionQueryFieldValue<T, K extends CollectionQueryField<T>> =
  K extends keyof T
    ? NonNullable<T[K]>
    : K extends InternalQueryKeys
      ? NonNullable<ParsedContentInternalMeta[K]>
      : never

type EqualityValue<T> = T extends QueryScalar ? T | RegExp : T
type ComparableValue<T> = T extends string | number | Date ? T : never
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
  /**
   * BCP 47 locale passed to `Intl.Collator` for string ordering.
   */
  locale?: string
  /**
   * Enable numeric ordering so `"2"` sorts before `"10"`.
   */
  numeric?: boolean
  /**
   * Control whether upper- or lower-case letters sort first.
   */
  caseFirst?: ContentQuerySortParams['$caseFirst']
  /**
   * Collation sensitivity used by string comparison.
   */
  sensitivity?: ContentQuerySortParams['$sensitivity']
}

/**
 * Builder passed to grouped `andWhere` / `orWhere` callbacks.
 */
export interface QueryGroupBuilder<T = ParsedContentMeta> {
  where<K extends CollectionQueryField<T>, O extends CollectionQueryOperator<CollectionQueryFieldValue<T, K>>>(
    field: K,
    operator: O,
    value?: CollectionQueryValue<CollectionQueryFieldValue<T, K>, O>
  ): QueryGroupBuilder<T>
  andWhere(groupFactory: QueryGroupFunction<T>): QueryGroupBuilder<T>
  orWhere(groupFactory: QueryGroupFunction<T>): QueryGroupBuilder<T>
}

/**
 * Factory used to build grouped nested conditions.
 */
export type QueryGroupFunction<T = ParsedContentMeta> = (group: QueryGroupBuilder<T>) => QueryGroupBuilder<T>

/**
 * Options for locale-aware navigation queries.
 */
export interface ContentCollectionNavigationOptions<TField extends string = string> {
  /**
   * Extra document fields to merge onto each returned navigation item.
   */
  fields?: TField[]
  /**
   * Locale to resolve against for translated collections.
   */
  locale?: string
  /**
   * When `true`, keep canonical paths instead of locale-prefixed paths.
   */
  canonical?: boolean
}

/**
 * Options for previous/next navigation helpers.
 */
export type ContentCollectionItemSurroundingsOptions<TField extends string = string> = ContentCollectionNavigationOptions<TField>

/**
 * Options for extracting searchable sections from collection pages.
 */
export interface ContentCollectionSearchSectionsOptions {
  /**
   * Tags ignored while flattening page content into search text.
   */
  ignoredTags?: string[]
  /**
   * Extra top-level fields copied from each page onto every emitted section.
   */
  extraFields?: string[]
  /**
   * Query predicate applied before extracting searchable sections.
   */
  filterQuery?: ContentQueryBuilderWhere
  /**
   * Lowest heading level that starts a new section.
   */
  minHeading?: `h${1 | 2 | 3 | 4 | 5 | 6}`
  /**
   * Highest heading level that starts a new section.
   */
  maxHeading?: `h${1 | 2 | 3 | 4 | 5 | 6}`
  /**
   * Locale to resolve against for translated collections.
   */
  locale?: string
  /**
   * When `true`, keep canonical paths instead of locale-prefixed paths.
   */
  canonical?: boolean
}

/**
 * Options for locale-aware page resolution.
 */
export interface ContentCollectionPageOptions {
  /**
   * Preferred locale to resolve.
   */
  locale?: string
  /**
   * Enable or customize locale fallback resolution.
   *
   * Pass `true` to use configured fallbacks, or an explicit locale list to
   * override the configured chain for this query.
   */
  fallback?: string[] | boolean
  /**
   * When `true`, keep canonical paths in the returned route metadata.
   */
  canonical?: boolean
}

/**
 * Options for route metadata resolution without loading full page content.
 */
export interface ContentCollectionRouteMetaOptions {
  /**
   * Preferred locale to resolve.
   */
  locale?: string
  /**
   * Enable or customize locale fallback resolution.
   */
  fallback?: string[] | boolean
}

/**
 * Options for resolving an authored reference value into a document.
 */
export interface ResolveContentReferenceOptions {
  /**
   * Preferred locale to resolve.
   */
  locale?: string
  /**
   * Enable or customize locale fallback resolution.
   */
  fallback?: string[] | boolean
  /**
   * When `true`, require an exact locale match and skip fallback lookup.
   */
  exact?: boolean
  /**
   * Restrict resolution to a single collection.
   */
  collection?: string
}

/**
 * Locale variant entry returned by the internal locale-variant endpoint.
 */
export interface ContentLocaleEntry {
  /**
   * Stable locale-agnostic identity shared by every translated variant.
   */
  canonicalKey: string
  /**
   * Locale code for the matching variant.
   */
  locale: string
  /**
   * Resolved route path for the variant, when the variant is routable.
   */
  path?: string
}

/**
 * Route metadata for a single locale variant of a page.
 */
export interface ContentLocaleRoute {
  locale: string
  path: string
  canonicalPath: string
}

/**
 * One entry in the per-locale path map attached to a localized document.
 *
 * `translated` is `true` when a concrete variant exists in that locale, `false`
 * when the resolver fell back to another locale's path. `fallback` names the
 * locale that supplied the path when `translated` is false.
 */
export interface LocalePathEntry {
  /**
   * Locale-prefixed route path (the URL the user navigates to).
   */
  path: string
  /**
   * `true` when this locale has its own variant; `false` when the path was
   * supplied by a fallback locale.
   */
  translated: boolean
  /**
   * Locale that backed this entry when `translated` is `false`.
   */
  fallback?: string
}

/**
 * Public resolution metadata attached to localized content results.
 *
 * Internal `_requestedLocale`, `_resolvedLocale`, and `_fallback` fields remain
 * storage/query implementation details. UI code should read this object.
 */
export interface ContentResolvedMeta {
  /**
   * Locale of the concrete content variant that backed this result.
   */
  locale: string
  /**
   * Locale requested by the caller, when locale resolution was part of the
   * query.
   */
  requestedLocale?: string
  /**
   * `true` when the concrete content variant came from a different locale than
   * the requested locale.
   */
  fallback: boolean
  /**
   * Locale that supplied the content when `fallback` is true.
   */
  fallbackLocale?: string
  /**
   * Public route path returned to the user.
   */
  path: string
  /**
   * Requested route path before locale fallback, when known.
   */
  requestedPath?: string
  /**
   * Requested public route before locale fallback, when known.
   */
  requestedRoute?: string
  /**
   * Requested authored ref before locale fallback, when known.
   */
  requestedRef?: string
  /**
   * Locales that have concrete variants for this content identity.
   */
  availableLocales: string[]
}

/**
 * Locale-aware routing metadata attached to route-backed page payloads.
 */
export interface ContentRouteMeta {
  locale: string
  defaultLocale: string
  path: string
  canonicalPath: string
  variants: ContentLocaleRoute[]
  /**
   * Map of every configured locale to its localized path. Includes a
   * `translated` flag and a `fallback` source when a locale has no variant.
   */
  localePaths: Record<string, LocalePathEntry>
  /**
   * Public explanation of the locale/path resolution used for this result.
   */
  resolved: ContentResolvedMeta
}

/**
 * Full page payload returned by route-aware unified query helpers and internal route helpers.
 */
export type ContentPageResult<T = ParsedContentMeta> = T & ContentRouteMeta & {
  /**
   * Locale-agnostic path stem derived from the source file.
   */
  stem: string
  /**
   * Source file extension when it can be inferred.
   */
  extension?: string
}

/**
 * Alternate locale entry used in sitemap output.
 */
export interface ContentSitemapAlternative {
  hreflang: string
  href: string
}

/**
 * Sitemap image entry discovered from page content or metadata.
 */
export interface ContentSitemapImage {
  loc: string
}

/**
 * Sitemap entry produced by `queryCollectionsSitemapEntries`.
 */
export interface ContentSitemapEntry {
  loc: string
  _sitemap?: string
  lastmod?: string
  alternatives?: ContentSitemapAlternative[]
  images?: ContentSitemapImage[]
}

/**
 * Searchable document section produced by the internal search-section builder.
 */
export interface ContentSearchSection {
  /**
   * Stable section id, usually the page path or path plus anchor hash.
   */
  id: string
  /**
   * Heading or page title for the section.
   */
  title: string
  /**
   * Ancestor heading trail leading to this section.
   */
  titles: string[]
  /**
   * Heading depth that opened the section.
   */
  level: number
  /**
   * Flattened text content used by the search index.
   */
  content: string

  [key: string]: unknown
}

export interface ContentQueryBuilder<T = ParsedContentMeta> {
  /**
   * Filter results with an explicit field/operator/value clause.
   */
  where<K extends CollectionQueryField<T>, O extends CollectionQueryOperator<CollectionQueryFieldValue<T, K>>>(
    field: K,
    operator: O,
    value?: CollectionQueryValue<CollectionQueryFieldValue<T, K>, O>
  ): ContentQueryBuilder<T>

  /**
   * Add a grouped AND clause.
   */
  andWhere(groupFactory: QueryGroupFunction<T>): ContentQueryBuilder<T>

  /**
   * Add a grouped OR clause.
   */
  orWhere(groupFactory: QueryGroupFunction<T>): ContentQueryBuilder<T>

  /**
   * Select a subset of fields.
   */
  select<const K extends readonly Extract<keyof T, string>[]>(...fields: K): ContentQueryBuilder<Pick<T, K[number]>>

  /**
   * Order the result set by a field.
   */
  order<K extends CollectionQueryField<T>>(field: K, direction: QueryOrderDirection, options?: QueryOrderOptions): ContentQueryBuilder<T>

  /**
   * Limit number of results.
   */
  limit(count: number): ContentQueryBuilder<T>

  /**
   * Skip number of results.
   */
  skip(count: number): ContentQueryBuilder<T>

  /**
   * Retrieve query builder params.
   * @internal
   */
  params: () => ContentQueryBuilderParams

  /**
   * Filter contents based on locale.
   */
  locale(locale: string, options?: { fallback?: boolean | string[] }): ContentQueryBuilder<T>

  /**
   * Fetch list of contents.
   */
  all(): Promise<Array<T>>

  /**
   * Fetch the first matched content.
   */
  first(): Promise<T | undefined>

  /**
   * Count matched contents.
   */
  count(): Promise<number>
}

export interface CollectionQueryBuilder<T = ParsedContentMeta> extends ContentQueryBuilder<T> {
  select<const K extends readonly Extract<keyof T, string>[]>(...fields: K): CollectionQueryBuilder<Pick<T, K[number]>>
}

/**
 * Minimal request shape consumed by the query transport.
 */
export interface ContentQueryRequest {
  params(): ContentQueryBuilderParams
}

/**
 * Internal transport used by the immutable query builder.
 */
export type ContentQueryFetcher<T> = (query: ContentQueryRequest) => Promise<ContentQueryResponse<T>>
export type QueryMatchOperator = (item: unknown, condition: unknown) => boolean

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- extended by generated module augmentation
export interface ContentCollectionMap {}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- extended by generated module augmentation
export interface ContentCollectionI18nMap {}

export type ContentCollectionName = keyof ContentCollectionMap & string
export type ContentCollectionItem<K extends ContentCollectionName> = ContentCollectionMap[K]

/**
 * ============================================================================
 *  Unified Query API — public surface (ADR-0016)
 * ============================================================================
 *
 * The types below back the unified query API exposed via `one`, `many`,
 * `resolveOne`, `variants`, `tree`, `neighbors` and their `useContent*`
 * composable mirrors. The public vocabulary is deliberately split:
 *
 *   - `by` identifies exactly one document by route path or authored ref.
 *   - `where` filters a result set by document fields.
 *   - `resolveOne` returns diagnostics; `one` is the ergonomic doc-only view.
 */

/**
 * MongoDB-style operator object applied to a single field. Mirrors the subset
 * of `ContentQueryBuilderWhere` operators that are safe for public use.
 *
 * @template TValue Concrete field value type (used to narrow operator operands).
 */
export interface QueryOperators<TValue = unknown> {
  $eq?: TValue
  $ne?: TValue
  $gt?: TValue
  $gte?: TValue
  $lt?: TValue
  $lte?: TValue
  $in?: TValue[]
  $nin?: TValue[]
  $exists?: boolean
  $contains?: TValue | TValue[]
  $containsAny?: TValue[]
  $icontains?: string
  $type?: 'string' | 'number' | 'boolean' | 'object' | 'undefined'
  $prefix?: TValue extends string ? string : never
  $not?: TValue | QueryOperators<TValue>
}

/**
 * Identify exactly one document. `path` is stored content `_path`, `route` is
 * public app URL, and `ref` is authored stable identity. They are mutually
 * exclusive at the type level.
 */
export type ContentSelector =
  | { path: string, route?: never, ref?: never }
  | { route: string, path?: never, ref?: never }
  | { ref: string, path?: never, route?: never }

type WhereValue<T> = T | QueryOperators<T>
type PathWhere = string | QueryOperators<string>

/**
 * MongoDB-style filter object generic on the document shape. `where.path` is a
 * documented route-path filter and compiles to the internal `_path` field.
 */
export type QueryWhere<T = ParsedContentMeta> = {
  path?: PathWhere
  $and?: QueryWhere<T>[]
  $or?: QueryWhere<T>[]
  $not?: QueryWhere<T>
} & {
  [K in Exclude<keyof T, 'path'>]?: WhereValue<NonNullable<T[K]>>
}

/**
 * Sort spec: `asc` / `desc` are preferred; `1` / `-1` remain accepted because
 * they map directly to the transport shape.
 */
export type SortDirection = 'asc' | 'desc' | 1 | -1
export type SortSpec<T = ParsedContentMeta> = string extends keyof T
  ? { [key: string]: SortDirection | undefined }
  : { [K in keyof T]?: SortDirection }

/**
 * Schema of a collection handle (recovered from its `__schema` phantom).
 *
 * Uses `StrictParsedContentMeta` (no `[key: string]: unknown` index signature)
 * as the base so `keyof HandleSchema<H>` is a finite union of the user's
 * declared schema fields plus the internal `_*` meta fields. This is what
 * makes `QueryWhere<HandleSchema<H>>` reject typo'd field names at compile time.
 */
type HandleSchema<H> = H extends { __schema: infer S }
  ? S extends { _output: infer O }
    ? O & StrictParsedContentMeta
    : StrictParsedContentMeta
  : StrictParsedContentMeta

type SelectFields<H> = H extends string
  ? ReadonlyArray<string>
  : ReadonlyArray<Extract<keyof HandleSchema<H>, string>>

/**
 * Runtime document shape inferred from a collection handle.
 */
export type DocumentFromHandle<H> = H extends { __schema: { _output: infer O } }
  ? O & StrictParsedContent
  : ParsedContent

/**
 * Explicit reference population map. Keys are fields on the source document;
 * values are target collection handles.
 */
export type PopulateSpec = Record<string, ContentCollectionHandle | string>

export type PopulatedDocument<T, P> =
  P extends undefined
    ? T
    : P extends PopulateSpec
      ? string extends keyof P
        ? T
        : Omit<T, keyof P> & {
        [K in keyof P & keyof T]: T[K] extends ReadonlyArray<unknown>
          ? Array<LocalizedDoc<DocumentFromHandle<P[K]>>>
          : LocalizedDoc<DocumentFromHandle<P[K]>> | null
      }
      : T

export type PopulateFromOptions<O> = O extends { populate?: infer P }
  ? P
  : undefined

type PopulateOption<P extends PopulateSpec | undefined = undefined> = {
  populate?: P
}

/**
 * Whether a collection handle declares i18n at the type level.
 */
type HandleIsI18n<H> = H extends { __i18n: infer I }
  ? I extends true ? true : false
  : false

/**
 * Locale option made required when the handle is i18n.
 */
type LocaleOption<H, OptKey extends string = 'locale'> = HandleIsI18n<H> extends true
  ? { [K in OptKey]: string }
  : { [K in OptKey]?: string }

type SourceIsI18n<S> = S extends ReadonlyArray<infer I>
  ? true extends HandleIsI18n<I> ? true : false
  : HandleIsI18n<S>

type BacklinksLocaleOption<Target, Source> = HandleIsI18n<Target> extends true
  ? { locale: string }
  : SourceIsI18n<Source> extends true
    ? { locale: string }
    : { locale?: string }

export type LocaleFallback = false | true | 'default' | string | string[]

/**
 * Document shape returned from `one`, `many` and `resolveOne`. Every doc carries the
 * route metadata (`path`, `localePaths`, `locale`, ...) the route resolver
 * already produces, so locale switching needs no extra round trip.
 */
export type LocalizedDoc<T = ParsedContentMeta> = T & ContentRouteMeta & {
  /**
   * Locale-agnostic path stem derived from the source file.
   */
  stem?: string
  /**
   * Source file extension when it can be inferred.
   */
  extension?: string
}

/**
 * Explain how `resolveOne` interpreted the request and what it matched.
 */
export interface ResolutionEnvelope {
  requested: {
    collection: string
    by: ContentSelector
    locale?: string
    fallback?: LocaleFallback
  }
  normalized: {
    by: ContentSelector
  }
  matched: {
    found: boolean
    collection: string
    path?: string
    canonicalPath?: string
    ref?: string
    locale?: string
  }
  fallback: {
    used: boolean
    locale?: string
  }
}

/**
 * Result returned by `resolveOne`.
 */
export interface ResolveOneResult<T = ParsedContentMeta> {
  doc: LocalizedDoc<T> | null
  explain: ResolutionEnvelope
}

/**
 * Options accepted by `resolveOne(handle, options)` and `one(handle, options)`.
 */
export type ResolveOneOptions<
  H = unknown,
  P extends PopulateSpec | undefined = undefined
> = {
  by: ContentSelector
  fallback?: LocaleFallback
  select?: SelectFields<H>
} & LocaleOption<H> & PopulateOption<P>

export type OneOptions<
  H = unknown,
  P extends PopulateSpec | undefined = undefined
> = ResolveOneOptions<H, P>
/**
 * Options accepted by `many(handle, options)`.
 */
export type ManyOptions<
  H = unknown,
  P extends PopulateSpec | undefined = undefined
> = {
  where?: QueryWhere<HandleSchema<H>>
  sort?: SortSpec<HandleSchema<H>>
  limit?: number
  skip?: number
  fallback?: LocaleFallback
  select?: SelectFields<H>
} & LocaleOption<H> & PopulateOption<P>

/**
 * Options accepted by `paginate(handle, options)`.
 */
export type PaginationOptions<
  H = unknown,
  P extends PopulateSpec | undefined = undefined
> = Omit<ManyOptions<H, P>, 'skip' | 'limit'> & {
  /**
   * One-based page number.
   *
   * @default 1
   */
  page?: number
  /**
   * Number of documents per page.
   *
   * @default 10
   */
  limit?: number
}

/**
 * Result returned by `paginate()` and `useContentPagination()`.
 */
export interface PaginationResult<T = ParsedContentMeta> {
  data: Array<LocalizedDoc<T>>
  page: number
  limit: number
  total: number
  pageCount: number
  hasNext: boolean
  hasPrev: boolean
  nextPage: number | null
  prevPage: number | null
}

export type BacklinkSource = ContentCollectionHandle | string

type SourceName<S> = S extends string
  ? S
  : S extends { name: infer N }
    ? Extract<N, string>
    : string

export type BacklinkFields<S = BacklinkSource | ReadonlyArray<BacklinkSource>> =
  | ReadonlyArray<string>
  | Partial<Record<SourceName<S extends ReadonlyArray<infer I> ? I : S>, ReadonlyArray<string>>>

type DocumentFromSource<S> = S extends ReadonlyArray<infer I>
  ? DocumentFromHandle<I>
  : DocumentFromHandle<S>

/**
 * Options accepted by `backlinks(targetHandle, options)`.
 */
export type BacklinksOptions<
  Target = unknown,
  Source extends BacklinkSource | ReadonlyArray<BacklinkSource> = BacklinkSource | ReadonlyArray<BacklinkSource>,
  P extends PopulateSpec | undefined = undefined
> = {
  /**
   * Target document to find incoming references for.
   */
  by: ContentSelector
  /**
   * Source collection handle(s) to scan for references.
   */
  from: Source
  /**
   * Explicit reference fields on the source collection(s). When omitted,
   * fields are inferred from source handles that use `reference()`.
   */
  fields?: BacklinkFields<Source>
  sort?: SortSpec<DocumentFromSource<Source>>
  limit?: number
  skip?: number
  fallback?: LocaleFallback
  select?: Source extends string
    ? ReadonlyArray<string>
    : ReadonlyArray<Extract<keyof DocumentFromSource<Source>, string>>
} & BacklinksLocaleOption<Target, Source> & PopulateOption<P>

export type BacklinksResult<
  Source extends BacklinkSource | ReadonlyArray<BacklinkSource> = BacklinkSource | ReadonlyArray<BacklinkSource>,
  P extends PopulateSpec | undefined = undefined
> = Array<LocalizedDoc<PopulatedDocument<DocumentFromSource<Source>, P>>>

/**
 * Options accepted by `variants(handle, options)`.
 */
export type VariantsOptions<H = unknown> = {
  by: ContentSelector
  /**
   * Restrict to a subset of locales. Defaults to all configured locales.
   */
  locales?: string[]
} & LocaleOption<H>

/**
 * Variant entry returned by `variants()` and `useContentVariants()`.
 */
export interface ContentVariant<_T = ParsedContentMeta> {
  locale: string
  path: string
  translated: boolean
  fallback?: string
}

/**
 * Options accepted by `tree(handle, options)`.
 */
export type TreeOptions<
  H = unknown,
  Fields extends ReadonlyArray<keyof HandleSchema<H> | string> | undefined = undefined
> = {
  where?: QueryWhere<HandleSchema<H>>
  sort?: SortSpec<HandleSchema<H>>
  fields?: Fields
  fallback?: LocaleFallback
} & LocaleOption<H>

/**
 * Typed navigation item. Requested `fields` are preserved in the return type
 * without keeping the old open index signature.
 */
export type ContentTreeItem<
  T = ParsedContentMeta,
  Fields extends ReadonlyArray<keyof T | string> | undefined = undefined
> = {
  title: string
  path: string
  _path?: string
  children?: Array<ContentTreeItem<T, Fields>>
} & (Fields extends ReadonlyArray<infer K>
  ? Pick<T, Extract<K, keyof T>>
  : Record<never, never>)

// Re-export the navigation type so callers can import it from the unified
// query module without reaching into `types/content`.
export type { ContentNavigationItem }

/**
 * Options accepted by `neighbors(handle, options)`.
 *
 * Identifying the anchor document lives in `filter`, same as every other
 * verb. Only the reserved selectors `path` and `ref` are accepted.
 */
export type NeighborsOptions<H = unknown> = {
  by: ContentSelector
  fallback?: LocaleFallback
  fields?: SelectFields<H>
} & LocaleOption<H>

/**
 * Result of `neighbors()` and `useContentNeighbors()`.
 */
export interface NeighborsResult<T = ParsedContentMeta> {
  prev: ContentTreeItem<T> | null
  next: ContentTreeItem<T> | null
}

// Ensure that a .js file is emitted too
export {}
