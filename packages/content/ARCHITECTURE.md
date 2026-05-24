# Ginko Package Architecture

This package contains Ginko Core and the default filesystem provider. The core runtime is provider-neutral; the filesystem provider is the maintained default source today.

## Layering

`src/core`
- Pure content domain logic.
- No Nuxt, H3, Nitro, or Vue imports.
- Owns query planning/execution, content graphs, reference resolution, and typed content errors.

`src/features`
- User-facing content capabilities built on top of `core`.
- Owns collection resolution, navigation shaping, search section generation, and locale-aware result shaping.
- Still framework-free.

`src/storage`
- Content source, parsed artifact cache, manifest, reference enrichment, and validation orchestration.
- May depend on `core`, `features`, and `integrations`, but should not depend on `runtime`.
- Owns filesystem-provider storage behavior, not a generic CMS data model.

`src/integrations`
- Platform bindings.
- `nitro` owns request-scoped runtime context and server-side dependency access.
- `nitro` owns runtime config, preview state, scoped storage adapters, and ingest hooks.
- `vue` owns component discovery and renderer integration.

`src/parsers`
- Parser-facing entrypoints for markdown, yaml, json, and csv content ingestion.

`src/runtime`
- Integration entrypoints consumed by the existing public package contract.
- Should stay thin. If logic starts accumulating here, it probably belongs in `core`, `features`, or `integrations`.

`src/public`
- Export-facing facades for `@lupinum/ginko-content/*` package subpaths.
- Provider types live here when external providers need to implement them.

## Dependency Rules

Allowed direction:
1. `core` -> nothing package-specific outside `types`
2. `features` -> `core`, `types`
3. `integrations` -> `features`, `core`, `types`
4. `storage` -> `integrations`, `features`, `core`, `types`
5. `runtime` -> `storage`, `integrations`, `features`, `core`, `types`

Disallowed direction:
- `core` importing from `runtime`
- `features` importing from `runtime`
- `storage` importing from `runtime`
- `core` importing Nitro/Vue/Nuxt modules
- new generic `utils` directories for domain logic

## Ingest Model

The content ingest flow is:
1. parse
2. transform
3. validate

The fixed ingest sequence lives in `src/integrations/nitro/ingest.ts`. Do not
add a generic pipeline abstraction unless a second real caller needs it.

## Query Model

The query system is split into:
- `src/core/query/builder.ts`
- `src/core/query/params.ts`
- `src/core/query/plan.ts`
- `src/core/query/lower.ts`
- `src/core/query/execute.ts`
- `src/core/query/operators.ts`

The builder is immutable — every chainable method returns a fresh builder.
The lowered plan is the stable internal representation.
Shared query normalization helpers live next to the query model, not in runtime helpers.

## Request Context

Request-scoped runtime state lives in `src/integrations/nitro/context.ts`.
It owns:
- runtime config
- scoped storages
- memoized contents/graph artifacts
- request-local clock access

Nothing else should create parallel request caches.

## Public Surface

Public package exports remain:
- `@lupinum/ginko-content`
- `@lupinum/ginko-content/config`
- `@lupinum/ginko-content/client`
- `@lupinum/ginko-content/server`
- `@lupinum/ginko-content/toc`
- `@lupinum/ginko-content/transformers`

Those export paths are compatibility commitments.
Internal source layout should optimize for clarity, not mirror the export map.

## Search

Collection search-section generation remains in this package under `src/features/search`.
Full-text search transport, indexing, and runtime bindings also live in this package under `src/runtime`.

MiniSearch and Pagefind are filesystem/default-provider search paths. Provider-owned search is selected through the `cms` search engine and delegates to the active provider.

## Providers

Server-side content access should dispatch through `getContentProvider(event)` and the `ContentProvider` contract. API handlers should not branch on provider names.

The filesystem provider maps files, frontmatter, folders, numeric prefixes, and `.navigation.yml` into normalized content results. Future CMS or custom providers should map their own native records into the same contract instead of making core code understand their storage model.

New contributors should start with `packages/content/docs/ONBOARDING.md`.
