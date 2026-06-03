# Ginko CMS Integration Specification

This document defines what a CMS must provide to become a first-class Ginko Content provider.

The target reader is a CMS builder: someone implementing a backend, SDK, provider package, and publish flow that can power Ginko sites with the same ergonomics as the filesystem provider.

The spec is intentionally concrete. A working CMS integration should be buildable from this file plus the public content provider types.

## North Star

Ginko does not want a CMS-specific runtime hidden inside core. The CMS owns content truth. Ginko owns the website-facing content API.

```txt
CMS owns:
  authorship, drafts, publishing, permissions, normalized records,
  dependency graph, provider-side caches, search index, publish events

Ginko owns:
  collection config, query/page/navigation/search/sitemap contracts,
  request-local cache hint collection, rendering integration,
  authenticated revalidation endpoint, host cache adapter interface

Site app owns:
  routes, layouts, preview authorization, cache adapter configuration,
  platform-specific deployment behavior
```

The most important design rule:

```txt
Correctness before cleverness.
Serving stale published content is worse than purging too much.
```

MVP integrations may over-invalidate aggregate pages. Mature integrations should track exact route dependencies and purge only affected routes.

## Required Public Contract

A CMS provider must implement the `ContentProvider` contract exported from `#content/server`.

The TypeScript minimum is small:

```ts
interface MinimumContentProvider {
  name: string
  capabilities: ContentProviderCapabilities
  query: ContentProvider['query']
}
```

A first-class CMS provider should implement the full website contract below. Optional methods become required by capability/config choices:

| Method | Required when |
|---|---|
| `page`, `routeMeta` | `capabilities.routeBackedCollections` or `capabilities.localizedRoutes` is `true` |
| `navigation`, `navigationQuery` | `capabilities.navigation` is `true` |
| `surroundings` | `capabilities.surroundings` is `true` |
| `searchSections` | `capabilities.searchSections` is `true` |
| `sitemapEntries` | `capabilities.sitemap` is `true` |
| `search` | the site config uses CMS-backed search |
| `siteData` | the site/app reads provider-owned shared data |
| `invalidate` | the provider owns any cache, dependency graph, or remote state that must be purged |

```ts
import type { ContentProvider } from '#content/server'

export default {
  name: 'cms',
  capabilities: {
    routeBackedCollections: true,
    dataCollections: true,
    localizedRoutes: true,
    translatedSlugs: true,
    navigation: true,
    surroundings: true,
    searchSections: true,
    sitemap: true,
    query: {
      operators: [
        '$eq',
        '$ne',
        '$gt',
        '$gte',
        '$lt',
        '$lte',
        '$in',
        '$contains',
        '$containsAny',
        '$icontains',
        '$exists',
        '$type',
        '$regex',
        '$options',
        '$not'
      ],
      sort: 'supported',
      projection: 'supported',
      limit: true,
      skip: true,
      count: true
    }
  },
  async query(event, query) {},
  async page(event, collection, routeOrPath, options) {},
  async routeMeta(event, collection, routeOrPath, options) {},
  async navigation(event, collection, options) {},
  async navigationQuery(event, query) {},
  async surroundings(event, collection, path, options) {},
  async searchSections(event, collection, options) {},
  async search(event, request) {},
  async siteData(event, request) {},
  async sitemapEntries(event, options) {},
  async invalidate(event, input) {}
} satisfies ContentProvider
```

Capabilities are runtime truth. Do not mark a capability as supported unless the provider implements the operation correctly.

There is no `capabilities.search` flag today. Provider-backed search is enabled by site search configuration plus the presence of `provider.search`. `searchSections` is separate: it means the provider can emit section records that Ginko or the app can index.

## Terminology

| Term | Meaning |
|---|---|
| Collection | Named set of entries configured in `content.config.ts`, for example `blog`, `docs`, `authors` |
| Entry | One CMS record in a collection |
| Route-backed collection | Collection whose entries can become public pages |
| Data collection | Collection used through queries/references but not exposed as pages by default |
| Canonical key | Locale-agnostic stable identity shared by translated variants |
| Ref | Human-authored stable alias for references, for example `alice` |
| Variant | One locale-specific version of a canonical entry |
| Published record | Version visible to public site rendering |
| Draft record | Version visible only in preview/editor contexts |
| Cache hint | Provider-supplied response cache metadata collected during rendering |
| Dependency tag | Stable string representing content used by a route |
| Affected path | Public URL that must be revalidated after content changes |

## CMS Data Model

The CMS should normalize content into a provider-friendly model before Ginko sees it.

### Entry Identity

Each entry needs stable identifiers that survive title, slug, and locale changes.

```ts
interface CmsEntryIdentity {
  /**
   * CMS-owned immutable primary key.
   * Example: "entry_01HQ..."
   */
  id: string

  /**
   * Collection handle from Ginko config.
   * Example: "blog"
   */
  collection: string

  /**
   * Human-authored stable alias for references.
   * Example: "post-1", "alice", "pricing"
   */
  ref: string

  /**
   * Locale-agnostic identity shared by translations.
   * Example: "blog:post-1"
   */
  canonicalKey: string

  /**
   * Locale of this concrete variant.
   * Example: "en", "de", "fr"
   */
  locale?: string
}
```

Rules:

- `id` must never be reused.
- `ref` should be stable. Editors may rename it, but the CMS must treat that as a breaking reference migration.
- `canonicalKey` must stay stable across translated variants.
- Route slugs may change without changing `id`, `ref`, or `canonicalKey`.
- Never use title as identity.

### Entry Versions

A production CMS should store at least published and draft states.

```ts
type CmsEntryStatus = 'draft' | 'published' | 'scheduled' | 'archived' | 'deleted'

interface CmsEntryVersion {
  id: string
  entryId: string
  status: CmsEntryStatus
  locale?: string
  fields: Record<string, unknown>
  body?: CmsRichTextDocument | CmsMarkdownDocument | null
  createdAt: string
  updatedAt: string
  publishedAt?: string
  validFrom?: string
  validTo?: string
}
```

Public Ginko rendering must read only the published version unless the request is explicitly in preview mode.

### Authoring and Workflow

The CMS should separate editorial workflow from public rendering. Ginko only needs the final published and preview-readable shapes, but a CMS builder must define how content reaches those states.

Recommended workflow model:

```ts
interface CmsRevision {
  id: string
  entryId: string
  baseRevisionId?: string
  status: 'autosaved' | 'draft' | 'in_review' | 'approved' | 'scheduled' | 'published' | 'rolled_back'
  authorId: string
  createdAt: string
  updatedAt: string
  publishAt?: string
  message?: string
}
```

Requirements:

- Autosaves must not affect public provider reads.
- Draft revisions must be preview-only.
- Scheduled publishes must become visible atomically at the scheduled time and trigger invalidation.
- Rollback is a new publish event that restores an older revision and invalidates the same affected graph.
- Concurrent edits need a policy: optimistic locking, explicit locks, or merge UI.
- Approval workflows must define who can move entries from draft to review to published.
- Every publish, unpublish, delete, schedule, rollback, and migration must be audit logged.
- Revision history must preserve enough data to reconstruct route paths, references, assets, and cache tags for old and new revisions.

### Route Records

Route-backed entries need a route record separate from identity.

```ts
interface CmsRouteRecord {
  entryId: string
  collection: string
  canonicalKey: string
  locale: string
  slug: string
  path: string
  canonicalPath: string
  routeMount: string
  translated: boolean
  fallbackLocale?: string
}
```

Example:

```json
{
  "entryId": "entry_blog_post_1_en",
  "collection": "blog",
  "canonicalKey": "blog:post-1",
  "locale": "en",
  "slug": "post-1",
  "path": "/blog/post-1",
  "canonicalPath": "/blog/post-1",
  "routeMount": "/blog",
  "translated": true
}
```

For translated route mounts:

