import type { MarkdownOptions, MarkdownPluginDescriptor } from './content'
import type { ContentCollectionConfig, ContentProviderName } from './config'
import type { ContentQueryBuilderWhere } from './query'
import type { ContentMiniSearchOptions, ContentSearchEngine } from './search'

export type MountOptions = {
  driver: 'fs' | 'http' | string
  name?: string
  prefix?: string
  [options: string]: unknown
}

export interface ContentI18nOptions {
  /**
   * Enable locale-aware content behavior.
   *
   * `true` means "detect from Nuxt I18n and/or content.config".
   *
   * @default true
   */
  enabled?: boolean
  /**
   * List of locale codes used by content.
   *
   * @default []
   */
  locales?: string[]
  /**
   * Default locale for top level contents.
   *
   * @default undefined
   */
  defaultLocale?: string
  /**
   * Ordered locale fallback chains keyed by locale code.
   *
   * @default {}
   */
  fallback?: Record<string, string[]>
  /**
   * Use numeric prefixes as the canonical cross-locale identity source.
   *
   * Example:
   * `en/1.guide/1.getting-started.md` and `de/1.leitfaden/1.erste-schritte.md`
   * share the same canonical key `1/1`.
   *
   * This is intentionally opt-in.
   *
   * @default false
   */
  translatedSlugs?: boolean
  /**
   * Treat translated-slug warnings as build/runtime validation errors.
   *
   * @default false
   */
  strictTranslatedSlugs?: boolean
}

export interface ContentSitemapOptions {
  /**
   * Route suffix appended to `content.api.baseURL`.
   *
   * @default '/sitemap'
   */
  path?: string
  /**
   * Collections to include in the generated content sitemap source.
   *
   * When omitted, all configured collections are considered.
   *
   * @default undefined
   */
  include?: string[]
  /**
   * Collections to exclude from the generated content sitemap source.
   *
   * @default []
   */
  exclude?: string[]
  /**
   * Include draft content in sitemap entries.
   *
   * Production default is `false`.
   * Development remains permissive for easier debugging.
   *
   * @default undefined
   */
  includeDrafts?: boolean
  /**
   * Optional build-time validation for generated sitemap output.
   *
   * This is intended as a release-safety check for content-heavy sites where
   * shipping an empty docs/blog sitemap is a production failure.
   *
   * @default disabled
   */
  assert?: ContentSitemapAssertOptions
}

export interface ContentSitemapAssertSitemapOptions {
  /**
   * Allow this sitemap to contain zero URLs.
   *
   * When `true`, URL count assertions are skipped for this sitemap.
   *
   * @default inherits global `allowEmpty`
   */
  allowEmpty?: boolean
  /**
   * Minimum number of URLs required for this sitemap.
   *
   * @default inherits global `minUrlsPerSitemap`
   */
  minUrls?: number
  /**
   * Require at least one image entry in this sitemap.
   *
   * @default inherits global `requireImages`
   */
  requireImages?: boolean
}

export interface ContentSitemapAssertOptions {
  /**
   * Enable sitemap artifact assertions.
   *
   * @default false
   */
  enabled?: boolean
  /**
   * Which build path should enforce assertions.
   *
   * `generate` maps to static generation, `build` maps to non-static builds,
   * and `both` enables both paths.
   *
   * @default 'generate'
   */
  mode?: 'generate' | 'build' | 'both'
  /**
   * Allow discovered sitemap files to contain zero URLs.
   *
   * @default false
   */
  allowEmpty?: boolean
  /**
   * Minimum number of URLs required in each discovered sitemap.
   *
   * @default 1
   */
  minUrlsPerSitemap?: number
  /**
   * Require at least one image entry in each discovered sitemap.
   *
   * @default false
   */
  requireImages?: boolean
  /**
   * Collections that must contribute at least one route to the content sitemap.
   *
   * This is preferred over hardcoded URL checks because it asserts the real
   * content invariant rather than a single route sample.
   *
   * @default []
   */
  requiredCollections?: string[]
  /**
   * Public URL paths that must appear in generated sitemap loc values.
   *
   * Values are compared by URL pathname, so absolute sitemap URLs are
   * normalized before assertion. Use this for release QA of important route
   * identities; keep `requiredCollections` for the broader content invariant.
   *
   * @default []
   */
  requiredPaths?: string[]
  /**
   * Public URL path prefixes that must not appear in generated sitemap loc
   * values.
   *
   * Use this to guard against internal/generated routes such as `/_payload`,
   * `/_nuxt`, API routes, or auth-only sections.
   *
   * @default []
   */
  forbiddenPathPrefixes?: string[]
  /**
   * Fail when generated sitemap URLs use placeholder or local hosts such as
   * `example.com`, `localhost`, `127.0.0.1`, or `.localhost`.
   *
   * Enable this for production-like release checks. It is disabled by default
   * so local examples and template builds can still generate static output.
   *
   * @default false
   */
  requireProductionSiteUrl?: boolean
  /**
   * Optional per-sitemap overrides keyed by sitemap name, for example `en-US`.
   *
   * @default {}
   */
  sitemaps?: Record<string, ContentSitemapAssertSitemapOptions>
}

