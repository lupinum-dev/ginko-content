import type { StorageValue } from 'unstorage'
import type { ParsedContent, ContentTransformer, MarkdownOptions } from './content'
import type { ContentCollectionConfig } from './config'
import type { ResolvedLocalePolicy } from '../features/localization/locale-policy'
import type { ContentContext, ModuleOptions } from './module'

export interface ContentCacheArtifact<T = ParsedContent> {
  parsed: T
  hash: string
}

export interface ContentVariantIdentity {
  canonicalKey: string
  contentId: string
  locale: string
  path?: string
}

export interface ResolvedVariant extends ContentVariantIdentity {
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
    localePolicy?: ResolvedLocalePolicy['collections']
    collectionResolver?: (file: string) => string | undefined
  }
  [key: string]: unknown
}

export type TransformContentSource = string | StorageValue

// Ensure that a .js file is emitted too
export {}
