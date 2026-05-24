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
}

export type ContentCollectionKind = 'page' | 'data'

export type BuiltinContentProviderName = 'filesystem' | 'cms' | 'ginko-cms' | 'ginko'
export type ContentProviderName = BuiltinContentProviderName | (string & {})

export type DefineCollectionOptions<TSchema extends ZodType | undefined = ZodType | undefined> =
  Omit<ContentCollectionConfig<TSchema>, 'source' | 'exclude'>

export interface DefineCollectionObject<TSchema extends ZodType | undefined = ZodType | undefined>
  extends DefineCollectionOptions<TSchema> {
  /**
   * Nuxt Content v3-compatible collection kind. Ginko does not keep separate
   * page/data collection runtimes; `data` collections default to `sitemap: false`.
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
   * Content backing implementation. `filesystem` is the default. `cms`,
   * `ginko-cms`, and `ginko` resolve to the official Ginko CMS provider when
   * `@lupinum/ginko-cms` is installed.
   */
  provider?: ContentProviderName
  /**
   * External provider modules keyed by provider name. Built-in providers do not
   * need to be registered here.
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

/**
 * Define a content collection in `content.config.ts`.
 *
 * @example
 * ```ts
 * import { z } from 'zod'
 * import { defineCollection } from '@lupinum/ginko-content/config'
 *
 * export const docs = defineCollection('docs', {
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
  const Name extends string,
  const TConfig extends DefineCollectionObject<ZodType | undefined>
> (
  name: Name,
  config: TConfig
): ContentCollectionHandle<Name, SchemaOf<TConfig>, IsI18nConfig<TConfig>> {
  const { type, source, sitemap, ...rest } = config
  const normalized = normalizeCollectionSource(source)

  return {
    name,
    ...normalized,
    sitemap: sitemap ?? (type === 'data' ? false : undefined),
    ...rest
  } as unknown as ContentCollectionHandle<Name, SchemaOf<TConfig>, IsI18nConfig<TConfig>>
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

/**
 * Wrap the root content configuration with full type inference.
 *
 * @example
 * ```ts
 * import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'
 *
 * export default defineContentConfig({
 *   collections: {
 *     docs: defineCollection({
 *       type: 'page',
 *       source: 'docs/*.md'
 *     })
 *   }
 * })
 * ```
 */
export function defineContentConfig<TCollections extends Record<string, ContentCollectionConfig>> (config: ContentConfig<TCollections>): ContentConfig<TCollections> {
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
 * import { defineCollection, reference } from '@lupinum/ginko-content/config'
 *
 * export default defineCollection({
 *   type: 'page',
 *   source: 'blog/*.md',
 *   schema: z.object({
 *     author: reference('authors'),
 *     related: z.array(reference('blog')).default([])
 *   })
 * })
 * ```
 */
export function reference (collection?: string): ContentReferenceSchema {
  return z.string().describe(`${CONTENT_REFERENCE_PREFIX}${collection || ''}`) as ContentReferenceSchema
}
