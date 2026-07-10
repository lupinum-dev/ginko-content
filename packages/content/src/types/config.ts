import { z, type ZodType } from 'zod'
import { CONTENT_REFERENCE_PREFIX } from './reference'

/**
 * Internal type-machinery symbols used to carry phantom schema/i18n
 * information on `ContentCollectionHandle` for conditional-type inference.
 *
 * These are exported only because TypeScript's declaration-emit mechanics
 * require importable symbol identity across files/packages for `unique
 * symbol`-keyed properties to be structurally comparable. They are not
 * documented application API, carry no runtime property on collection
 * handles, and must not be read directly by application code.
 *
 * @internal
 */
export const __ginkoSchemaBrand: unique symbol = Symbol('ginko-content:schema')
/** @internal */
export const __ginkoI18nBrand: unique symbol = Symbol('ginko-content:i18n')

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
  searchable?: boolean
  sortable?: boolean
  defaultValue?: unknown
  validation?: Record<string, unknown> | null
  options?: string[] | null
  relation?: ContentCmsRelationConfig | null
  fields?: Record<string, ContentCmsFieldConfig> | ContentCmsFieldConfig[] | null
  min?: number | null
  max?: number | null
  step?: number | null
  slugFrom?: string | null
  language?: string | null
  /**
   * Opaque editor-layout passthrough. ginko-content does not type or interpret
   * this bag; it stores and forwards it byte-for-byte through `buildCmsContract`
   * to the CMS field contract. Pure layout policy (field width, display order,
   * hidden state, conditional visibility, etc.) belongs here — its schema is
   * owned entirely by the consuming CMS (e.g. `@lupinum/ginko-cms`).
   */
  editor?: Record<string, unknown>
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

export const agentMetadataFields = [
  'title',
  'description',
  'url',
  'route',
  'locale',
  'section',
  'collection',
  'source',
  'updated'
] as const

export type AgentMetadataField = typeof agentMetadataFields[number]

export type AgentMetadataFieldList = readonly AgentMetadataField[]

/*
 * Keep agent metadata intentionally small for now. These built-ins are fields
 * Ginko can compute for every agent page. Schema-derived fields, custom
 * resolvers, and fluent builders are useful future options, but they need real
 * use cases because this frontmatter is public AI-facing output.
 */
export function defineAgentMetadataFields<const TFields extends AgentMetadataFieldList> (fields: TFields): TFields {
  return fields
}

export interface ContentAgentMarkdownOptions {
  includeInIndex?: boolean
  includeInFull?: boolean
  metadata?: AgentMetadataFieldList
}

export interface ContentAgentCollectionConfig {
  section?: string
  markdown?: boolean | ContentAgentMarkdownOptions
}

export type ContentAgentLocalizedValue = string | Record<string, string>

export interface ContentAgentSiteConfig {
  title: ContentAgentLocalizedValue
  description: ContentAgentLocalizedValue
  url?: string
  defaultLocale?: string
  locales?: string[]
  profile?: string
  contentSignals?: {
    search?: boolean
    aiInput?: boolean
    aiTrain?: boolean
  }
}

export interface ContentAgentMarkdownMetadataConfig {
  enabled?: boolean
  defaultFields?: AgentMetadataFieldList
}

export interface ContentAgentMarkdownPolicyConfig {
  metadata?: boolean | AgentMetadataFieldList | ContentAgentMarkdownMetadataConfig
}

export interface ContentAgentSectionConfig {
  id: string
  title: ContentAgentLocalizedValue
  order?: number
}

export interface ContentAgentAppPageContext {
  locale: string
  defaultLocale?: string
  siteUrl: string
}

export interface ContentAgentAppPageConfig {
  id: string
  route: ContentAgentLocalizedValue
  section: string
  title: ContentAgentLocalizedValue | ((ctx: ContentAgentAppPageContext) => string | Promise<string>)
  description: ContentAgentLocalizedValue | ((ctx: ContentAgentAppPageContext) => string | Promise<string>)
  updated?: string
  includeInIndex?: boolean
  includeInFull?: boolean
  metadata?: AgentMetadataFieldList
  render: (ctx: ContentAgentAppPageContext) => string | Promise<string>
}

export interface ContentAgentConfig {
  site?: ContentAgentSiteConfig
  markdown?: ContentAgentMarkdownPolicyConfig
  sections?: ContentAgentSectionConfig[]
  pages?: ContentAgentAppPageConfig[]
}

export interface ContentAgentRuntimeAppPageConfig
  extends Omit<ContentAgentAppPageConfig, 'title' | 'description' | 'render'> {
  title: ContentAgentLocalizedValue
  description: ContentAgentLocalizedValue
  markdown: ContentAgentLocalizedValue
  render?: ContentAgentAppPageConfig['render']
}

export interface ContentAgentRuntimeConfig extends Omit<ContentAgentConfig, 'pages'> {
  pages?: ContentAgentRuntimeAppPageConfig[]
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
   * Agent-facing collection exposure. Collections declare only whether pages
   * produce normalized markdown and which agent section they belong to. Root
   * `agent` config owns site policy; the Ginko module owns route plumbing.
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
   * Agent-facing site map and markdown output. Ginko owns the repetitive
   * `/llms.txt`, raw markdown, and static route plumbing; apps provide site
   * facts and app-owned page renderers here.
   */
  agent?: ContentAgentConfig
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
 * (`one`, `many`, `useContentPage`, ...) can require `locale` only when the
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
   * Carried under a private symbol key: it does not exist as a readable
   * runtime property, so `Object.keys()`/`JSON.stringify()`/spreads never
   * surface it. Use type-level narrowing (e.g. `DocumentFromHandle`) rather
   * than reading this key directly.
   *
   * @internal
   */
  readonly [__ginkoI18nBrand]: TI18n
  /**
   * Phantom marker — Zod schema bound at definition time. Used to infer the
   * returned document shape at query time.
   *
   * Carried under a private symbol key; see `__i18n` brand above for the
   * same no-runtime-property guarantee.
   *
   * @internal
   */
  readonly [__ginkoSchemaBrand]: TSchema
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
    ? Omit<TCollection, 'name' | typeof __ginkoSchemaBrand | typeof __ginkoI18nBrand> & ContentCollectionHandle<
      [Name] extends [never] ? Key : Name,
      TSchema,
      TI18n
    >
    : TCollection extends ContentCollectionConfig<infer TSchema>
    ? Omit<TCollection, 'name' | typeof __ginkoSchemaBrand | typeof __ginkoI18nBrand> & ContentCollectionHandle<
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

export function defineAgentSection<const TConfig extends ContentAgentSectionConfig> (config: TConfig): TConfig {
  return config
}

export function defineAgentAppPage<const TConfig extends ContentAgentAppPageConfig> (config: TConfig): TConfig {
  return config
}

export function defineAgentMarkdownPolicy<const TConfig extends ContentAgentMarkdownPolicyConfig> (config: TConfig): TConfig {
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