```json
{
  "collection": "docs",
  "canonicalKey": "docs:getting-started",
  "locale": "de",
  "slug": "erste-schritte",
  "path": "/de/dokumentation/erste-schritte",
  "canonicalPath": "/docs/getting-started",
  "routeMount": "/dokumentation",
  "translated": true
}
```

### Renderable Document Shape

Ginko expects route-backed page payloads to look like parsed content records plus route metadata.

```ts
interface CmsRenderablePage {
  _id: string
  _source?: string
  _path: string
  _collection: string
  _locale?: string
  _canonicalKey: string
  _type: 'markdown' | 'yaml' | 'json' | 'csv'
  _extension?: 'md' | 'yaml' | 'yml' | 'json' | 'json5' | 'csv'
  _draft?: boolean
  _partial?: boolean
  ref: string
  title?: string
  description?: string
  seo?: {
    title?: string
    description?: string
    image?: string | { src: string, alt?: string, width?: number, height?: number }
  }
  body: {
    type: 'root'
    children: unknown[]
    toc?: {
      title: string
      depth: number
      searchDepth: number
      links: Array<{ id: string, text: string, depth: number, children?: unknown[] }>
    }
  } | null
  [field: string]: unknown
}
```

Provider implementations may store content internally as ProseMirror, Lexical, Portable Text, HTML, Markdown, or structured blocks. The provider must return Ginko's object AST shape for renderable `body`.

Minimum body for an empty page:

```ts
body: {
  type: 'root',
  children: []
}
```

Do not return raw HTML as the only body format unless the site renderer intentionally supports it as a custom field. Ginko's default renderer expects the object AST.

## Collection Configuration

Ginko sites configure collections in `content.config.ts`.

```ts
import { z } from 'zod'
import {
  defineCollection,
  defineContentConfig,
  reference
} from '@lupinum/ginko-content/config'

export const authors = defineCollection({
  type: 'page',
  source: 'authors/**/*.md',
  route: '/authors',
  schema: z.object({
    name: z.string(),
    bio: z.string().optional()
  })
})

export const blog = defineCollection({
  type: 'page',
  source: 'blog/**/*.md',
  route: '/blog',
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    date: z.string(),
    author: reference('authors'),
    related: z.array(reference('blog')).default([])
  })
})

export const siteData = defineCollection({
  type: 'data',
  source: 'data/**/*.yml',
  sitemap: false,
  schema: z.object({
    key: z.string()
  })
})

export default defineContentConfig({
  provider: 'custom-cms',
  providers: {
    'custom-cms': '@acme/ginko-cms-provider'
  },
  collections: {
    authors,
    blog,
    siteData
  }
})
```

The CMS provider must honor collection names and collection semantics. The `source` globs are filesystem-compatible declarations for schema and migration consistency. A CMS provider may not literally read those files, but it must map CMS content types to the same collection names.

## Schema, Validation, and Migrations

A CMS integration needs a clear schema ownership model. Ginko's `content.config.ts` gives the site a typed collection contract; the CMS may also have its own field model. The provider must keep those two models compatible.

Recommended schema record:

```ts
interface CmsSchemaVersion {
  collection: string
  version: string
  checksum: string
  fields: Array<{
    name: string
    type: string
    required: boolean
    localized?: boolean
    default?: unknown
    referenceCollection?: string
  }>
  createdAt: string
}
```

Rules:

- Validate published entries against the active collection schema before they can become visible to public Ginko rendering.
- Validate draft entries before preview rendering, but allow editorial save operations to keep incomplete drafts when the CMS product requires that.
- Store a schema checksum or version with every published entry version.
- Fail deploy-time validation when the site schema and CMS schema are incompatible.
- Treat field renames as migrations, not delete-plus-add changes.
- Backfill defaults before publishing, not lazily during public requests.
- Keep migration logs for field renames, field deletes, type changes, reference target changes, and route/slug migrations.
- Export/import must preserve `id`, `ref`, `canonicalKey`, locale, published revision, draft revision, references, assets, and route history.

Migration example:

```ts
interface CmsMigration {
  id: string
  collection: string
  fromSchema: string
  toSchema: string
  operations: Array<
    | { type: 'renameField', from: string, to: string }
    | { type: 'deleteField', field: string }
    | { type: 'setDefault', field: string, value: unknown }
    | { type: 'rewriteReference', field: string, from: string, to: string }
  >
}
```

Reference migrations must update both stored entry fields and reverse-reference indexes. Slug migrations must preserve old paths long enough for redirect and cache invalidation.

## Provider Method Contracts

### `query(event, query)`

`query` is the generic collection query method. It backs list pages, data reads, and some app-level APIs.

Input shape:

```ts
interface ContentQueryBuilderParams {
  collection?: string
  first?: boolean
  count?: true
  skip?: number
  limit?: number
  only?: string[]
  without?: string[]
  sort?: Array<Record<string, 1 | -1> | Record<string, unknown>>
  where?: Record<string, unknown> | Array<Record<string, unknown>>
  resolveLocale?: {
    locale?: string
    fallback?: string[] | boolean
    exact?: boolean
  }
  resolveVariant?: {
    by: 'path' | 'route' | 'ref'
    value: string
  }
}
```

Example query:

```ts
const posts = await provider.query(event, {
  collection: 'blog',
  where: {
    date: { $lte: '2026-05-02' },
    _draft: { $ne: true }
  },
  sort: [{ date: -1 }],
  limit: 10,
  only: ['title', 'description', 'date', 'author', '_path', '_locale']
})
```

Expected behavior:

- Unknown collection fails with `unknown_collection`.
- Unsupported operators fail with `unsupported_query_operator`.
- Unsupported query shapes fail with `unsupported_query_shape`.
- Supported internal operators are `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$contains`, `$containsAny`, `$icontains`, `$exists`, `$type`, `$regex`, `$options`, and `$not`.
- Public unified-query `$nin` compiles to `$not` plus `$in`; `$prefix` compiles to anchored `$regex`.
- Public requests exclude drafts and archived/deleted entries.
- `first: true` returns one item or `undefined`.
- `count: true` returns a count response or number.
- `limit` and `skip` must be stable with sorting.
- `only` is a projection allow-list.
- `without` is a projection deny-list.
- `resolveLocale` applies locale filtering/fallback when the collection is localized.
- `resolveVariant` is used by route/ref/path lookups and must apply the same locale/fallback rules as `page()`.
- Query results should include cache hints.

Allowed response shapes:

```ts
// List query
{ result: rows, skip: query.skip || 0, limit: query.limit || rows.length, total }

// First query
{ result: rowOrUndefined }

// Count query
{ result: total }

// Shortcuts accepted by the runtime
rows
row
total
undefined
```

Example result with cache hint:

```ts
import { withContentCache } from '#content/server'

return withContentCache(posts, {
  tags: ['collection:blog'],
  paths: ['/blog'],
  maxAge: 300,
  swr: 60
})
```

### `page(event, collection, routeOrPath, options)`

`page` resolves one route-backed document.

Example:

```ts
const page = await provider.page(event, 'blog', '/blog/post-1', {
  locale: 'en',
  fallback: true,
  canonical: false
})
```

Required returned fields:

```ts
{
  _id: 'cms:blog:post-1:en',
  _source: 'cms',
  _path: '/blog/post-1',
  _collection: 'blog',
  _locale: 'en',
  _canonicalKey: 'blog:post-1',
  _type: 'markdown',
  _extension: 'md',
  ref: 'post-1',
  stem: 'post-1',
  title: 'Post 1',
  body: { type: 'root', children: [] },
  locale: 'en',
  defaultLocale: 'en',
  path: '/blog/post-1',
  canonicalPath: '/blog/post-1',
  variants: [
    { locale: 'en', path: '/blog/post-1', canonicalPath: '/blog/post-1' }
  ],
  localePaths: {
    en: { path: '/blog/post-1', translated: true }
  },
  resolved: {
    locale: 'en',
    requestedLocale: 'en',
    fallback: false,
    path: '/blog/post-1',
    availableLocales: ['en']
  }
}
```

