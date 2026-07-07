# Abstractions

This document names the concepts behind Ginko. It is written for contributors and advanced users who need to understand how the public APIs map to the implementation.

## Ginko Core

The provider-neutral Nuxt content engine in this repository.

Ginko Core owns the public website contract: collections, query builders, content pages, navigation, search sections, sitemap entries, rendering components, and server helpers.

Core should not contain editor UI, Studio workflows, MCP tools, runtime mutation APIs, or CMS-specific editorial behavior.

## Provider

A server-side adapter that serves the Ginko content contract from a source.

The built-in provider is `filesystem`. External providers can be registered through `content.config.ts` and loaded through `#content/virtual/providers`.

Providers implement `ContentProvider` from `@lupinum/ginko-content/server` / `#content/server`. They expose capabilities and methods for query, page, route metadata, navigation, surroundings, search sections, site data, and sitemap entries.

## Filesystem Provider

The default provider. It maps files under `content/` into normalized content results.

Filesystem-specific concepts include:

- Markdown and MDC files
- YAML, JSON, JSON5, and CSV data
- frontmatter
- `_navigation.yml`
- numeric prefixes
- `.draft` files
- underscore partials
- translated slug identity through numeric prefix chains

These details are first-class for the filesystem provider, but they must not leak into the provider contract as requirements for every future provider.

## Future Ginko CMS Provider

A planned external provider/product, not part of this repository.

The CMS provider should map database-backed published content, route records, and publish state into the same normalized website contract that the filesystem provider serves today.

The CMS may have Studio, admin, MCP, identity, permissions, and real-time workflows. Ginko Core should only see the published provider contract.

## Content File

A source file under `content/`, usually Markdown or MDC but also YAML, JSON, JSON5, or CSV.

For the filesystem provider, content files are the source of truth. Downstream artifacts are derived from them: parsed content, manifests, query results, navigation, search sections, and sitemap entries.

## Collection

A named, typed group of content declared in `content.config.ts`.

```ts
export const docs = defineCollection({
  type: 'page',
  source: 'docs/**/*.md',
})

export default defineContentConfig({
  collections: { docs },
})
```

Collections are the public query boundary. App code queries a collection through its handle rather than querying an implicit global content bag.

## Route-Backed Collection

A collection whose entries can become public pages, such as docs, blog posts, product pages, and legal pages.

Route-backed collections can participate in page resolution, navigation, search, surroundings, and sitemap output.

## Data Collection

A collection that can be queried or referenced but does not own public page routes by default, such as authors, categories, teams, or shared data blocks.

Data collections default to `sitemap: false`. Route-only operations against a data collection should fail clearly unless the collection explicitly supports the requested behavior.

## Ingest Pipeline

The flow that turns source content into queryable documents:

1. Parse file bytes.
2. Transform the parsed result.
3. Validate against the collection schema.
4. Store normalized artifacts for query, routing, navigation, search, and sitemap use.

Generic contracts live in `src/core/pipeline`. Nitro orchestration lives in `src/integrations/nitro/ingest.ts`.

## Canonical Identity

A locale-agnostic document identity used internally to connect variants of the same content.

Authors do not write canonical keys. The filesystem provider derives them from paths in shared-slug mode or numeric-prefix chains in translated-slug mode. A future CMS provider should use stable CMS entry IDs.

Canonical identity powers language switching, fallback, navigation merging, route metadata, and sitemap alternates.

## Variant

One locale's version of a canonical document.

Variant resolution answers: "for this canonical document and requested locale, which concrete document should be served?"

Single-document resolution can fall back. List queries do not mix fallback locales by default.

## Query

An immutable, declarative description of requested content.

```ts
const posts = await many(blog, {
  where: { published: true },
  sort: { date: 'desc' },
  limit: 10
})
```

The public options lower to an internal query plan. Providers may support different subsets of operators, but unsupported shapes must fail with typed provider errors.

## Content Page

A route-backed page resolved from a collection.

`useContentOne(handle, { by: { route } })` is the preferred app-facing page loader. It resolves the current route, active locale, fallback state, page data, and route metadata through one workflow.

## Navigation

A tree derived from provider content.

The filesystem provider builds navigation from files, numeric prefixes, `index.md`, and `.navigation.yml`. A CMS provider can build the same normalized tree from route and navigation records.

Apps should consume the normalized result, not provider-native metadata.

## Search Sections

Provider-produced chunks used to build search.

The filesystem provider creates heading-scoped sections from parsed content. Built-in search can use MiniSearch or Pagefind. A provider can also own search directly through `engine: 'cms'`.

## Sitemap Source

Ginko produces content-backed sitemap entries. `@nuxtjs/sitemap` owns XML generation, hreflang rendering, sitemap indexes, and robots integration.

## Public Surface

`meta/public-surface.json` is the single source of truth for committed package
subpaths and exported symbols; everything else is internal unless that file
documents it as public.
