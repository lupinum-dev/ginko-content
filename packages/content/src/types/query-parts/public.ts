import type { ContentNavigationItem, ParsedContent, ParsedContentMeta, StrictParsedContent, StrictParsedContentMeta } from '../content'
import type { __ginkoI18nBrand, __ginkoSchemaBrand } from '../config'
import type { SharedNavigationMetadata } from '../navigation'
import type { ContentCollectionI18nMap, ContentCollectionMap, ContentCollectionName, ContentCollectionTarget } from './collections'
import type { ContentDocumentResolution, ContentDocumentRoute } from './results'

export const CONTENT_QUERY_TYPE_VALUES = [
  'string',
  'number',
  'boolean',
  'object',
  'undefined'
] as const

export type ContentQueryType = typeof CONTENT_QUERY_TYPE_VALUES[number]

type QueryElement<TValue> = TValue extends readonly (infer TElement)[] ? TElement : TValue

export interface QueryOperators<TValue = unknown> {
  $eq?: TValue
  $ne?: TValue
  $gt?: TValue
  $gte?: TValue
  $lt?: TValue
  $lte?: TValue
  $in?: readonly QueryElement<TValue>[]
  $nin?: readonly QueryElement<TValue>[]
  $exists?: boolean
  $contains?: QueryElement<TValue> | readonly QueryElement<TValue>[]
  $containsAny?: readonly QueryElement<TValue>[]
  $icontains?: string
  $type?: ContentQueryType
  $prefix?: TValue extends string ? string : never
}

export type ContentSelector =
  | { path: string, route?: never, ref?: never }
  | { route: string, path?: never, ref?: never }
  | { ref: string, path?: never, route?: never }

type WhereValue<T> = T | QueryOperators<T>
type PathWhere = string | QueryOperators<string>

export type QueryWhere<T = ParsedContentMeta> = {
  path?: PathWhere
  $and?: readonly QueryWhere<T>[]
  $or?: readonly QueryWhere<T>[]
  $not?: QueryWhere<T>
} & {
  [K in Exclude<keyof T, 'path'>]?: WhereValue<NonNullable<T[K]>>
}

export type SortDirection = 'asc' | 'desc'
export type SortSpec<T = ParsedContentMeta> = string extends keyof T
  ? { [key: string]: SortDirection | undefined }
  : { [K in keyof T]?: SortDirection }

type HandleSchema<H> = H extends { [__ginkoSchemaBrand]: infer S }
  ? S extends { _output: infer O }
    ? O & StrictParsedContentMeta
    : StrictParsedContentMeta
  : H extends ContentCollectionName
    ? ContentCollectionMap[H] & StrictParsedContentMeta
  : StrictParsedContentMeta

type SelectFields<H> = string extends H
  ? ReadonlyArray<string>
  : ReadonlyArray<Extract<keyof HandleSchema<H>, string>>

export type DocumentFromHandle<H> = H extends { [__ginkoSchemaBrand]: { _output: infer O } }
  ? O & StrictParsedContent
  : H extends ContentCollectionName
    ? ContentCollectionMap[H]
  : ParsedContent

export type PopulateSpec = Record<string, ContentCollectionTarget>

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

type HandleIsI18n<H> = H extends { [__ginkoI18nBrand]: infer I }
  ? I extends true ? true : false
  : H extends keyof ContentCollectionI18nMap
    ? true
  : false

type LocaleOption<H, OptKey extends string = 'locale'> = HandleIsI18n<H> extends true
  ? { [K in OptKey]: string }
  : { [K in OptKey]?: string }

/**
 * Argument tuple for verbs whose options parameter is optional for
 * non-localized collections (`many`, `navigation`).
 *
 * For i18n handles the options object is REQUIRED (its type already requires
 * `locale` via `LocaleOption`) — a defaulted `options = {}` parameter would
 * otherwise silently satisfy the locale obligation and reopen the i18n hole.
 * For non-i18n handles the options object stays optional.
 */
export type OptionsArg<H, O> = HandleIsI18n<H> extends true
  ? [options: O]
  : [options?: O]

type SourceIsI18n<S> = S extends ReadonlyArray<infer I>
  ? true extends HandleIsI18n<I> ? true : false
  : HandleIsI18n<S>

type BacklinksLocaleOption<Target, Source> = HandleIsI18n<Target> extends true
  ? { locale: string }
  : SourceIsI18n<Source> extends true
    ? { locale: string }
    : { locale?: string }