Not found behavior:

- Return `null` when no public page exists for the route.
- Do not return draft content in public mode.
- Do not return fallback content unless fallback was requested and configured.
- Honor `canonical: true` by returning canonical paths where the public API expects canonical route metadata.
- If the route targets a data-only collection, fail with `data_collection_route_access`.

Cache hint example:

```ts
return withContentCache(page, {
  tags: [
    'entry:blog:post-1',
    'entry:authors:alice',
    'collection:blog',
    'route:/blog/post-1'
  ],
  paths: ['/blog/post-1'],
  maxAge: 300,
  swr: 60,
  lastModified: new Date(page.updatedAt)
})
```

### `routeMeta(event, collection, routeOrPath, options)`

`routeMeta` returns route and locale metadata without loading the full body.

`routeMeta` options currently support `locale` and `fallback`. Unlike `page()`, it does not accept `canonical`.

Use it for fast route checks, link resolution, sitemap preparation, and i18n metadata.

```ts
const meta = await provider.routeMeta(event, 'docs', '/de/dokumentation/einstieg', {
  locale: 'de',
  fallback: true
})
```

Expected result:

```ts
{
  locale: 'de',
  defaultLocale: 'en',
  path: '/de/dokumentation/einstieg',
  canonicalPath: '/docs/getting-started',
  variants: [
    { locale: 'en', path: '/docs/getting-started', canonicalPath: '/docs/getting-started' },
    { locale: 'de', path: '/de/dokumentation/einstieg', canonicalPath: '/docs/getting-started' }
  ],
  localePaths: {
    en: { path: '/docs/getting-started', translated: true },
    de: { path: '/de/dokumentation/einstieg', translated: true }
  },
  resolved: {
    locale: 'de',
    requestedLocale: 'de',
    fallback: false,
    path: '/de/dokumentation/einstieg',
    availableLocales: ['en', 'de']
  }
}
```

### `navigation(event, collection, options)`

`navigation` returns a tree for one collection.

```ts
const nav = await provider.navigation(event, 'docs', {
  locale: 'en',
  fields: ['description', 'badge']
})
```

Expected shape:

```ts
[
  {
    title: 'Guide',
    path: '/docs/guide',
    _path: '/docs/guide',
    _id: 'cms:docs:guide:en',
    _canonicalKey: 'docs:guide',
    _locale: 'en',
    description: 'Start here',
    children: [
      {
        title: 'Getting Started',
        path: '/docs/guide/getting-started',
        _path: '/docs/guide/getting-started',
        _id: 'cms:docs:getting-started:en',
        _canonicalKey: 'docs:getting-started',
        _locale: 'en'
      }
    ]
  }
]
```

Navigation rules:

- Hidden documents must be excluded.
- Draft documents must be excluded in public mode.
- Ordering must be deterministic.
- Folder/index entries should merge into a single navigation node.
- `fields` controls which extra document fields are copied onto nodes.
- Locale resolution should return app-ready paths.

Cache hint:

```ts
return withContentCache(nav, {
  tags: ['nav:docs:en', 'collection:docs'],
  paths: ['/docs'],
  maxAge: 300
})
```

### `navigationQuery(event, query)`

`navigationQuery` is the query-shaped navigation entry point used by runtime endpoints. It should generally call the same internal implementation as `navigation`.

Example:

```ts
await provider.navigationQuery(event, {
  collection: 'docs',
  resolveLocale: { locale: 'de', fallback: true },
  only: ['title', 'description']
})
```

### `surroundings(event, collection, path, options)`

`surroundings` returns previous and next navigation items around a page.

```ts
const [previous, next] = await provider.surroundings(event, 'docs', '/docs/guide/install', {
  locale: 'en',
  fields: ['description']
})
```

Expected result:

```ts
[
  { title: 'Getting Started', path: '/docs/guide/getting-started', _path: '/docs/guide/getting-started' },
  { title: 'Configuration', path: '/docs/guide/configuration', _path: '/docs/guide/configuration' }
]
```

Use the same ordering and visibility rules as `navigation`.

### `searchSections(event, collection, options)`

`searchSections` emits searchable sections for route-backed content.

```ts
const sections = await provider.searchSections(event, 'docs', {
  locale: 'en',
  minHeading: 'h2',
  maxHeading: 'h3',
  ignoredTags: ['code'],
  extraFields: ['product', 'version'],
  filterQuery: { product: { $eq: 'cloud' } }
})
```

Expected section:

```ts
{
  id: '/docs/guide/getting-started#install',
  title: 'Install',
  titles: ['Guide', 'Getting Started', 'Install'],
  content: 'Install the package with pnpm...',
  level: 2,
  path: '/docs/guide/getting-started',
  anchor: 'install',
  locale: 'en',
  product: 'cloud',
  version: '1.0'
}
```

Search section rules:

- Public search excludes drafts, hidden private entries, archived entries, and deleted entries.
- Section IDs must be stable.
- Heading anchors must match rendered page anchors.
- `ignoredTags` must remove text from ignored nodes.
- `filterQuery` must apply before extracting sections.
- Extra fields must be copied only when requested.

Cache hint:

```ts
return withContentCache(sections, {
  tags: ['search:en', 'collection:docs'],
  maxAge: 600
})
```

### `search(event, request)`

`search` is optional. Implement it when the CMS has its own search backend.

Provider-backed search is selected by site search configuration, not by a provider capability flag. `searchSections` and `search` serve different paths:

- `searchSections` emits indexable content sections.
- `search` executes a query against a CMS-owned search backend.

```ts
const results = await provider.search(event, {
  term: 'cache invalidation',
  locale: 'en',
  collections: ['docs', 'blog']
})
```

Expected result:

```ts
[
  {
    path: '/docs/cms-cache',
    title: 'CMS Cache and Invalidation',
    excerpt: 'Build provider-neutral response caching...',
    score: 0.92,
    anchor: 'revalidate-after-publish',
    locale: 'en'
  }
]
```

Search backend requirements:

- Results must point to public route paths.
- Scores must be deterministic enough for tests.
- Locale filters must be honored.
- Collection filters must be honored.
- Draft and unpublished content must not appear in public mode.
- Preview search may include drafts only when explicitly authorized.
- If the provider cannot search, set `searchSections: true` and let Ginko build an index from sections, or fail with `unsupported_provider_search`.

Search indexing lifecycle requirements:

- Index updates must be tied to publish, unpublish, delete, locale publish, and asset/text changes.
- Deleted and unpublished entries must be removed from the index before revalidation is considered complete.
- Index records should include content revision, locale, collection, path, title, headings, excerpt, and permission/publication channel.
- Tokenization and stemming should be locale-aware when the CMS supports multiple languages.
- Synonyms, boosts, and ranking rules must be deterministic enough for repeatable tests.
- Permission-filtered or preview search must use separate indexes or strict filters; it must never leak records from the public index.
- Search rebuild jobs must be observable: started, completed, failed, retried, and stale-index revision.

### `siteData(event, request)`

`siteData` returns shared data by key and optional locale. Use it for global nav labels, theme settings, footer content, feature flags, and other low-volume structured data.

```ts
const footer = await provider.siteData(event, {
  key: 'footer',
  locale: 'en'
})
```

Expected result:

```ts
{
  key: 'footer',
  locale: 'en',
  updatedAt: 1777670400000,
  data: {
    links: [
      { label: 'Docs', to: '/docs' },
      { label: 'Contact', to: '/contact' }
    ]
  }
}
```

Cache hint:

```ts
return withContentCache(footer, {
  tags: ['site-data:footer:en'],
  maxAge: 600
})
```

### `sitemapEntries(event, options)`

`sitemapEntries` returns public URLs owned by content.

```ts
const entries = await provider.sitemapEntries(event, {
  includeDrafts: false
})
```

Expected entry:

