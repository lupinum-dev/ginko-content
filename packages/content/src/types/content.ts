import type { StorageValue } from 'unstorage'
import type { JsonValue } from '../core/json-value'

type LayoutKey = string

export interface ContentSeoImage {
  src: string
  alt?: string
  width?: number
  height?: number
}

export interface ContentSeoMeta {
  title?: string
  description?: string
  image?: string | ContentSeoImage
}

/**
 * Optional file-provenance metadata. Absent for non-filesystem providers
 * (e.g. CMS-backed documents) that have no backing file.
 */
export interface ContentFileMeta {
  /**
   * Backing source name when multiple content sources are configured.
   */
  source?: string
  /**
   * Source file path relative to the content root.
   */
  path?: string
  /**
   * Path stem (the source path without its extension).
   */
  stem?: string
  /**
   * Parent directory segment of the source file.
   */
  dir?: string
  /**
   * Source file basename without extension.
   */
  basename?: string
  /**
   * Source file extension. Custom transformers may register extensions beyond
   * the built-in Markdown and structured-data formats.
   */
  extension?: string
}

/**
 * Per-request locale/reference resolution carrier.
 *
 * This is the pre-shaping route-resolution form attached by the query
 * pipeline, before the public document envelope is built.
 *
 * Not to be confused with the public `ContentDocumentResolution` envelope
 * type returned by the
 * unified query API (`one`/`many`/`resolveOne`/`surround`/`backlinks`) and
 * `useContentPage` — that is a distinct, much smaller shape. This internal
 * carrier is named `ContentResolutionCarrier` to avoid colliding with it.
 */
export interface ContentResolutionCarrier {
  /** Resolved locale after locale fallback. */
  locale?: string
  /** Requested locale before locale fallback. */
  requestedLocale?: string
  /** Whether the returned content was resolved through fallback. */
  fallback?: boolean
  /** Locales that have a concrete variant for this document. */
  availableLocales?: string[]
  /** Map of available locale code to its locale-specific path. */
  variantPaths?: Record<string, string>
  /** Requested route path before locale fallback. */
  requestedPath?: string
  /** Requested public route before locale fallback. */
  requestedRoute?: string
  /** Requested authored reference before locale fallback. */
  requestedRef?: string
  /** Resolved markdown `$ref` links for the current runtime locale. */
  resolvedRefs?: Record<string, string>
}

/**
 * Internal metadata attached to every parsed content record.
 */
export interface ParsedContentInternalMeta {
  /**
   * Stable, fully-qualified, locale-suffixed system id for the parsed record.
   * System-computed and reserved: user frontmatter `id` does not override it —
   * use `ref` for a stable authored alias.
   */
  id: string
  /**
   * Canonical content path. This is source-agnostic, so the same route can be
   * backed by local files, remote storage, or generated data.
   */
  path?: string
  /**
   * Human-readable title resolved from frontmatter or generated metadata.
   */
  title?: string
  /**
   * Human-readable summary used in listings, search, and SEO helpers.
   */
  description?: string
  /**
   * Conventional SEO frontmatter shared by pages and app templates.
   */
  seo?: ContentSeoMeta
  /**
   * Stable authored alias for internal content links.
   */
  ref?: string
  /**
   * Marks the document as a draft.
   */
  draft?: boolean
  /**
   * Marks the document as a partial that should not become a page by default.
   */
  partial?: boolean
  /**
   * Locale code for the concrete variant.
   */
  locale?: string
  /**
   * Opaque, locale-agnostic content identity join key used to resolve variants.
   * Never parse or render this as a URL — under translated slugs it is a numeric
   * identity (e.g. `1/1`), not a path.
   */
  canonicalKey?: string
  /**
   * Per-request locale/reference resolution carrier. Absent until the query
   * pipeline resolves a variant; shaping reads it to build the
   * `resolved`/`localePaths`/`variants` route envelope.
   */
  resolved?: ContentResolutionCarrier
  /**
   * Collection name, when matched by a configured collection glob.
   */
  collection?: string
  /**
   * Parsed document kind.
   */
  type?: 'markdown' | 'yaml' | 'json' | 'csv'
  /**
   * File-provenance metadata. Optional: absent for providers with no backing file.
   */
  file?: ContentFileMeta
}

/**
 * One entry in a generated table of contents.
 */
export interface TocLink {
  id: string
  text: string
  depth: number
  children?: TocLink[]
}

/**
 * Parsed table of contents generated from markdown headings.
 */
export interface Toc {
  title: string
  depth: number
  searchDepth: number
  links: TocLink[]
}

/**
 * Options object passed to a markdown plugin.
 */
export type MarkdownPluginOptions = Record<string, unknown>

export interface MarkdownHighlightPluginOptions extends MarkdownPluginOptions {
  registerDefaultLanguages?: boolean
  registerDefaultThemes?: boolean
  themes?: { light?: unknown, dark?: unknown }
  languages?: unknown[]
  transformers?: unknown[]
  preStyles?: boolean
}

export interface MarkdownTocPluginOptions extends MarkdownPluginOptions {
  title?: string
  depth?: number
  searchDepth?: number
}

