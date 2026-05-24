import type { StorageValue } from 'unstorage'

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
 * Internal metadata attached to every parsed content record.
 */
export interface ParsedContentInternalMeta {
  /**
   * Stable unique id for the parsed source record.
   */
  _id: string
  /**
   * Backing source name when multiple content sources are configured.
   */
  _source?: string
  /**
   * Canonical content path. This is source-agnostic, so the same route can be
   * backed by local files, remote storage, or generated data.
   */
  _path?: string
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
  _draft?: boolean
  /**
   * Marks the document as a partial that should not become a page by default.
   */
  _partial?: boolean
  /**
   * Locale code for the concrete variant.
   */
  _locale?: string
  /**
   * Locale-agnostic content identity used to resolve variants.
   */
  _canonicalKey?: string
  /**
   * Requested route path before locale fallback.
   */
  _requestedPath?: string
  /**
   * Requested public route before locale fallback.
   */
  _requestedRoute?: string
  /**
   * Requested authored reference before locale fallback.
   */
  _requestedRef?: string
  /**
   * Requested locale before locale fallback.
   */
  _requestedLocale?: string
  /**
   * Resolved locale after locale fallback.
   */
  _resolvedLocale?: string
  /**
   * Whether the returned content was resolved through fallback.
   */
  _fallback?: boolean
  /**
   * Locales that have a concrete variant for this document.
   */
  _availableLocales?: string[]
  /**
   * Map of available locale code to its locale-specific path.
   */
  _variantPaths?: Record<string, string>
  /**
   * Resolved markdown `$ref` links for the current runtime locale.
   */
  _resolvedRefs?: Record<string, string>
  /**
   * Collection name, when matched by a configured collection glob.
   */
  _collection?: string
  /**
   * Marks folder-scoped navigation metadata documents.
   */
  _navigation?: boolean
  /**
   * Parsed document kind.
   */
  _type?: 'markdown' | 'yaml' | 'json' | 'csv'
  /**
   * Source file path relative to the content root.
   */
  _file?: string
  /**
   * Source file extension.
   */
  _extension?: 'md' | 'yaml' | 'yml' | 'json' | 'json5' | 'csv'
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
/**
 * User-authored plugin declaration in module options.
 */
export type MarkdownPluginDescriptor = string | [string, MarkdownPluginOptions]
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
export interface ParsedContent extends ParsedContentMeta {
  /**
   * Optional excerpt payload.
   */
  excerpt?: MarkdownRoot
  /**
   * Parsed body payload. `null` means the source had no renderable body.
   */
  body: MarkdownRoot | null
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
  body: MarkdownRoot | null
}

/**
 * Specialized parsed content shape for markdown sources.
 */
export interface MarkdownParsedContent extends ParsedContent {
  _type: 'markdown',
  /**
   * Whether the markdown source rendered no meaningful body content.
   */
  _empty: boolean
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
  path: string
  /**
   * Canonical content route without locale prefix.
   */
  _path: string
  stem?: string
  page?: false
  _id?: string
  _canonicalKey?: string
  _locale?: string
  _fallback?: boolean
  _draft?: boolean
  children?: NavItem[]

  [key: string]: unknown
}

/**
 * Public alias for navigation items returned by query helpers.
 */
export type ContentNavigationItem = NavItem

// Ensure that a .js file is emitted too
export {}
