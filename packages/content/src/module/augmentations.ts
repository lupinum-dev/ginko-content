import type { StorageValue } from 'unstorage'
import type { ParsedContent, MarkdownOptions } from '../types/content'
import type { ContentCollectionConfig, ContentCollectionI18nConfig } from '../types/config'
import type { ContentContext, ContentRevalidateOptions, ModuleOptions, ResolvedContentContext } from '../types/module'
import type { createSearchRuntimeConfig } from './options'

interface ModulePublicRuntimeConfig {
  api: {
    baseURL: string
  }

  sitemap: {
    path: string
    include?: string[]
    exclude?: string[]
    includeDrafts?: boolean
  } | false

  integrity: number | undefined

  respectPathCase: boolean

  defaultLocale: ContentContext['defaultLocale']

  locales: ContentContext['locales']

  provider: ContentContext['provider']

  providers: ContentContext['providers']

  links: ContentContext['links']

  collections: Record<string, {
    source: ContentCollectionConfig['source']
    exclude?: ContentCollectionConfig['exclude']
    strict: boolean
    i18n?: ContentCollectionI18nConfig
    sitemap?: boolean
  }>

  localeFallback: ContentContext['localeFallback']

  translatedSlugs: ContentContext['translatedSlugs']

  strictTranslatedSlugs: ContentContext['strictTranslatedSlugs']

  markdown: MarkdownOptions

  navigation: ModuleOptions['navigation']

  search: ReturnType<typeof createSearchRuntimeConfig> | false
}

interface ModulePrivateRuntimeConfig {
  /**
   * Internal version that represents cache format.
   * This is used to invalidate cache when the format changes.
   */
  cacheVersion: string;
  cacheIntegrity: string;
  revalidate?: false | ContentRevalidateOptions;
}

declare module '@nuxt/schema' {
  interface NuxtHooks {
    /**
     * Mutable provider-registration seam, called before provider selection is
     * validated: integrations (e.g. Ginko CMS) register their implementation
     * name here. Distinct from the read-only `content:context` notification.
     */
    'content:providers': (providers: Record<string, string>) => void | Promise<void>
    'content:context': (ctx: Readonly<ResolvedContentContext>) => void | Promise<void>
  }
  interface PublicRuntimeConfig {
    content: ModulePublicRuntimeConfig;
  }
  interface PrivateRuntimeConfig {
    content: ModulePrivateRuntimeConfig & ContentContext;
  }
}

// Keep sync with src/runtime/server/storage.ts
declare module 'nitropack' {
  interface NitroRuntimeHooks {
    'content:file:beforeParse': (file: { id: string; body: StorageValue }) => void;
    'content:file:afterParse': (file: ParsedContent) => void;
  }
}
