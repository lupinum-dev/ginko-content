import { z, type ZodType } from 'zod'
import { CONTENT_REFERENCE_PREFIX } from './reference'

/**
 * Locale settings for a collection that ships translated variants.
 */
export interface ContentCollectionI18nConfig {
  /**
   * Locale treated as the canonical variant when no locale is specified.
   */
  defaultLocale: string
  /**
   * Every locale code that can produce a concrete variant for the collection.
   */
  locales: string[]
}

export type ContentCollectionSource = string | string[]

/**
 * Public route mount for route-backed collections.
 *
 * A single string applies to every locale. A locale map lets translated apps
 * express roots such as `{ en: '/docs', de: '/dokumentation' }`.
 */
export type ContentCollectionRouteConfig = string | Record<string, string>
export type ContentCollectionKind = 'page' | 'data'

export type ContentCmsFieldType =
  | 'text'
  | 'textarea'
  | 'richtext'
  | 'slug'
  | 'email'
  | 'url'
  | 'number'
  | 'range'
  | 'select'
  | 'multiselect'
  | 'radio'
  | 'checkbox'
  | 'toggle'
  | 'date'
  | 'datetime'
  | 'time'
  | 'json'
  | 'object'
  | 'array'
  | 'blocks'
  | 'relation'
  | 'relations'
  | 'image'
  | 'images'
  | 'file'
  | 'icon'
  | 'code'
  | 'color'
  | 'divider'
  | 'section'

export interface ContentCmsRelationConfig {
  collectionId: string
  multiple?: boolean
}

export interface ContentCmsFieldConfig {
  type?: ContentCmsFieldType
  label?: string | Record<string, string> | null
  description?: string | null
  required?: boolean
  localized?: boolean
  hidden?: boolean
  searchable?: boolean
  sortable?: boolean
  order?: number
  width?: 'full' | 'half'
  defaultValue?: unknown
  validation?: Record<string, unknown> | null
  condition?: Record<string, unknown> | null
  options?: string[] | null
  relation?: ContentCmsRelationConfig | null
  fields?: Record<string, ContentCmsFieldConfig> | ContentCmsFieldConfig[] | null
  min?: number | null
  max?: number | null
  step?: number | null
  slugFrom?: string | null
  language?: string | null
}

export interface ContentCmsCollectionConfig {
  label?: string | Record<string, string>
  type?: 'flat' | 'tree'
  icon?: string
  route?: {
    mode?: 'route' | 'none'
    pathPrefix?: string
    slugMode?: 'shared' | 'localized' | 'stable' | 'localizedStable'
    rootSlug?: string | null
    singleton?: boolean
  }
  fields?: Record<string, ContentCmsFieldConfig>
  settings?: unknown
}

export interface ContentAgentMarkdownOptions {
  includeInIndex?: boolean
  includeInFull?: boolean
}

export interface ContentAgentCollectionConfig {
  markdown?: boolean | ContentAgentMarkdownOptions
}

/**
 * Object source shape accepted for Nuxt Content v3 migration.
 */
export interface ContentCollectionSourceObject {
  /**
   * Source glob or globs included in the collection.
   */
  include: ContentCollectionSource
  /**
   * Source glob or globs excluded from the collection.
   */
  exclude?: ContentCollectionSource
}

/**
 * Declarative collection definition used by `content.config.ts`.
 */
export interface ContentCollectionConfig<TSchema extends ZodType | undefined = ZodType | undefined> {
  /**
   * Collection kind declared in `defineCollection`. Page collections are public
   * content routes by default; data collections are app-owned records.
   */
  type?: ContentCollectionKind
  /**
   * Source glob or source descriptor understood by the filesystem ingestion
   * layer. CMS-backed projects do not need a runtime source; filesystem
   * imports/seeding should be modeled by provider-owned import tooling.
   */
  source?: ContentCollectionSource
  /**
   * Source glob or globs excluded from this collection.
   */
  exclude?: ContentCollectionSource
  /**
   * Optional Zod schema applied to every parsed entry in the collection.
   */
  schema?: TSchema
  /**
   * When `true`, reject documents with frontmatter fields not declared in `schema`.
   */
  strict?: boolean
  /**
   * Per-collection locale settings. Use `true` to inherit the module-level i18n config.
   */
  i18n?: true | ContentCollectionI18nConfig
  /**
   * Public route mount for this collection. Used to resolve `by.route`
   * selectors and to emit requested-locale URLs for fallback content.
   */
  route?: ContentCollectionRouteConfig
  /**
   * Opt-in to fully translated path segments per locale (ADR-0008). When `true`,
   * the content graph pairs locale variants by numeric prefix on filenames so
   * each locale can carry its own slug text, e.g. `1.guide/` ↔ `1.documentation/`.
   *
   * @default false
   */
  translatedSlugs?: boolean
  /**
   * Include this collection in content-owned sitemap output and prerender route
   * discovery. Route-backed collections are included by default; data-only or
   * app-internal collections should opt out with `false`.
   *
   * @default true
   */
  sitemap?: boolean
  /**
   * Optional CMS editor metadata for providers such as `@lupinum/ginko-cms`.
   *
   * The content collection remains the source of truth; this metadata only
   * fills editor-specific gaps that cannot be inferred safely from route,
   * source, i18n, and schema information.
   */
  cms?: ContentCmsCollectionConfig
  /**
   * Agent-facing content exposure. This is intentionally narrow: Ginko only
   * decides whether a content page can expose normalized markdown and how to
   * resolve that markdown. Site policy, llms.txt curation, routes, and headers
   * remain app-owned.
   */
  agent?: ContentAgentCollectionConfig
}