export interface ContentSearchOptions {
  /**
   * Base route used for the built-in search api.
   *
   * Defaults to `${content.api.baseURL}/search`.
   */
  apiBaseURL?: string
  /**
   * Search engine used by `useContentSearchResults`.
   *
   * @default 'minisearch'
   */
  engine?: ContentSearchEngine
  /**
   * HTML tags ignored when flattening rich content into search text.
   *
   * @default ['script', 'style', 'pre']
   */
  ignoredTags?: string[]
  /**
   * Query predicate applied before records are indexed.
   *
   * @default { _draft: false, _partial: false }
   */
  filterQuery?: ContentQueryBuilderWhere
  /**
   * Collections included in the built-in index.
   *
   * When omitted, Ginko indexes route-backed public collections only. Data-only
   * collections are excluded unless listed explicitly.
   */
  collections?: string[]
  /**
   * Extra top-level document fields copied into each generated search record.
   *
   * Use this when `minisearch.fields`, `minisearch.storeFields`, or
   * `minisearch.boost` refer to frontmatter fields such as `tags`.
   *
   * @default []
   */
  extraFields?: string[]
  /**
   * MiniSearch index and ranking options.
   */
  minisearch?: Partial<ContentMiniSearchOptions>
}

export interface ContentPreviewOptions {
  /**
   * Server-side token required before preview storage can be read.
   */
  token?: string
}

export interface ContentRevalidateOptions {
  /**
   * Server-side token required before the built-in revalidation endpoint accepts
   * tag/path invalidation requests.
   */
  token: string
  /**
   * Allow token-only revalidation requests without HMAC headers.
   *
   * This is intended for local/dev compatibility only. Production CMS delivery
   * should leave this disabled so requests are timestamped and signed.
   *
   * @default false
   */
  allowUnsigned?: boolean
}

export interface ContentLinkRouteTarget {
  /**
   * Nuxt route name passed to Nuxt I18n `localePath()`.
   */
  route: string
  /**
   * Static route params forwarded to Nuxt I18n `localePath()`.
   */
  params?: Record<string, string | number>
  /**
   * Static query params forwarded to Nuxt I18n `localePath()`.
   */
  query?: Record<string, string | number | boolean | undefined>
}

export type ContentLinksOptions = Record<string, Record<string, ContentLinkRouteTarget>>

export interface ContentAgentRouteOptions {
  routes?: boolean
  linkHeaders?: boolean
  markdownNegotiation?: boolean
  prerender?: boolean
}