```ts
{
  loc: '/docs/guide/getting-started',
  alternatives: [
    { hreflang: 'en', href: '/docs/guide/getting-started' },
    { hreflang: 'de', href: '/de/dokumentation/erste-schritte' }
  ],
  images: [
    { loc: 'https://cdn.example.com/docs/install.png' }
  ]
}
```

Sitemap rules:

- Include only public canonical pages.
- Exclude data collections unless explicitly configured as sitemap-visible.
- Exclude drafts, partials, hidden-private pages, archived entries, and deleted entries.
- Include localized alternatives when variants exist.
- Keep `loc` stable and normalized.

Cache hint:

```ts
return withContentCache(entries, {
  tags: ['sitemap'],
  paths: ['/sitemap.xml'],
  maxAge: 600
})
```

### `invalidate(event, input)`

`invalidate` clears provider-owned caches and dependency maps.

Input:

```ts
interface ContentCacheInvalidateInput {
  tags?: string[]
  paths?: string[]
}
```

Example:

```ts
async invalidate(event, input) {
  await Promise.all([
    normalizedEntryCache.purge(input),
    routeLookupCache.purge(input),
    navigationCache.purge(input),
    searchCache.purge(input),
    dependencyStore.markDirty(input)
  ])
}
```

Rules:

- Invalidation must be idempotent.
- Missing tags or paths should be treated as empty lists.
- Provider cache invalidation is separate from host response cache invalidation.
- After invalidation returns, the next provider read must not return stale published data for affected entries.
- It is acceptable to serve stale data during background refresh only when the configured behavior explicitly allows stale-while-revalidate and the host cache has not been synchronously purged yet.

## Cache Hints

Provider methods may return content wrapped with `withContentCache(data, hint)`.

```ts
import { withContentCache } from '#content/server'

return withContentCache(page, {
  tags: ['entry:blog:post-1', 'entry:authors:alice'],
  paths: ['/blog/post-1'],
  maxAge: 300,
  swr: 60,
  etag: '"blog-post-1-v12"',
  lastModified: new Date('2026-05-02T10:00:00Z')
})
```

Hint shape:

```ts
interface ContentCacheHint {
  tags?: string[]
  paths?: string[]
  maxAge?: number
  swr?: number
  etag?: string
  lastModified?: Date
}
```

Merge rules:

- Tags dedupe and accumulate.
- Paths normalize to leading slash, dedupe, and accumulate.
- `maxAge` uses the shortest value.
- `swr` uses the shortest value.
- Newest `lastModified` wins.
- Last `etag` wins.
- `false` opts the whole response out of public caching.

Preview and draft reads must not produce public cache hints.

```ts
if (isPreviewRequest(event)) {
  return withContentCache(draftPage, false)
}
```

## Standard Dependency Tags

CMS providers must use stable, predictable cache tags.

The `id` segment in entry tags is a public dependency key, not necessarily the
CMS database primary key. Prefer a CMS `stableId` or stable authored `ref` when
available. Use the immutable CMS entry ID only as a fallback. Never use title,
slug, route path, or translated slug as the entry identity.

| Tag | Meaning |
|---|---|
| `entry:{collection}:{id}` | One content entry, using the public dependency key described above |
| `collection:{collection}` | Any list/query over a collection |
| `route:{path}` | One rendered public route |
| `nav:{collection}:{locale}` | Navigation tree for a collection/locale |
| `search:{locale}` | Search sections or provider search index for a locale |
| `sitemap` | Sitemap output |
| `site-data:{key}:{locale}` | Shared site data |

Recommended additions for mature CMS providers:

| Tag | Meaning |
|---|---|
| `asset:{id}` | Image/file asset used by pages |
| `taxonomy:{name}:{value}` | Category/tag/section dependency |
| `author:{id}` | Optional alias for author entry dependencies |
| `layout:{key}` | Routes depending on CMS-managed layout data |
| `redirects` | CMS-owned redirects |

Use one canonical tag family consistently. Do not emit both `author:alice` and `entry:authors:alice` unless the CMS has a clear reason and can invalidate both.

## Reference Dependencies

When a page renders another entry, the page must include both dependency tags.

Reference integrity is a CMS responsibility. Ginko can validate declared `reference()` fields at the site boundary, but the CMS must keep authored references coherent.

Reference model:

```ts
interface CmsReference {
  sourceCollection: string
  sourceRef: string
  field: string
  targetCollection: string
  targetRef: string
  locale?: string
  required: boolean
}
```

Rules:

- Validate target collection against the `reference('collection')` schema.
- Validate required references before publish.
- Keep a reverse-reference index from target entry to source entries.
- Decide whether references are localized per variant or shared across variants; encode that decision in the schema.
- Deleted or archived target entries must block publish or produce a clear dangling-reference error.
- Unpublishing a referenced entry must invalidate every public route that rendered it.
- Circular references are allowed only when the renderer/search/indexer has cycle protection.
- Ref renames must update authored fields, reverse indexes, dependency graphs, and old/new cache tags.
- Preview may resolve draft targets, but public rendering must resolve only published targets.

Example fixture:

```txt
authors/alice
blog/post-1 references alice
blog/post-2 references alice
blog/post-3 references alice
blog/post-4 references alice
blog/post-5 references alice
blog/post-6 references bob
```

Rendered `/blog/post-1` must emit:

```txt
entry:blog:post-1
entry:authors:alice
collection:blog
route:/blog/post-1
```

If Alice's name changes:

```txt
invalidate:
  tags:
    entry:authors:alice
    collection:authors
    collection:blog
    search:en
  paths:
    /authors/alice
    /blog/post-1
    /blog/post-2
    /blog/post-3
    /blog/post-4
    /blog/post-5
    /blog
```

Expected behavior:

- `/authors/alice` updates.
- `/blog/post-1` through `/blog/post-5` update because they render Alice's name.
- `/blog` updates if it renders author names or post summaries depending on author data.
- `/blog/post-6` is not purged because it references Bob.

MVP providers may include `collection:blog` and over-purge `/blog`. They must not leave `/blog/post-1` through `/blog/post-5` stale after invalidation.

## Dependency Graph

A production CMS should store route dependencies produced during rendering.

```txt
route path -> tags used while rendering
tag -> route paths that used the tag
```

Example:

```json
{
  "routeToTags": {
    "/blog/post-1": [
      "entry:blog:post-1",
      "entry:authors:alice",
      "collection:blog",
      "route:/blog/post-1"
    ],
    "/blog/post-6": [
      "entry:blog:post-6",
      "entry:authors:bob",
      "collection:blog",
      "route:/blog/post-6"
    ]
  },
  "tagToRoutes": {
    "entry:authors:alice": ["/blog/post-1", "/blog/post-2", "/blog/post-3", "/blog/post-4", "/blog/post-5"],
    "entry:authors:bob": ["/blog/post-6"]
  }
}
```

When an entry changes:

```ts
const changedTags = [
  'entry:authors:alice',
  'collection:authors',
  'search:en'
]

const affectedPaths = await dependencyStore.pathsForTags(changedTags)

await revalidate({
  tags: changedTags,
  paths: [
    ...affectedPaths,
    '/authors/alice',
    '/blog',
    '/sitemap.xml'
  ]
})
```

The provider may own this dependency store because the provider understands references and publish events. Ginko core should not need CMS-specific tables.

Dependency graph lifecycle rules:

- Insert or replace route edges after a successful public render.
- Store graph edges with content revision, route path, locale, and generated-at timestamp.
- Remove old route edges on slug rename, delete, unpublish, and route visibility changes.
- Remove reference edges when a field no longer references the target entry.
- Never write preview/draft dependencies into the public graph.
- Cold routes that have never rendered may be missing from a render-produced graph; the CMS must conservatively add direct known paths and aggregate paths during publish.
- If graph coverage is unknown or expired, fall back to collection-level invalidation rather than risking stale published content.
- For path-only host adapters, tag-to-path resolution must happen before the adapter is called.

Invalidation resolution should be explicit in the CMS/provider layer:

```ts
interface ResolvedInvalidation {
  tags: string[]
  paths: string[]
  graphCoverage: 'complete' | 'partial' | 'unknown'
}

async function resolveInvalidation(input: { tags?: string[], paths?: string[] }): Promise<ResolvedInvalidation> {
  const pathsFromTags = await dependencyStore.pathsForTags(input.tags || [])
  const directPaths = input.paths || []
  const graphCoverage = await dependencyStore.coverageFor(input.tags || [])

  return {
    tags: unique(input.tags || []),
    paths: unique([...directPaths, ...pathsFromTags]),
    graphCoverage
  }
}
```

The current Ginko `provider.invalidate(event, input)` hook returns `void`, so the revalidation caller should send already-expanded paths when the configured host adapter is path-only. A future provider API may expose `resolveInvalidation()` directly; until then, CMS publish code must do this resolution before calling `/api/_content/revalidate`.

## Revalidation Endpoint

Ginko exposes an authenticated endpoint when configured:

```ts
export default defineNuxtConfig({
  content: {
    revalidate: {
      token: process.env.GINKO_CONTENT_REVALIDATE_TOKEN!
    }
  }
})
```

Endpoint:

```txt
POST /api/_content/revalidate
```

Accepted headers:

```txt
x-ginko-revalidate-token: <token>
authorization: Bearer <token>
```

Payload:

```ts
interface RevalidationPayload {
  tags?: string[]
  paths?: string[]
}
```

Example:

```bash
curl -X POST https://site.example.com/api/_content/revalidate \
  -H 'content-type: application/json' \
  -H "x-ginko-revalidate-token: $GINKO_CONTENT_REVALIDATE_TOKEN" \
  -d '{
    "tags": ["entry:authors:alice", "collection:authors", "search:en"],
    "paths": ["/authors/alice", "/blog/post-1", "/blog/post-2", "/blog"]
  }'
```

Endpoint behavior:

- Returns `404 revalidation_disabled` when no token is configured.
- Returns `401 invalid_revalidation_token` for wrong tokens.
- Returns `400 missing_revalidation_target` when both lists are empty.
- Normalizes paths to leading slash form.
- Calls `provider.invalidate(event, input)` when implemented.
- Calls configured cache adapter `invalidate(input)` when configured.
- Returns `501 revalidation_not_supported` when nothing handled the invalidation.
- Clears Ginko's in-process search record cache after successful invalidation.

## Host Cache Adapter

CMS providers should not hardcode Vercel, Cloudflare, Fastly, or Redis into content logic.

Apps configure a `ContentCacheAdapter`.

```ts
interface ContentCacheAdapter {
  name: string
  apply(event: H3Event, hint: ContentCacheHint): void | Promise<void>
  invalidate(input: { tags?: string[], paths?: string[] }): Promise<void>
}
```

Production adapters should also document operational capabilities even if the current interface does not type them:

```ts
interface ContentCacheAdapterCapabilities {
  supportsTags: boolean
  supportsPaths: boolean
  maxTagsPerRequest?: number
  maxPathsPerRequest?: number
  consistency: 'synchronous' | 'eventual'
  partialFailure: 'fail' | 'retry' | 'best-effort'
}
```

Rules:

- Fail loudly when unsupported invalidation input is provided.
- Batch purges within platform limits.
- Surface partial failures to the publish/revalidation job.
- Public cache headers must only be applied to anonymous public responses.
- Authenticated, personalized, draft, and preview responses must use `cache: false` plus `private, no-store` or platform equivalent.
- Responses affected by cookies, authorization headers, A/B buckets, locale headers, or device variants must include correct `Vary` behavior or must not be publicly cached.

Example header adapter:

```ts
import { setHeader } from 'h3'
import {
  contentCacheHeaders,
  type ContentCacheAdapter
} from '#content/server'

export default {
  name: 'cdn-cache',
  apply(event, hint) {
    const headers = contentCacheHeaders(hint)
    for (const [name, value] of headers) {
      setHeader(event, name, value)
    }

    if (hint.tags?.length) {
      setHeader(event, 'Cache-Tag', hint.tags.join(','))
    }
  },
  async invalidate(input) {
    await cdn.purge({
      tags: input.tags,
      paths: input.paths
    })
  }
} satisfies ContentCacheAdapter
```

Vercel ISR adapter:

```ts
import { vercelContentCache } from '#content/server'

export default vercelContentCache({
  origin: process.env.NUXT_PUBLIC_SITE_URL!,
  bypassToken: process.env.VERCEL_BYPASS_TOKEN!
})
```

Important Vercel rule:

```txt
Vercel ISR is path-based.
If you send only tags, the CMS/provider must resolve tags to paths first.
```

## Publish Flow

The CMS publish pipeline should emit changed tags and affected public paths.

```ts
interface CmsPublishEvent {
  reason: 'publish' | 'unpublish' | 'delete' | 'bulk'
  collection: string
  entry: {
    id: string
    ref: string
    canonicalKey: string
    locale?: string
  }
  old?: {
    path?: string
    fields?: Record<string, unknown>
    references?: string[]
  }
  next?: {
    path?: string
    fields?: Record<string, unknown>
    references?: string[]
  }
}
```

Publish algorithm:

```ts
async function publish(event: CmsPublishEvent) {
  const revision = await cms.commitPublishedRevision(event)
  await cms.waitUntilRevisionVisible(revision)

  const changedTags = computeChangedTags(event)
  const directPaths = computeDirectPaths(event)
  const dependentPaths = await dependencyStore.pathsForTags(changedTags)
  const aggregatePaths = computeAggregatePaths(event)

  await callGinkoRevalidate({
    tags: changedTags,
    paths: unique([
      ...directPaths,
      ...dependentPaths,
      ...aggregatePaths
    ])
  })
}
```

Publish consistency rules:

- The published revision must be committed and visible to provider reads before host revalidation can regenerate pages.
- Every publish event needs a monotonic content revision or timestamp that the provider can compare against cache entries.
- Webhook/revalidation work should be written to a durable outbox before the CMS reports publish success, or the publish response must clearly report that revalidation is still pending.
- Revalidation success means provider invalidation and host invalidation completed or were durably queued with retry.
- After successful publish invalidation, affected provider caches and host caches must not intentionally serve the old published revision. Stale-while-revalidate is acceptable for time-based freshness before a known publish event, not as an excuse to serve stale content after a completed publish purge.
- If a replica, search index, or provider cache cannot see the new revision yet, do not trigger host regeneration against that stale read path.

Example `computeChangedTags`:

```ts
function computeChangedTags(event: CmsPublishEvent) {
  const tags = [
    `entry:${event.collection}:${event.entry.ref}`,
    `collection:${event.collection}`
  ]

  if (event.collection === 'authors') {
    tags.push('collection:blog')
  }

  if (event.entry.locale) {
    tags.push(`search:${event.entry.locale}`)
    tags.push(`nav:${event.collection}:${event.entry.locale}`)
  }

  tags.push('sitemap')

  return tags
}
```

Slug rename example:

```txt
old path: /blog/old-title
new path: /blog/new-title

invalidate paths:
  /blog/old-title
  /blog/new-title
  /blog
  /sitemap.xml

invalidate tags:
  entry:blog:post-1
  collection:blog
  route:/blog/old-title
  route:/blog/new-title
  search:en
  sitemap
```

Delete/unpublish example:

```txt
delete /blog/post-1

invalidate paths:
  /blog/post-1
  /blog
  /sitemap.xml

expected next request:
  /blog/post-1 -> 404
  /blog -> list without post-1
  /sitemap.xml -> no post-1
```

## Webhooks and Event Delivery

CMS publish events must be reliable, idempotent, and observable.

Recommended event envelope:

```ts
interface CmsWebhookEvent<TPayload> {
  id: string
  type: 'entry.published' | 'entry.unpublished' | 'entry.deleted' | 'asset.updated' | 'bulk.changed'
  version: 1
  siteId: string
  tenantId?: string
  contentRevision: string
  createdAt: string
  attempt: number
  idempotencyKey: string
  payload: TPayload
}
```