export type ContentProviderName = 'filesystem' | (string & {})

export type DefineCollectionOptions<TSchema extends ZodType | undefined = ZodType | undefined> =
  Omit<ContentCollectionConfig<TSchema>, 'source' | 'exclude'>

export interface DefineCollectionObject<TSchema extends ZodType | undefined = ZodType | undefined>
  extends DefineCollectionOptions<TSchema> {
  /**
   * Nuxt Content v3-compatible collection kind. Ginko does not keep separate
   * page/data query builders, but the kind remains canonical metadata at runtime.
   * `data` collections default to `sitemap: false`.
   */
  type: ContentCollectionKind
  /**
   * Source glob, globs, or v3-compatible `{ include, exclude }` object.
   * Required for filesystem-backed collections; optional for CMS-backed
   * collections.
   */
  source?: ContentCollectionSource | ContentCollectionSourceObject
}

/**
 * Root object returned from `defineContentConfig`.
 */
export interface ContentConfig<TCollections extends Record<string, ContentCollectionConfig> = Record<string, ContentCollectionConfig>> {
  /**
   * Content backing implementation. `filesystem` is the default. Provider
   * modules can register named implementations, for example `cms`.
   */
  provider?: ContentProviderName
  /**
   * External provider modules keyed by provider name. First-party provider
   * modules register themselves, so app configs usually do not need this.
   */
  providers?: Record<string, string>
  /**
   * Named content collections keyed by the identifier used at query time.
   */
  collections?: TCollections
}

/**
 * Infer the runtime data shape for a collection from its Zod schema.
 */
export type CollectionSchema<TCollection> =
  TCollection extends { schema?: infer TSchema }
    ? TSchema extends ZodType
      ? z.infer<TSchema>
      : Record<string, unknown>
    : Record<string, unknown>

/**
 * Zod string schema tagged as a Nuxt Content reference field.
 */
export interface ContentReferenceSchema extends z.ZodString {
  /**
   * Serialized descriptor in the form `__nuxt_content_ref__:<collection>`.
   */
  description: string
}

/**
 * Typed handle returned by `defineCollection`. Carries the collection's name
 * and i18n discriminator at the type level so the unified query API
 * (`one`, `many`, `useContentOne`, ...) can require `locale` only when the
 * collection is internationalized.
 *
 * The handle extends `ContentCollectionConfig` so it can be stored directly
 * in `defineContentConfig({ collections: ... })`.
 */
export interface ContentCollectionHandle<
  Name extends string = string,
  TSchema extends ZodType | undefined = ZodType | undefined,
  TI18n extends boolean = boolean
> extends ContentCollectionConfig<TSchema> {
  /**
   * Stable identifier used at query time, e.g. `'docs'` or `'blog'`.
   */
  readonly name: Name
  /**
   * Phantom flag — `true` when the collection ships translated variants.
   * Used by the type system to make `locale` required on i18n queries.
   *
   * @internal
   */
  readonly __i18n: TI18n
  /**
   * Phantom marker — Zod schema bound at definition time. Used to infer the
   * returned document shape at query time.
   *
   * @internal
   */
  readonly __schema: TSchema
}

type IsI18nConfig<TConfig> = TConfig extends { i18n: true | ContentCollectionI18nConfig }
  ? TConfig['i18n'] extends false ? false : true
  : false

type CollectionNameFromConfigKey<Key extends string, TCollection> =
  TCollection extends ContentCollectionHandle<infer Name, ZodType | undefined, boolean>
    ? [Name] extends [never] ? Key : Name
    : Key

type NamedContentCollection<Key extends string, TCollection> =
  TCollection extends ContentCollectionHandle<infer Name, infer TSchema, infer TI18n>
    ? Omit<TCollection, 'name' | '__schema' | '__i18n'> & ContentCollectionHandle<
      [Name] extends [never] ? Key : Name,
      TSchema,
      TI18n
    >
    : TCollection extends ContentCollectionConfig<infer TSchema>
    ? Omit<TCollection, 'name' | '__schema' | '__i18n'> & ContentCollectionHandle<
      CollectionNameFromConfigKey<Key, TCollection>,
      TSchema,
      IsI18nConfig<TCollection>
    >
    : TCollection

type NamedContentCollections<TCollections extends Record<string, ContentCollectionConfig>> = {
  [Key in keyof TCollections]: Key extends string
    ? NamedContentCollection<Key, TCollections[Key]>
    : TCollections[Key]
}