export type LocaleFallback = boolean | 'default' | readonly string[]

/**
 * The canonical document envelope attached to every document
 * returned by the unified query API (`one`/`many`/`resolveOne().doc`/
 * `surround`/`backlinks`) and by `useContentPage`. `locale` is a convenience
 * top-level copy of `resolution.resolved.locale`; the route/resolution facts
 * themselves live only under `route`/`resolution` — there is no top-level
 * `path`, `variants`, `localePaths`, or `resolved` shape.
 */
export type LocalizedContentDocument<T = ParsedContentMeta> = Omit<T, 'path' | 'resolved'> & {
  locale: string
  route: ContentDocumentRoute
  resolution: ContentDocumentResolution
  stem?: string
  extension?: string
  /** Resolved markdown `$ref` links for the current runtime locale (consumed by `ContentRendererMarkdown`). */
  resolvedRefs?: Record<string, string>
}

export type LocalizedDoc<T = ParsedContentMeta> = LocalizedContentDocument<T>

/**
 * Keys the runtime selection projector always preserves regardless of `select`
 *: identity, plus the `route`/`resolution`
 * envelope. Identity fields survive because `selectWithPopulate` force-keeps
 * them; `route`/`resolution` (and the `stem`/`extension`/`resolvedRefs`
 * bookkeeping fields) are guaranteed by the public query-response boundary.
 * The type promises exactly the runtime survivors —
 * no more, no less.
 */
type IdentityGuaranteedKeys = 'id' | 'collection' | 'canonicalKey' | 'file'
export type GuaranteedDocumentKeys = IdentityGuaranteedKeys | 'route' | 'resolution' | 'stem' | 'extension' | 'resolvedRefs'

/** Selected key union pulled from the caller's own options object, else `never`. */
type SelectedKeys<O> = O extends { select: ReadonlyArray<infer K> } ? Extract<K, string> : never

/** Populated field names pulled from the caller's own options object, else `never`. */
type PopulatedKeys<O> = O extends { populate: infer P }
  ? P extends PopulateSpec
    ? string extends keyof P ? never : Extract<keyof P, string>
    : never
  : never

/**
 * The one reusable selected-document helper. It projects the
 * raw pre-localized document so `LocalizedDoc` can re-attach the guaranteed
 * route/resolution envelope afterwards — mirroring the runtime order
 * (project → decorate). Without `select` the full document passes through; with
 * a const `select` only selected + populated + guaranteed identity keys survive,
 * exactly as the runtime projector keeps them.
 */
export type SelectedInnerDocument<Inner, O> =
  [SelectedKeys<O>] extends [never]
    ? Inner
    : string extends SelectedKeys<O>
      ? Inner
      : Pick<Inner, Extract<SelectedKeys<O> | PopulatedKeys<O> | IdentityGuaranteedKeys, keyof Inner>>

/**
 * Final selection-aware document returned by `one`/`many`/`resolveOne().doc`.
 * `LocalizedDoc` re-adds the guaranteed route/resolution envelope on top of the
 * projected inner document.
 */
export type QueryResultDocument<H, O> =
  LocalizedDoc<SelectedInnerDocument<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>, O>>

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
    ref?: string
    locale?: string
  }
  fallback: {
    used: boolean
    locale?: string
  }
}

export interface ResolveOneResult<T = ParsedContentMeta> {
  doc: LocalizedDoc<T> | null
  explain: ResolutionEnvelope
}

/** Internal composition used by the emitted query-function declarations. */
export type ResolveOneResultFor<H, O> = ResolveOneResult<
  SelectedInnerDocument<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>, O>
>

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
 * Two honest pagination modes: `offset` returns an exact
 * total/page count; `cursor` returns an opaque forward cursor with no
 * synthetic total. Omitting `mode` while supplying `page` means
 * `mode: 'offset'` (source compatibility) — new code should write the mode
 * explicitly.
 */
export type PaginationMode = 'offset' | 'cursor'

type PaginationCommonOptions<
  H,
  P extends PopulateSpec | undefined
> = Omit<ManyOptions<H, P>, 'skip' | 'limit'> & {
  limit?: number
}

export type PaginationOptions<
  H = unknown,
  P extends PopulateSpec | undefined = undefined
