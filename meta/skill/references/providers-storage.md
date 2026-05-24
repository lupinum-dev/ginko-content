# Providers, Storage, And Layering

Use this for provider work, filesystem ingestion, parser/storage changes, server runtime handlers, and architecture-sensitive refactors.

## Source Layout Constraint

All package source lives under `packages/content/src/`.

```txt
core/          pure domain logic
features/      framework-free capabilities built on core
storage/       filesystem content, parsed artifacts, manifest, validation
integrations/  Nitro and Vue bindings
module/        Nuxt module setup helpers
parsers/       markdown, yaml, json, csv entrypoints
runtime/       Nuxt/Nitro runtime entrypoints
public/        package export facades
types/         shared type definitions
utils/         small cross-cutting helpers
config.ts      public config exports
module.ts      Nuxt module entrypoint
```

Do not let domain behavior accumulate in runtime entrypoints or generic utility folders.

## Layering Rules

Allowed direction:

1. `core` -> `types`
2. `features` -> `core`, `types`
3. `integrations` -> `features`, `core`, `types`
4. `storage` -> `integrations`, `features`, `core`, `types`
5. `runtime` -> `storage`, `integrations`, `features`, `core`, `types`
6. `public` -> stable export facades

Disallowed:

- `core` importing Nitro, Vue, Nuxt, H3, or runtime code.
- `features` or `storage` importing from `runtime`.
- API handlers branching by provider name when the provider contract can dispatch.
- New generic `utils` directories that hide domain behavior.

## Provider Dispatch

Server-side content access goes through `getContentProvider(event)`.

```txt
request -> getContentProvider(event) -> provider method -> normalized result
```

The default provider is `filesystem`. External providers are registered by name in `content.config.ts` and loaded through generated virtual provider modules.

Handlers and public server helpers should call provider methods uniformly. Provider capabilities and typed provider errors are the extension boundary.

## Provider Contract

Providers implement `ContentProvider` from `@lupinum/ginko-content/server` or `#content/server`.

Important provider capabilities include:

- `routeBackedCollections`
- `dataCollections`
- `localizedRoutes`
- `translatedSlugs`
- `navigation`
- `surroundings`
- `searchSections`
- `sitemap`
- query capabilities: operators, sort, projection, limit, skip, count

Provider methods cover query, page, route metadata, navigation, surroundings, search sections, optional direct search, optional site data, and sitemap entries.

Unsupported behavior should fail with typed provider errors such as:

- `unknown_provider`
- `unknown_collection`
- `unsupported_provider_operation`
- `unsupported_query_operator`
- `unsupported_query_shape`
- `data_collection_route_access`
- `data_collection_search_access`
- `data_collection_sitemap_access`
- `missing_locale_route`
- `provider_config_missing`
- `provider_module_missing`
- `provider_module_invalid`
- `unsupported_provider_search_index`
- `unsupported_provider_search`
- `unsupported_provider_site_data`
- `unsupported_provider_prerender`

Use `createContentProviderError` for stable provider errors.

## Filesystem Provider Responsibilities

The filesystem provider maps files under `content/` into normalized content results. It owns:

- Markdown and MDC parsing
- YAML, JSON, JSON5, and CSV data
- frontmatter
- `.navigation.yml`
- `index.md`
- numeric prefixes
- `.draft` files
- underscore partials
- filesystem-derived canonical identity
- translated slug identity through numeric prefix chains

Do not leak these as universal provider requirements.

## Ingest Pipeline

Ingest follows:

1. Parse file bytes.
2. Transform parsed result.
3. Validate against the collection schema.
4. Store normalized artifacts for query, routing, navigation, search, and sitemap use.

Important locations:

- generic pipeline contracts: `packages/content/src/core/pipeline`
- Nitro orchestration: `packages/content/src/integrations/nitro/ingest.ts`
- parser entrypoints: `packages/content/src/parsers`
- validation: `packages/content/src/storage/validation.ts`
- manifest and variant lookup: `packages/content/src/storage/manifest.ts`

## Product Boundary

Ginko core should not include editor UI, Studio workflows, MCP tools, runtime mutation APIs, CMS-specific editorial behavior, uploads, permissions, or database-backed draft state.

A future CMS provider should map published content, route records, and navigation models into the normalized provider contract from a separate package or product.

## Where To Verify

- `test/contracts/provider-contracts.test.ts`
- `test/contracts/filesystem-provider-conformance.test.ts`
- `test/contracts/storage-contracts.test.ts`
- `test/contracts/storage-access-contracts.test.ts`
- `test/contracts/collection-resolvers-contracts.test.ts`
- `test/contracts/graph-contracts.test.ts`
- ADRs `adr/0010-*`, `adr/0012-*`, `adr/0013-*`, and `adr/0014-*`