type NamedContentConfig<TCollections extends Record<string, ContentCollectionConfig>> =
  Omit<ContentConfig<TCollections>, 'collections'> & {
    collections: NamedContentCollections<TCollections>
  }

/**
 * Define a content collection in `content.config.ts`.
 *
 * @example
 * ```ts
 * import { z } from 'zod'
 * import { defineCollection } from '@lupinum/ginko-content/config'
 *
 * export const docs = defineCollection({
 *   type: 'page',
 *   source: 'docs/**\/*.md',
 *   i18n: { locales: ['en', 'fr', 'de'], defaultLocale: 'en' },
 *   schema: z.object({
 *     title: z.string(),
 *     published: z.boolean().default(true)
 *   })
 * })
 * ```
 */
type SchemaOf<TConfig> = TConfig extends { schema?: infer S } ? S extends ZodType ? S : undefined : undefined

export function defineCollection<
  const TConfig extends DefineCollectionObject<ZodType | undefined>
> (
  config: TConfig
): ContentCollectionHandle<never, SchemaOf<TConfig>, IsI18nConfig<TConfig>>
export function defineCollection<
  const TConfig extends DefineCollectionObject<ZodType | undefined>
> (
  config: TConfig
): ContentCollectionHandle<never, SchemaOf<TConfig>, IsI18nConfig<TConfig>> {
  if (typeof config === 'string' || arguments.length > 1) {
    throw new TypeError('@lupinum/ginko-content defineCollection(name, config) was removed. Use defineCollection({ ... }) under the desired defineContentConfig({ collections: { docs: ... } }) map key.')
  }

  const { type, source, sitemap, ...rest } = config
  const normalized = normalizeCollectionSource(source)

  return {
    type,
    ...normalized,
    sitemap: sitemap ?? (type === 'data' ? false : undefined),
    ...rest
  } as unknown as ContentCollectionHandle<never, SchemaOf<TConfig>, IsI18nConfig<TConfig>>
}

function normalizeCollectionSource (source: ContentCollectionSource | ContentCollectionSourceObject | undefined): Partial<Pick<ContentCollectionConfig, 'source' | 'exclude'>> {
  if (source === undefined) return {}

  if (typeof source === 'object' && !Array.isArray(source)) {
    return {
      source: source.include,
      ...(source.exclude ? { exclude: source.exclude } : {})
    }
  }

  return { source }
}

export function normalizeContentConfigCollectionNames<TCollections extends Record<string, ContentCollectionConfig>> (
  collections: TCollections
): NamedContentCollections<TCollections> {
  for (const [key, collection] of Object.entries(collections)) {
    const authoredName = (collection as { name?: unknown }).name
    if (typeof authoredName === 'string') {
      if (authoredName !== key) {
        throw new Error(`@lupinum/ginko-content collection key "${key}" must match collection name "${authoredName}". Use defineCollection({ ... }) under collections: { ${key}: ... }, or rename the collections map key.`)
      }
      continue
    }

    Object.defineProperty(collection, 'name', {
      value: key,
      enumerable: true,
      configurable: true,
      writable: true
    })
  }

  return collections as unknown as NamedContentCollections<TCollections>
}

/**
 * Wrap the root content configuration with full type inference.
 *
 * @example
 * ```ts
 * import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'
 *
 * export const docs = defineCollection({
 *   type: 'page',
 *   source: 'docs/*.md'
 * })
 *
 * export default defineContentConfig({
 *   collections: { docs }
 * })
 * ```
 */
export function defineContentConfig<const TCollections extends Record<string, ContentCollectionConfig>> (
  config: Omit<ContentConfig<TCollections>, 'collections'> & { collections: TCollections }
): NamedContentConfig<TCollections>
export function defineContentConfig<const TConfig extends ContentConfig<Record<string, ContentCollectionConfig>>> (config: TConfig): TConfig
export function defineContentConfig (config: ContentConfig): ContentConfig {
  if (config.collections) {
    normalizeContentConfigCollectionNames(config.collections)
  }

  return config
}

/**
 * Declare a schema field that stores a reference to another content entry.
 *
 * Use the optional `collection` argument when the field must target a single
 * collection. Omit it to allow references across collections.
 *
 * @example
 * ```ts
 * import { z } from 'zod'
 * import { defineCollection, defineContentConfig, reference } from '@lupinum/ginko-content/config'
 *
 * export const blog = defineCollection({
 *   type: 'page',
 *   source: 'blog/*.md',
 *   schema: z.object({
 *     author: reference('authors'),
 *     related: z.array(reference('blog')).default([])
 *   })
 * })
 *
 * export default defineContentConfig({
 *   collections: { blog }
 * })
 * ```
 */
export function reference (collection?: string): ContentReferenceSchema {
  return z.string().describe(`${CONTENT_REFERENCE_PREFIX}${collection || ''}`) as ContentReferenceSchema
}