> = PaginationCommonOptions<H, P> & (
  | {
      mode?: 'offset'
      /** Offset-mode page number. */
      page?: number
      after?: never
    }
  | {
      mode: 'cursor'
      page?: never
      /** Opaque cursor from a previous `CursorPaginationResult.endCursor`. */
      after?: string | null
    }
)

export interface OffsetPaginationResult<T = ParsedContentMeta> {
  mode: 'offset'
  data: Array<LocalizedDoc<T>>
  page: number
  limit: number
  total: number
  pageCount: number
  hasNext: boolean
  hasPrevious: boolean
  nextPage: number | null
  previousPage: number | null
}

export interface CursorPaginationResult<T = ParsedContentMeta> {
  mode: 'cursor'
  data: Array<LocalizedDoc<T>>
  limit: number
  endCursor: string | null
  hasNext: boolean
}

export type PaginationResult<T = ParsedContentMeta> = OffsetPaginationResult<T> | CursorPaginationResult<T>

/**
 * Narrow `paginate()`'s return type to the exact discriminant when the
 * caller's own options object literally names `mode: 'cursor'` — otherwise
 * (mode omitted, or explicitly `'offset'`) resolve to the offset shape,
 * matching the runtime source-compatibility default.
 */
export type PaginationResultFor<O, Inner> = O extends { mode: 'cursor' }
  ? CursorPaginationResult<SelectedInnerDocument<Inner, O>>
  : OffsetPaginationResult<SelectedInnerDocument<Inner, O>>

export type BacklinkSource = ContentCollectionTarget

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

export type BacklinksOptions<
  Target = unknown,
  Source extends BacklinkSource | ReadonlyArray<BacklinkSource> = BacklinkSource | ReadonlyArray<BacklinkSource>,
  P extends PopulateSpec | undefined = undefined
> = {
  by: ContentSelector
  from: Source
  /** Relation field(s) used to traverse back to the target (per-source map or a shared field list). */
  via?: BacklinkFields<Source>
  sort?: SortSpec<DocumentFromSource<Source>>
  limit?: number
  skip?: number
  fallback?: LocaleFallback
  select?: string extends Source
    ? ReadonlyArray<string>
    : ReadonlyArray<Extract<keyof DocumentFromSource<Source>, string>>
} & BacklinksLocaleOption<Target, Source> & PopulateOption<P>

export type BacklinksResult<
  Source extends BacklinkSource | ReadonlyArray<BacklinkSource> = BacklinkSource | ReadonlyArray<BacklinkSource>,
  P extends PopulateSpec | undefined = undefined
> = Array<LocalizedDoc<PopulatedDocument<DocumentFromSource<Source>, P>>>

export type { ContentNavigationItem }

/** Options for the public `navigation()` verb. */
export type NavigationOptions<
  H = unknown,
  Select extends ReadonlyArray<keyof HandleSchema<H> | string> | undefined = undefined
> = {
  where?: QueryWhere<HandleSchema<H>>
  sort?: SortSpec<HandleSchema<H>>
  select?: Select
  fallback?: LocaleFallback
} & LocaleOption<H>

/** Navigation tree node returned by `navigation()`. Group/control nodes may omit a route; linkable nodes carry one. */
export type ContentNavigationTreeItem<
  T = ParsedContentMeta,
  Select extends ReadonlyArray<keyof T | string> | undefined = undefined
> = {
  title: string
  path?: string
  children?: Array<ContentNavigationTreeItem<T, Select>>
} & SharedNavigationMetadata & (Select extends ReadonlyArray<infer K>
  ? Pick<T, Extract<K, keyof T>>
  : Record<never, never>)

/** A route-bearing navigation page, narrowed from a possibly structural tree node. */
export type ResolvedContentNavigationItem<
  T = ParsedContentMeta,
  Select extends ReadonlyArray<keyof T | string> | undefined = undefined
> = ContentNavigationTreeItem<T, Select> & {
  path: string
}

/** Options for the public `surround()` verb. */
export type SurroundOptions<H = unknown> = {
  by: ContentSelector
  fallback?: LocaleFallback
  select?: SelectFields<H>
} & LocaleOption<H>

/** Result of the public `surround()` verb — `previous`, never `prev`. */
export interface SurroundResult<T = ParsedContentMeta> {
  previous: ResolvedContentNavigationItem<T> | null
  next: ResolvedContentNavigationItem<T> | null
}