export interface ModuleOptions {
  api: {
    /**
     * Base route that will be used for content api
     *
     * @default '/api/_content'
     */
    baseURL: string
  }
  /**
   * Locale-aware content behavior.
   */
  i18n: boolean | ContentI18nOptions
  /**
   * Content-owned sitemap source configuration for Nuxt SEO.
   *
   * When enabled, Ginko exposes a JSON endpoint that can be consumed by
   * `@nuxtjs/sitemap` through `sitemap.sources`.
   */
  sitemap: boolean | ContentSitemapOptions
  /**
   * Built-in full-text search configuration.
   *
   * When enabled, Ginko exposes JSON/Pagefind search endpoints under
   * the content api base route. `useContentSearchData()` and
   * `useContentSearchResults()` are auto-imported; import the headless
   * `useContentSearch()` helper from `@lupinum/ginko-content/client`.
   */
  search: false | ContentSearchOptions
  /**
   * Preview storage access configuration.
   *
   * Preview mode is disabled unless a token is configured and the incoming
   * preview token matches it.
   */
  preview?: false | ContentPreviewOptions
  /**
   * Built-in cache revalidation endpoint configuration.
   *
   * When a token is configured, callers must send it as
   * `x-ginko-revalidate-token` or `authorization: Bearer <token>`.
   */
  revalidate?: false | ContentRevalidateOptions
  /**
   * Writer-facing markdown quick links. Values point at Nuxt route names;
   * localized paths stay owned by Nuxt I18n.
   *
   * @example
   * content.links.main.pricing = { route: 'pricing' }
   * markdown: [Pricing]($main.pricing)
   */
  links?: ContentLinksOptions
  /**
   * First-class agent markdown and LLM route features.
   */
  agent?: false | ContentAgentRouteOptions
  /**
   * Optional server-side cache adapter module.
   *
   * The module must default-export a `ContentCacheAdapter`, or export one as
   * `contentCacheAdapter` or `cacheAdapter`.
   */
  cache?: false | string
  /**
   * Disable content watcher and hot content reload.
   * Note: Watcher is a development feature and will not includes in the production.
   *
   * @default true
   */
  watch: boolean
  /**
   * Contents can be located in multiple places, in multiple directories or even in remote git repositories.
   * Using sources option you can tell Content module where to look for contents.
   *
   * @default ['content']
   */
  sources: Record<string, MountOptions>
  /**
   * List of ignore patterns that will be used to exclude content from parsing, rendering and watching.
   *
   * Note that files with a leading . or - are ignored by default
   *
   * @default []
   */
  ignores: Array<string>
  /**
   * Content module uses Comark under the hood to parse markdown files.
   */
  markdown: {
    /**
     * Tags will be used to replace markdown components and render custom components instead of default ones.
     *
     * @default {}
     */
    tags?: Record<string, string>
    /**
     * Ordered list of Comark plugin descriptors.
     *
     * @default []
     */
    plugins?: MarkdownPluginDescriptor[]
    /**
     * Anchor link generation config
     *
     * @default {}
     */
    anchorLinks?: boolean | {
      /**
        * Sets the maximal depth for anchor link generation
        *
        * @default 4
        */
      depth?: number,
      /**
       * Excludes headings from link generation when they are in the depth range.
       *
       * @default [1]
       */
      exclude?: number[]
    }
    /**
     * Markdown image renderer.
     *
     * `auto` uses Nuxt Image when `<NuxtImg>` is available and otherwise
     * falls back to a native `<img>`.
     *
     * @default 'auto'
     */
    image?: 'auto' | 'img' | 'nuxt-image'
  }
  /**
   * Options for yaml parser.
   *
   * @default {}
   */
  yaml: false | Record<string, unknown>
  /**
   * Options for yaml parser.
   *
   * @default {}
   */
  csv: false | {
    json?: boolean
    delimiter?: string
  }
  /**
   * Enable/Disable navigation.
   *
   * @default {}
   */
  navigation: false | {
    fields: Array<string>
  }
  /**
   * Typed collection definitions loaded from `content.config.*`.
   *
   * Globs are relative to the content source root.
   *
   * @default {}
   */
  collections?: Record<string, ContentCollectionConfig>
  /**
   * Backing implementation for public content reads.
   *
   * `filesystem` is the default. Provider modules can register named
   * implementations, for example `cms`.
   */
  provider?: ContentProviderName
  /**
   * External provider modules keyed by provider name. First-party provider
   * modules register themselves, so app configs usually do not need this.
   */
  providers?: Record<string, string>
  /**
   * Enable automatic usage of `useContentHead`
   *
   * @default true
   */
  contentHead?: boolean
  /**
   * Enable to keep uppercase characters in the generated routes.
   *
   * @default false
   */
  respectPathCase: boolean
  experimental: {
    stripQueryParameters?: boolean
  }
}


export interface ResolvedContentI18nOptions {
  locales: string[]
  defaultLocale?: string
  fallback: Record<string, string[]>
  translatedSlugs: boolean
  strictTranslatedSlugs: boolean
}

export interface ContentContext extends ModuleOptions {
  transformers: Array<string>
  sitemap: false | ContentSitemapOptions
  locales: string[]
  defaultLocale?: string
  localeFallback: Record<string, string[]>
  translatedSlugs: boolean
  strictTranslatedSlugs: boolean
}

export type ResolvedContentContext = Omit<ContentContext, 'markdown'> & {
  markdown: MarkdownOptions
}
