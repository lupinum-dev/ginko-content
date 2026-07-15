# Search And Sitemap

Use this for search index behavior, search composables, sitemap source registration, prerender integration, and Nuxt SEO/i18n interactions.

## Search Modes

Ginko supports three intended search modes:

- MiniSearch JSON index for small-to-medium static/runtime sites.
- Pagefind for larger static sites with sharded search.
- Provider-owned search through `engine: 'provider'`.

External search services can be used by apps when product search behavior is needed, but Ginko core should not become a full-text search backend.

## Search Config

`content.search` controls search behavior. The default engine is MiniSearch. `search: false` disables built-in search endpoints/assets.

Common search config concerns:

- engine choice
- indexed collections
- ignored tags such as script/style/pre
- filtering drafts and partials
- Pagefind generation constraints
- provider-owned direct search support

Provider-owned search should not force non-filesystem data into local static indexes.

## Search APIs

Client API:

- `useContentSearch(options?)`: the sole search composable (VNEXT.md 10.4/10.7). One consolidated composable owns the query, results (MiniSearch, Pagefind, or provider-owned search), and — when an `options.collection` is passed — the `files`/`searchNavigation` payload previously split across the deleted `useContentSearchData`/`useContentSearchResults`. `searchNavigation` is the sole search-navigation name.

Provider APIs:

- Provider `query`: core derives index sections from canonical documents.
- optional direct `search`: provider-owned search runtime.

Route-backed and data-only collection rules still apply. Data-only search access must fail clearly when unsupported.

## Sitemap Ownership

Ginko owns content-backed sitemap entries. `@nuxtjs/sitemap` owns:

- XML generation
- hreflang rendering
- sitemap indexes
- robots integration
- final XML route output

Do not reimplement sitemap XML emission in Ginko.

## Sitemap Config

`content.sitemap` registers a content sitemap source when enabled. Content collections are included unless config excludes them or the collection is data-only and not opted in.

Drafts should be excluded in production default behavior.

`content.sitemap.assert` can fail build/generate when final sitemap output is empty or missing expected content. Assertions run after Nuxt Sitemap has generated final XML files, with build fallback in Nitro where needed.

## Sitemap APIs

Server helper:

```ts
import { queryCollectionsSitemapEntries } from '#content/server'

export default defineEventHandler((event) => {
  return queryCollectionsSitemapEntries(event, {
    siteUrl: process.env.NUXT_PUBLIC_SITE_URL || 'https://docs.ginko-content.dev',
  })
})
```

Use this helper for content-backed entries instead of directly traversing storage.

## I18n Interactions

Content sitemap entries must respect locale behavior and canonical identity. Nuxt Sitemap owns final hreflang rendering, but Ginko must provide the correct content-backed localized entries and alternates.

When modifying i18n sitemap behavior, read `internal/nuxt-integration-sitemap-i18n.md` and run both sitemap and content-route contract tests.

## Where To Verify

- `test/contracts/sitemap-assert-contracts.test.ts`
- `test/contracts/module-contracts.test.ts`
- `test/contracts/provider-contracts.test.ts`
- `test/contracts/use-content-page-contracts.test.ts`
- `internal/nuxt-integration-sitemap-i18n.md`
- `docs/content/docs/4.guides/3.discovery/`
- `docs/content/docs/sitemap/`
