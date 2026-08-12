import type { StorageValue } from 'unstorage'
import type { ParsedContent, MarkdownOptions } from '../types/content'
import type { ContentContext, ContentRevalidateOptions, ResolvedContentContext } from '../types/module'
import type { createSearchRuntimeConfig } from './options'
import type { PortableComponentPolicyV1 } from '../cms-contract/types'
import type { ResolvedCollectionLocalePolicy } from '../features/localization/locale-policy'

interface ModulePublicRuntimeConfig {
  api: {
    baseURL: string
  }

  integrity: number | undefined

  defaultLocale: ContentContext['defaultLocale']

  locales: ContentContext['locales']

  links: ContentContext['links']

  collections: Record<string, {
    localePolicy: ResolvedCollectionLocalePolicy
    references?: Record<string, string[]>
  }>

  renderPolicies: Record<string, PortableComponentPolicyV1>

  markdown: Pick<MarkdownOptions, 'tags' | 'image'>

  search: ReturnType<typeof createSearchRuntimeConfig> | false
}

interface ModulePrivateRuntimeConfig {
  /**
   * Internal version that represents cache format.
   * This is used to invalidate cache when the format changes.
   */
  cacheVersion: number;
  cacheIntegrity: string;
  revalidate?: false | ContentRevalidateOptions;
  siteUrl?: string;
}

declare module '@nuxt/schema' {
  interface NuxtHooks {
    /**
     * Mutable provider-registration seam, called before provider selection is
     * validated: external provider modules register their implementation
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

// Keep in sync with src/storage/contents.ts
declare module 'nitropack' {
  interface NitroRuntimeHooks {
    'content:file:beforeParse': (file: { id: string; body: StorageValue }) => void;
    'content:file:afterParse': (file: ParsedContent) => void;
  }
}