Delivery requirements:

- Sign every webhook body and include a timestamp to prevent replay.
- Reject events for the wrong site, tenant, environment, or branch.
- Process duplicate event IDs idempotently.
- Preserve per-entry ordering, or include revisions so older events can be ignored.
- Retry transient failures with backoff.
- Send permanently failing events to a dead-letter queue with enough context to replay.
- Cap batch sizes and split large invalidation payloads according to adapter limits.
- Record event status: received, validated, resolved, provider-purged, host-purged, failed, retried.
- Keep enough logs to answer: “Which publish invalidated this path, when, and with which tags?”

## Preview Mode

Preview must be explicit, authorized, and isolated from public caching.

Requirements:

- Preview requests may read draft versions.
- Public requests must never read draft versions.
- Preview responses must return `cache: false`.
- Preview routes must not update public route dependency maps unless marked separately.
- Preview auth belongs to the app/CMS integration, not anonymous public APIs.

Example:

```ts
async function page(event, collection, routeOrPath, options) {
  const preview = await assertPreviewSession(event).catch(() => false)
  const page = preview
    ? await cms.loadDraftPage(collection, routeOrPath, options)
    : await cms.loadPublishedPage(collection, routeOrPath, options)

  if (!page) return null

  if (preview) {
    return withContentCache(page, false)
  }

  return withContentCache(page, publicCacheHintFor(page))
}
```

Preview security checklist:

- Signed session or one-time preview token.
- Token scoped to entry, user, and expiry.
- No draft content in public search index.
- No draft content in sitemap.
- No public cache headers on preview responses.
- Draft and preview reads must use cache keys partitioned by publication channel, locale, tenant/site, preview token scope, and permission scope.
- Draft reads must never populate public provider caches, public dependency graphs, public search indexes, sitemap data, or shared route metadata caches.
- Preview dependency tracking, if needed, must be stored separately from public route dependency tracking.
- Audit log preview access in the CMS if editorial compliance matters.

## Localization

Localized collections must support route resolution by locale, fallback, and translated slugs.

Collection config:

```ts
export const docs = defineCollection({
  type: 'page',
  source: 'docs/**/*.md',
  route: {
    en: '/docs',
    de: '/dokumentation'
  },
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'de']
  },
  translatedSlugs: true
})
```

Provider requirements:

- Store locale per variant.
- Store canonical key across variants.
- Resolve localized public paths.
- Return `variants` for available translated routes.
- Return `localePaths` for all configured locales.
- Mark fallback results with `resolved.fallback: true`.
- Do not pretend fallback content is a translated variant.
- Track translation status per locale: missing, draft, in review, published, stale, archived.
- Define which fields are localized and which are shared across locales.
- Enforce slug uniqueness within a locale and route mount.
- Decide whether references and assets are localized fields or shared fields.
- Track source-locale updates that make translations stale.
- Let editors review fallback behavior instead of silently publishing missing translations.
- Emit correct `hreflang` alternatives and decide whether the app should include `x-default`.

Fallback example:

```ts
{
  locale: 'en',
  defaultLocale: 'en',
  path: '/de/dokumentation/getting-started',
  canonicalPath: '/docs/getting-started',
  variants: [
    { locale: 'en', path: '/docs/getting-started', canonicalPath: '/docs/getting-started' }
  ],
  localePaths: {
    en: { path: '/docs/getting-started', translated: true },
    de: { path: '/de/dokumentation/getting-started', translated: false, fallback: 'en' }
  },
  resolved: {
    locale: 'en',
    requestedLocale: 'de',
    fallback: true,
    fallbackLocale: 'en',
    path: '/de/dokumentation/getting-started',
    requestedPath: '/de/dokumentation/erste-schritte',
    availableLocales: ['en']
  }
}
```

## Navigation Authoring

A CMS should provide equivalent controls to filesystem `.navigation.yml` and frontmatter.

Recommended fields:

```ts
interface CmsNavigationFields {
  title?: string
  order?: number
  hidden?: boolean
  navigation?: false | {
    title?: string
    order?: number
    icon?: string
    badge?: string
  }
}
```

Rules:

- `navigation: false` removes the entry/folder subtree from nav.
- `hidden: true` hides from navigation but may keep the route public.
- `order` controls sibling order.
- Title changes must purge navigation caches.
- Visibility changes must purge navigation, affected routes, search, and sitemap when relevant.

Navigation invalidation examples:

```txt
title changed:
  tags: nav:docs:en, collection:docs
  paths: /docs

order changed:
  tags: nav:docs:en
  paths: /docs

navigation false:
  tags: nav:docs:en, search:en, sitemap
  paths: /docs, /sitemap.xml
```

## Assets

If CMS content references images or files, the provider must expose stable public URLs and dependency tags.

Recommended asset model:

```ts
interface CmsAsset {
  id: string
  url: string
  width?: number
  height?: number
  alt?: string
  caption?: string
  credit?: string
  focalPoint?: { x: number, y: number }
  mimeType: string
  size?: number
  checksum?: string
  updatedAt: string
}
```

Page field example:

```ts
{
  title: 'Launch',
  image: {
    src: 'https://cdn.example.com/assets/hero.jpg',
    alt: 'Product dashboard',
    width: 1600,
    height: 900
  }
}
```

Cache dependency:

```ts
return withContentCache(page, {
  tags: [
    'entry:blog:launch',
    'asset:hero-image'
  ],
  paths: ['/blog/launch']
})
```

Asset lifecycle requirements:

- Prefer immutable/versioned asset URLs. Replacing an image should produce a new URL or content hash.
- If URLs are mutable, the CMS must purge the asset CDN layer in addition to HTML routes that rendered `asset:{id}`.
- Store width, height, MIME type, byte size, checksum, alt text, caption, credit, and focal point when available.
- Validate uploads by MIME type, size, dimensions, and security scanning policy.
- Generate deterministic variants/transforms or include the transform params in the URL.
- Track reverse references from assets to entries.
- Deleted or private assets must not remain in public pages, search, sitemap image entries, or Open Graph metadata.

When an asset changes, invalidate routes that rendered `asset:{id}` and either emit a new immutable asset URL or purge the old binary asset URL from the asset CDN.

## Redirects

If the CMS owns redirects, keep them separate from content pages.

```ts
interface CmsRedirect {
  source: string
  destination: string
  statusCode: 301 | 302 | 307 | 308
  locale?: string
}
```

Slug changes should normally create redirects:

```txt
/blog/old-title -> /blog/new-title 301
```

Redirect cache tag:

```txt
redirects
```

A CMS provider does not currently expose redirects through the core `ContentProvider` interface. Site integrations may add a Nitro route middleware that reads CMS redirects directly.

## Provider-Owned Caches

A CMS provider should cache expensive backend reads, but must be invalidatable.

Recommended caches:

| Cache | Key | Invalidation |
|---|---|---|
| Entry cache | `entry:{collection}:{ref}:{locale}:published` | entry tag |
| Route cache | `route:{collection}:{path}:{locale}` | route path/tag |
| Query cache | normalized query JSON | collection tag |
| Navigation cache | `nav:{collection}:{locale}:{fields}` | nav tag |
| Search section cache | `search-sections:{collection}:{locale}` | search/collection tags |
| Sitemap cache | `sitemap:{locale}` | sitemap tag |
| Site data cache | `site-data:{key}:{locale}` | site-data tag |
| Dependency map | route/tag graph | changed route/tag |

Cache keys must include every dimension that can change the result:

```txt
provider name/version
site or tenant id
collection name
collection schema version/checksum
publication channel: published, draft, preview
locale and fallback policy
route path or query params
permission scope when the result is not fully public
selected fields/projection
content revision or cache generation
```

Concurrency requirements:

- Concurrent identical backend reads should share one in-flight fetch.
- Failed refresh must not poison the cache.
- Stale content may be served during refresh only when explicitly configured and only before a known publish invalidation succeeds.
- In multi-instance deployments, cache state must be shared or invalidation must broadcast to all instances.
- In-memory cache is acceptable only for development and single-instance deployments.
- In-process Ginko/runtime caches must be disabled, revision-keyed, or broadcast-invalidated in multi-instance production deployments.

Single-flight sketch:

```ts
const inFlight = new Map<string, Promise<unknown>>()

async function singleFlight<T>(key: string, load: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined
  if (existing) return existing

  const promise = load().finally(() => {
    inFlight.delete(key)
  })

  inFlight.set(key, promise)
  return promise
}
```

## Developer Experience

A CMS provider should be pleasant to adopt and easy to debug.

Recommended deliverables:

- Provider package with a typed config helper.
- Minimal Nuxt example app.
- Fixture CMS store for local development.
- Contract test suite that provider authors can run before connecting a real backend.
- CLI or script to validate CMS schema compatibility with `content.config.ts`.
- Debug mode that records provider reads, cache hits/misses, collected tags, resolved invalidation paths, and purge events.
- Typed client or generated types for CMS field names when the CMS has a schema API.
- Local webhook replay command using saved event payloads.
- Example publish webhook endpoint.
- Example Vercel ISR adapter configuration and one non-Vercel adapter example.
- Troubleshooting guide for stale page, stale nav, stale search, missing locale route, and draft leak symptoms.

Debug event example:

```json
{
  "type": "content-cache-purge",
  "eventId": "evt_123",
  "revision": "rev_456",
  "tags": ["entry:authors:alice"],
  "paths": ["/authors/alice", "/blog/post-1"],
  "providerInvalidated": true,
  "adapterInvalidated": true,
  "durationMs": 184
}
```

## Error Handling

Use `createContentProviderError()` from `#content/server`.

```ts
import { createContentProviderError } from '#content/server'

throw createContentProviderError('unknown_collection', 'Unknown collection: products', {
  collection: 'products'
})
```

Important provider errors:

| Code | When |
|---|---|
| `unknown_provider` | Configured provider name is not available |
| `unknown_collection` | Collection is not known to the provider |
| `unsupported_provider_operation` | Method is not supported |
| `unsupported_query_operator` | Query uses unsupported operator |
| `unsupported_query_shape` | Query nesting/projection/sort cannot be represented |
| `data_collection_route_access` | Caller tries to route-render data collection |
| `data_collection_search_access` | Caller tries to search unsupported data collection |
| `data_collection_sitemap_access` | Caller tries to sitemap unsupported data collection |
| `missing_locale_route` | Localized route cannot be resolved |
| `provider_config_missing` | Required provider configuration is missing |
| `provider_module_missing` | Provider module cannot be loaded |
| `provider_module_invalid` | Provider module does not satisfy the contract |
| `unsupported_provider_search_index` | Provider cannot supply requested search index behavior |
| `unsupported_provider_search` | Provider search requested but not supported |
| `unsupported_provider_site_data` | Site data requested but not supported |
| `unsupported_provider_prerender` | Provider cannot support requested prerender discovery |

Do not hide provider errors as empty results unless the correct semantic result is actually empty.

## Permissions and Access Control

Permissions are a CMS product contract. Ginko public rendering should only see already-authorized public content, but preview/editor flows need explicit access rules.

Recommended permission dimensions:

| Scope | Examples |
|---|---|
| Tenant/site | user can edit one site but not another |
| Collection | user can edit blog but not docs |
| Entry | user can edit assigned entries only |
| Locale | user can publish English but only draft German |
| Field | user can edit body but not SEO or legal disclaimers |
| Asset | user can upload images but not delete shared assets |
| Workflow | user can draft, review, publish, schedule, rollback |
| Webhook/API | integration can revalidate but cannot read drafts |

Rules:

- Public provider reads should not depend on editor identity.
- Preview provider reads must enforce user/session/token permissions before loading draft content.
- Permission-filtered results must not share cache keys with public results.
- Field-level permissions must be enforced before returning preview payloads.
- Publish, unpublish, delete, schedule, rollback, migration, and webhook replay actions must be audit logged.
- Multi-tenant CMS providers must include tenant/site in cache keys, webhook validation, dependency graphs, and search indexes.

## Security

CMS integrations commonly become privileged infrastructure. Treat the provider and publish webhook as production security surfaces.

Requirements:

- Revalidation token must be long, random, and server-only.
- Never expose CMS management API tokens to the browser.
- Validate every webhook signature before mutating provider caches.
- Verify tenant/site ID in multi-tenant CMS setups.
- Scope preview tokens to user, entry, locale, and expiry.
- Rate-limit public search if backed by a paid CMS search API.
- Do not allow arbitrary query operators to map directly to unsafe backend expressions.
- Sanitize rendered body AST from CMS rich text.
- Enforce field-level permissions before returning preview content.

Webhook signature example:

```ts
async function assertWebhookSignature(request: Request) {
  const signature = request.headers.get('x-cms-signature')
  const body = await request.text()
  const expected = await hmac(body, process.env.CMS_WEBHOOK_SECRET!)

  if (!timingSafeEqual(signature, expected)) {
    throw createError({ statusCode: 401, statusMessage: 'invalid_signature' })
  }
}
```

## Testing Requirements

### Provider Contract Tests

Every CMS provider must prove:

- `page()` returns data and correct entry/route/reference tags.
- `page()` returns `null` for missing public pages.
- `query()` honors collection filters, sorting, paging, projection, and count.
- `navigation()` returns deterministic tree order.
- `navigation()` excludes hidden/draft entries.
- `surroundings()` follows the same order as navigation.
- `searchSections()` excludes drafts and emits stable anchors.
- `search()` honors locale and collection filters when implemented.
- `siteData()` returns correct locale data when implemented.
- `sitemapEntries()` excludes non-public routes.
- `routeMeta()` resolves locale variants and fallback correctly.
- `invalidate()` purges provider-owned caches.

Ginko ships a Vitest-oriented provider contract helper for this:

```ts
import {
  createProviderFixtureEvent,
  createSaasProviderFixture
} from '@lupinum/ginko-content/testing/provider-fixture'
import {
  createAuthorDependencyContractProvider,
  runAuthorDependencyContractTest,
  runContentProviderContractSuite
} from '@lupinum/ginko-content/testing/provider-contract'

const fixture = createSaasProviderFixture()
const provider = createMyCmsProviderForFixture(fixture)

runContentProviderContractSuite({
  name: 'my-cms',
  expectedProviderName: 'my-cms',
  loadProvider: async () => provider,
  createEvent: () => createProviderFixtureEvent({ fixture, provider })
})

const authorHarness = createAuthorDependencyContractProvider()
const authorProvider = createMyCmsProviderForFixture(authorHarness.fixture)

runAuthorDependencyContractTest({
  name: 'my-cms',
  loadProvider: async () => authorProvider,
  createEvent: () => createProviderFixtureEvent({
    fixture: authorHarness.fixture,
    provider: authorProvider
  }),
  getCacheEvents: () => authorProvider.cache.events
})
```

Providers that do not use the fixture data should still mirror the same
assertions in their own suite. The important part is that provider correctness
is tested through the public Ginko Content contract, not through CMS internals.

### Cache Hint Tests

Test pure merge semantics:

- Tags dedupe and accumulate.
- Paths normalize and accumulate.
- `cache: false` wins.
- Preview/draft disables public caching.
- Shortest `maxAge` wins.
- Shortest `swr` wins.
- Newest `lastModified` wins.
- Last `etag` wins.

### Author Dependency Scenario

Fixture:

```txt
authors/alice
authors/bob
blog/post-1 references alice
blog/post-2 references alice
blog/post-3 references alice
blog/post-4 references alice
blog/post-5 references alice
blog/post-6 references bob
```

Test:

```txt
GET /blog/post-1 -> Alice
GET /blog/post-6 -> Bob
publish authors/alice.name = Alicia
POST /api/_content/revalidate
GET /blog/post-1 -> Alicia
GET /blog/post-6 -> Bob
```

