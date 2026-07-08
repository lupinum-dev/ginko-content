import type { ContentNavigationItem, ParsedContent, ParsedContentMeta, StrictParsedContent, StrictParsedContentMeta } from '../content'
import type { ContentCollectionI18nMap, ContentCollectionMap, ContentCollectionName, ContentCollectionTarget } from './collections'
import type { ContentRouteMeta, LocalePathEntry } from './results'

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

export type ContentSelector =
  | { path: string, route?: never, ref?: never }
  | { route: string, path?: never, ref?: never }
  | { ref: string, path?: never, route?: never }

type WhereValue<T> = T | QueryOperators<T>
type PathWhere = string | QueryOperators<string>

export type QueryWhere<T = ParsedContentMeta> = {
  path?: PathWhere
  $and?: QueryWhere<T>[]
  $or?: QueryWhere<T>[]
  $not?: QueryWhere<T>
} & {
  [K in Exclude<keyof T, 'path'>]?: WhereValue<NonNullable<T[K]>>
}

export type SortDirection = 'asc' | 'desc' | 1 | -1
export type SortSpec<T = ParsedContentMeta> = string extends keyof T
  ? { [key: string]: SortDirection | undefined }
  : { [K in keyof T]?: SortDirection }

type HandleSchema<H> = H extends { __schema: infer S }
  ? S extends { _output: infer O }
    ? O & StrictParsedContentMeta
    : StrictParsedContentMeta
  : H extends ContentCollectionName
    ? ContentCollectionMap[H] & StrictParsedContentMeta
  : StrictParsedContentMeta

type SelectFields<H> = string extends H
  ? ReadonlyArray<string>
  : ReadonlyArray<Extract<keyof HandleSchema<H>, string>>

export type DocumentFromHandle<H> = H extends { __schema: { _output: infer O } }
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

type HandleIsI18n<H> = H extends { __i18n: infer I }
  ? I extends true ? true : false
  : H extends keyof ContentCollectionI18nMap
    ? true
  : false

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

export type LocalizedContentDocument<T = ParsedContentMeta> = T & ContentRouteMeta & {
  locale: string
  path: string
  canonicalPath: string
  localePaths: Record<string, LocalePathEntry>
  stem?: string
  extension?: string
}

export type LocalizedDoc<T = ParsedContentMeta> = LocalizedContentDocument<T>

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

export interface ResolveOneResult<T = ParsedContentMeta> {
  doc: LocalizedDoc<T> | null
  explain: ResolutionEnvelope
}

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

export type PaginationOptions<
  H = unknown,
  P extends PopulateSpec | undefined = undefined
> = Omit<ManyOptions<H, P>, 'skip' | 'limit'> & {
  page?: number
  limit?: number
}

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
  fields?: BacklinkFields<Source>
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

export type VariantsOptions<H = unknown> = {
  by: ContentSelector
  locales?: string[]
} & LocaleOption<H>

export interface ContentVariant<_T = ParsedContentMeta> {
  locale: string
  path: string
  translated: boolean
  fallback?: string
}

export type TreeOptions<
  H = unknown,
  Fields extends ReadonlyArray<keyof HandleSchema<H> | string> | undefined = undefined
> = {
  where?: QueryWhere<HandleSchema<H>>
  sort?: SortSpec<HandleSchema<H>>
  fields?: Fields
  fallback?: LocaleFallback
  locale?: string
}

export type ContentTreeItem<
  T = ParsedContentMeta,
  Fields extends ReadonlyArray<keyof T | string> | undefined = undefined
> = {
  title: string
  path: string
  children?: Array<ContentTreeItem<T, Fields>>
} & (Fields extends ReadonlyArray<infer K>
  ? Pick<T, Extract<K, keyof T>>
  : Record<never, never>)

export type { ContentNavigationItem }

export type NeighborsOptions<H = unknown> = {
  by: ContentSelector
  fallback?: LocaleFallback
  fields?: SelectFields<H>
} & LocaleOption<H>

export interface NeighborsResult<T = ParsedContentMeta> {
  prev: ContentTreeItem<T> | null
  next: ContentTreeItem<T> | null
}
