import type { StorageValue } from 'unstorage'
import type { ParsedContent, ContentTransformer, MarkdownOptions } from './content'
import type { ContentCollectionConfig } from './config'
import type { ContentContext, ModuleOptions } from './module'

export interface ContentCacheArtifact<T = ParsedContent> {
  parsed: T
  hash: string
}

export interface ManifestVariant {
  canonicalKey: string
  contentId: string
  locale: string
  path?: string
}

export interface ContentManifest {
  /** Exact `{ collection → canonical key → locale → variant }` identity index. */
  byCollectionCanonical: Record<string, Record<string, Record<string, ManifestVariant>>>
  /** Unambiguous canonical keys only. Derived from `byCollectionCanonical`. */
  byCanonical: Record<string, Record<string, ManifestVariant>>
  /** Exact `{ collection → ref → canonical key }` alias index. */
  byCollectionRef: Record<string, Record<string, string>>
  /** Unambiguous refs only. Derived from `byCollectionRef`. */
  byRef: Record<string, string>
  byRoute: Record<string, string>
  paths: Record<string, string[]>
  collections: Record<string, string[]>
}

export interface ResolvedVariant extends ManifestVariant {
  requestedLocale?: string
  resolvedLocale?: string
  fallback: boolean
  availableLocales: string[]
}

export interface ParseContentOptions {
  validate?: boolean
  csv?: ModuleOptions['csv']
  yaml?: ModuleOptions['yaml']
  markdown?: ModuleOptions['markdown'] | MarkdownOptions
  transformers?: ContentTransformer[]
  pathMeta?: {
    locales?: ContentContext['locales']
    defaultLocale?: ContentContext['defaultLocale']
    translatedSlugs?: ContentContext['translatedSlugs']
    respectPathCase?: ModuleOptions['respectPathCase']
    collections?: Record<string, ContentCollectionConfig>
    collectionResolver?: (file: string) => string | undefined
  }
  [key: string]: unknown
}

export type TransformContentSource = string | StorageValue

// Ensure that a .js file is emitted too
export {}