Assert:

- Purge payload contains `/blog/post-1` through `/blog/post-5`.
- Purge payload does not contain `/blog/post-6`.
- Affected posts render new author name.
- Unrelated post keeps its cache.
- Search updates if search renders author names.
- Blog index updates if it renders author names.

### Provider Cache Tests

Cover:

- First read miss, second read hit.
- Concurrent requests share one backend fetch.
- Failed refresh does not poison the cache.
- Stale response can be served during refresh when configured.
- Unrelated entries do not purge unrelated route cache.
- Navigation purges when title/order/visibility changes.
- Slug changes invalidate old and new paths.
- Delete/unpublish produces 404 after invalidation.

### HTTP Integration Tests

Run a real Nuxt/Nitro fixture through HTTP:

```txt
GET /blog/post-1
POST /api/cms/publish-author
POST /api/_content/revalidate
GET /blog/post-1
GET /blog/post-6
GET /api/_content/navigation?collection=blog
GET /sitemap.xml
```

Assertions:

- Public pages change only when expected.
- Revalidation rejects missing/wrong tokens.
- Revalidation normalizes paths.
- Provider invalidate and adapter invalidate are both called.
- Cache event log records hit/miss/purge decisions.

### Multi-Instance Tests

Run two app instances against shared provider/cache state:

```txt
instance A renders /blog/post-1
instance B renders /blog/post-1
publish author update
invalidate through instance A
instance B must not serve stale provider data after invalidation
```

This is mandatory before claiming multi-instance support.

### Platform Smoke Tests

Keep tiny hosted apps per platform adapter.

For Vercel ISR:

- First request generates route.
- Second request is cached by ISR.
- Revalidation request succeeds.
- Next request returns fresh content.
- Cache status headers match expected platform behavior.

Run platform smoke tests nightly or before adapter releases, not on every PR.

## Minimal CMS Provider Skeleton

```ts
import {
  createContentProviderError,
  withContentCache,
  type ContentProvider
} from '#content/server'

export default {
  name: 'cms',
  capabilities: {
    routeBackedCollections: true,
    dataCollections: true,
    localizedRoutes: true,
    translatedSlugs: true,
    navigation: true,
    surroundings: true,
    searchSections: true,
    sitemap: true,
    query: {
      operators: ['$eq', '$ne', '$in', '$contains', '$gt', '$gte', '$lt', '$lte'],
      sort: 'supported',
      projection: 'supported',
      limit: true,
      skip: true,
      count: true
    }
  },

  async query(event, query) {
    const result = query.count
      ? await cms.countPublished(query)
      : query.first
        ? { result: await cms.queryFirstPublished(query) }
        : await cms.queryPublished(query)

    return withContentCache(result, {
      tags: query.collection ? [`collection:${query.collection}`] : [],
      maxAge: 300,
      swr: 60
    })
  },

  async page(event, collection, routeOrPath = '/', options = {}) {
    const page = await cms.loadPage({ collection, routeOrPath, ...options })
    if (!page) return null
    const references = await cms.loadRenderedReferences(page)

    return withContentCache(page, {
      tags: [
        `entry:${collection}:${page.ref}`,
        `collection:${collection}`,
        `route:${page.path}`,
        ...references.map(ref => `entry:${ref.collection}:${ref.ref}`)
      ],
      paths: [page.path],
      maxAge: 300,
      swr: 60,
      lastModified: new Date(page.updatedAt)
    })
  },

  async routeMeta(event, collection, routeOrPath = '/', options = {}) {
    return await cms.loadRouteMeta({ collection, routeOrPath, ...options })
  },

  async navigation(event, collection, options = {}) {
    const nav = await cms.loadNavigation({ collection, ...options })
    return withContentCache(nav, {
      tags: [`nav:${collection}:${options.locale || 'default'}`, `collection:${collection}`],
      maxAge: 300
    })
  },

  async navigationQuery(event, query) {
    const nav = await cms.loadNavigation({
      collection: query.collection,
      locale: query.resolveLocale?.locale,
      fields: query.only
    })
    return withContentCache(nav, {
      tags: query.collection
        ? [`nav:${query.collection}:${query.resolveLocale?.locale || 'default'}`, `collection:${query.collection}`]
        : [`nav:all:${query.resolveLocale?.locale || 'default'}`],
      maxAge: 300
    })
  },

  async surroundings(event, collection, path, options = {}) {
    return await cms.loadSurroundings({ collection, path, ...options })
  },

  async searchSections(event, collection, options = {}) {
    const sections = await cms.loadSearchSections({ collection, ...options })
    return withContentCache(sections, {
      tags: [`search:${options.locale || 'default'}`, `collection:${collection}`],
      maxAge: 600
    })
  },

  async search(event, request) {
    return await cms.search(request)
  },

  async siteData(event, request) {
    const data = await cms.loadSiteData(request)
    return withContentCache(data, {
      tags: [`site-data:${request.key}:${request.locale || 'default'}`],
      maxAge: 600
    })
  },

  async sitemapEntries(event, options = {}) {
    const entries = await cms.loadSitemapEntries(options)
    return withContentCache(entries, {
      tags: ['sitemap'],
      paths: ['/sitemap.xml'],
      maxAge: 600
    })
  },

  async invalidate(event, input) {
    await cms.cache.invalidate(input)
  }
} satisfies ContentProvider
```

## Walking Skeleton Acceptance Criteria

A minimal CMS integration is acceptable when it can demonstrate:

- One route-backed `blog` collection.
- One route-backed or data `authors` collection.
- `blog.author` references `authors`.
- `page()` renders author name on posts.
- `query()` renders blog index.
- `navigation()` renders blog navigation.
- `searchSections()` includes blog content.
- `sitemapEntries()` includes public posts.
- `withContentCache()` emits entry, collection, route, search, nav, and sitemap tags.
- Publish Alice name change invalidates posts that reference Alice.
- Bob post is not purged.
- Revalidation endpoint requires a token.
- Provider cache and adapter cache events are observable.

## Production Readiness Checklist

Before calling a CMS provider production-ready:

- Public requests cannot leak drafts.
- Preview requests cannot be publicly cached.
- Unknown collections and unsupported query shapes fail clearly.
- Query sorting and paging are stable.
- Locale fallback metadata is truthful.
- Navigation, search, and sitemap use identical visibility rules.
- References produce dependency tags.
- Publish events include old and new paths for slug changes.
- Delete/unpublish invalidates route, indexes, nav, search, and sitemap.
- Provider caches are shared or invalidation is broadcast in multi-instance deploys.
- Host cache adapter is configured for the deployment platform.
- Revalidation token is configured and tested.
- Webhook signature verification is implemented.
- Contract tests cover provider methods.
- HTTP integration tests cover publish/revalidate/read.
- Platform smoke test exists for each cache adapter.

## Non-Goals

These features may be useful, but they do not belong in Ginko core:

- CMS authoring UI.
- Editorial workflow engine.
- CMS user/role database.
- CMS-specific rich text editor state.
- Provider-specific Redis schema.
- Provider-specific Vercel or CDN code.
- Generic asset DAM.
- Global webhook processing framework.

They belong in the CMS/provider package or the site app.

## Final Architecture

The final mature system should look like this:

```txt
CMS publish
  -> computes changed entries, old paths, new paths, reference changes
  -> resolves changed tags to affected routes
  -> calls Ginko revalidation endpoint with exact tags + paths

Content provider
  -> serves published content through query/page/navigation/search/sitemap
  -> returns cache hints for every content read
  -> invalidates provider-owned caches by tags/paths

Ginko runtime
  -> merges request-local hints
  -> applies configured cache adapter
  -> rejects unsafe revalidation requests

Host adapter
  -> applies CDN/runtime/ISR caching
  -> purges exact paths/tags supported by the platform
```

If a CMS builder implements this contract, the result should feel native to Ginko sites while remaining independent of any one CMS, cache store, or hosting platform.