/** @deprecated Use the canonical `shiki` plugin name. */
export type MarkdownDeprecatedHighlightPluginDescriptor = ['highlight', MarkdownHighlightPluginOptions]

export type MarkdownBuiltinPluginDescriptor =
  | ['shiki', MarkdownHighlightPluginOptions]
  | MarkdownDeprecatedHighlightPluginDescriptor
  | ['toc', MarkdownTocPluginOptions]
/**
 * User-authored plugin declaration in module options.
 */
export type MarkdownPluginDescriptor = string | MarkdownBuiltinPluginDescriptor | [string, MarkdownPluginOptions]
/**
 * Normalized plugin declaration after resolution.
 */
export type ResolvedMarkdownPlugin = {
  name: string
  options: MarkdownPluginOptions
}

/**
 * Object-shaped markdown AST node.
 */
export interface MarkdownNode {
  type: string
  tag?: string
  value?: string
  props?: Record<string, unknown>
  content?: unknown
  children?: MarkdownNode[]

  attributes?: Record<string, unknown>
  fmAttributes?: Record<string, unknown>
}

/**
 * Root node for the object-based markdown AST.
 */
export interface MarkdownRoot {
  type: 'root'
  children: MarkdownNode[]
  props?: Record<string, any>
  toc?: Toc
}

/**
 * Resolved markdown runtime options.
 */
export interface MarkdownOptions {
  plugins: ResolvedMarkdownPlugin[]
  tags: Record<string, string>
  anchorLinks: {
    depth: number
    exclude: number[]
  }
  image?: 'auto' | 'img' | 'nuxt-image'
}

/**
 * Flexible parsed content shape that allows user-defined frontmatter fields.
 */
export interface ParsedContentMeta extends ParsedContentInternalMeta {
  /**
   * Preferred layout key for page rendering.
   */
  layout?: LayoutKey

  [key: string]: unknown
}

/**
 * Sentinel returned by content loaders for a source id that produced no
 * servable document — an ignored file, a missing source body, or an
 * unsupported extension. It carries only the id and a `null` body; the
 * `missing` flag is the discriminant separating it from a real
 * {@link ParsedContent}. Use the shared `isRealDocument` guard
 * (`core/content/document`) to filter these out.
 */
export interface MissingDocument {
  id: string
  body: null
  missing: true
}

/**
 * Strict parsed content shape with no open-ended index signature.
 */
export interface StrictParsedContentMeta extends ParsedContentInternalMeta {
  /**
   * Preferred layout key for page rendering.
   */
  layout?: LayoutKey
}

/**
 * Parsed content document including the rendered body payload.
 */
export type ParsedContentBody = MarkdownRoot | JsonValue | null

export interface ParsedContent extends ParsedContentMeta {
  /**
   * Optional excerpt payload.
   */
  excerpt?: MarkdownRoot
  /**
   * Parsed body payload. `null` means the source had no renderable body.
   */
  body: ParsedContentBody
}

/**
 * Strict parsed content document including the rendered body payload.
 */
export interface StrictParsedContent extends StrictParsedContentMeta {
  /**
   * Optional excerpt payload.
   */
  excerpt?: MarkdownRoot
  /**
   * Parsed body payload. `null` means the source had no renderable body.
   */
  body: ParsedContentBody
}

/**
 * Specialized parsed content shape for markdown sources.
 */
export interface MarkdownParsedContent extends ParsedContent {
  type: 'markdown',
  /**
   * Description resolved from frontmatter or excerpt generation.
   */
  description: string
  /**
   * Object AST excerpt generated from the markdown body.
   */
  excerpt?: MarkdownRoot
  /**
   * Parsed Markdown body with included table of contents.
   */
  body: MarkdownRoot & {
    toc?: Toc
  }
}

/**
 * Transformer hook used during ingestion.
 */
export interface ContentTransformer {
  /**
   * Stable transformer name used in logs and generated manifests.
   */
  name: string
  /**
   * File extensions handled by the transformer.
   */
  extensions: string[]
  /**
   * Optional parse hook that turns raw source content into a parsed document.
   */
  parse?(id: string, content: StorageValue, options: unknown): Promise<ParsedContent> | ParsedContent
  /**
   * Optional post-parse hook that mutates or enriches a parsed document.
   */
  transform?(content: ParsedContent, options: unknown): Promise<ParsedContent> | ParsedContent
}

/**
 * Ingestion options passed to the transform pipeline.
 */
export interface TransformContentOptions {
  transformers?: ContentTransformer[]

  [key: string]: unknown
}

/**
 * Navigation node returned by content navigation helpers.
 */
export interface NavItem {
  title: string
  /**
   * Nuxt Content compatible route path used by Nuxt UI content components.
   */
  path?: string
  stem?: string
  page?: false
  id?: string
  canonicalKey?: string
  locale?: string
  fallback?: boolean
  draft?: boolean
  children?: NavItem[]

  [key: string]: unknown
}

/**
 * Public alias for navigation items returned by query helpers.
 */
export type ContentNavigationItem = NavItem

// Ensure that a .js file is emitted too
export {}
