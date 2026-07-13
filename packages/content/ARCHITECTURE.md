# Ginko Package Architecture

This package contains Ginko Core and the default filesystem provider. The core runtime is provider-neutral; the filesystem provider is the maintained default source today.

The source layout is layered by **framework coupling** and **dependency direction**, not by feature. The rule of thumb for "where does this file live?" is: how framework-bound is it, and what may it import? The tables below answer both. The load-bearing edges are enforced by `test/unit/architecture-boundaries.test.ts` — this document must agree with that test.

## Source tree (every top-level directory)

`packages/content/src/` has fifteen top-level homes. Each row states what lives there and which other top-level homes it may import from.

| Directory | What lives here | May import from |
|---|---|---|
| `types/` | Shared type definitions only. The leaf of the graph. | (nothing) |
| `utils/` | Small cross-cutting helpers (e.g. content-config loading). No domain logic. | `types` |
| `core/` | Pure content domain logic: query planning/execution (`core/query`), the content graph and paths (`core/content`), reference resolution (`core/references`), markdown domain helpers (`core/markdown`), cache hints, and typed content errors. No Nuxt, H3, Nitro, or Vue. | `types` |
| `parsers/` | Format entrypoints for markdown, yaml, json, and csv ingestion, plus path-meta derivation and the reserved-frontmatter-key guard. | `core`, `types` |
| `features/` | User-facing content capabilities composed from `core` (and each other). Subdirs: `collections`, `localization`, `navigation`, `search`, `sitemap`, `query` (the query-composition layer — composes `core/query` with `features/localization`), and `agent` (the LLM markdown output feature). Framework-free. | `core`, `types`, `features` |
| `storage/` | Filesystem-provider state: content source, parsed-artifact cache, manifest, snapshot runtime, reference enrichment, and validation orchestration. | `core`, `features`, `integrations`, `types` |
| `integrations/` | Platform bindings. `nitro` owns request-scoped runtime context, runtime config, preview state, scoped storage adapters, and ingest hooks; `vue` owns component discovery and renderer integration. | `core`, `features`, `types` (+ `storage` for ingest, + `public` type-only) |
| `module/` | Nuxt module setup/build-time code: options resolution, virtual files, Nitro config, server-handler registration, static output, route-meta validation. Runs at build, not per request. | `types`, `core`, `features`, `parsers`, `utils` (+ one thin `runtime` sitemap-source helper) |
| `runtime/` | Thin Nuxt/Nitro/Vue entrypoints: app composables, server API handlers, middleware, markdown/transformer runtime, virtual bindings. Should stay thin — accumulating logic here is a smell. | all internal layers + `public` |
| `public/` | Export-facing facades for the `@lupinum/ginko-content/*` package subpaths (`client`, `server`, `provider`, `provider-query`, `provider-errors`). Provider types live here for external providers to implement. | `runtime`, `features`, `core`, `types` |
| `config.ts` | Source of the `@lupinum/ginko-content/config` subpath: authoring/schema exports (`defineCollection`, `defineContentConfig`, field builders, `slugifyUrlSegment`). | `core`, `types` |
| `cms-contract/` | The runtime-safe resolved content contract, canonical JSON/SHA-256, schema helpers, MDC, and path surface shared by portability and CMS. | `core`, `types` |
| `cms-import/` | The CMS import surface. | `core`, `parsers`, `types` |
| `cli/` | The `doctor` CLI. | `core`, `parsers`, `types` |
| `testing/` | The provider conformance suite and the default provider fixture (`testing/provider-fixture`, `testing/provider-contract`). | `core`, `features`, `public`, `runtime`, `types` |

`cli.ts`, `module.ts`, `utils.ts`, and `config.ts` at the root of `src/` are thin barrels/entrypoints over the like-named directories (or, for `config.ts`, the standalone subpath entry).

## Dependency rules

The layering forms a one-directional graph. The enforced invariants (checked by the boundary test) are the load-bearing ones — break these and the build fails:

1. `core` imports only `types` — never `features`, never `runtime`, never Nitro/Vue/Nuxt/`#imports`.
2. `features` never import `runtime`. Feature-to-feature imports are allowed (e.g. `features/query` and `features/navigation` compose `features/localization`).
3. `storage` never imports `runtime` (nor `module`, `public`, or `cli`).

The remaining edges are conventional (not machine-checked) but hold in the tree:

- `parsers` → `core`, `types`.
- `integrations` → `core`, `features`, `types`; plus `storage` (the ingest hook calls `storage/validation`) and a type-only reach into `public` for the cache-hint contract.
- `runtime` sits at the top: it may import every internal layer and `public`.
- `module` composes `core`, `features`, `parsers`, `utils`, and `types` at build time, plus one narrow `runtime` sitemap-source helper.
- `public` composes `runtime`, `features`, `core`, `types` into export facades.
- `cms-contract` → `core`, `types`; `cms-import` → `core`, `parsers`, `types`; `cli` → `core`, `parsers`, `types`; `config.ts` → `core`, `types`.
- `testing` may reach `core`, `features`, `public`, `runtime`, `types` (it exercises the public seam).

Disallowed, always:

- `core` importing from `runtime`, `features`, or `module`.
- `features` or `storage` importing from `runtime`.
- `core` importing Nitro/Vue/Nuxt modules.
- new generic `utils/` directories holding domain logic (domain logic belongs in `core` or `features`).

A new file's home is decided top-down: is it a pure domain fact (`core`)? a domain capability composed from core (`features`)? filesystem-provider state (`storage`)? a framework binding (`integrations`)? a thin app/server entry (`runtime`)? build-time setup (`module`)? an export facade (`public`)? If it needs Nuxt/H3/Nitro/Vue, it cannot be in `core` or `features`.

## Ingest Model

The content ingest flow is:
1. parse
2. transform
3. validate

The fixed ingest sequence lives in `src/integrations/nitro/ingest.ts`. Do not
add a generic pipeline abstraction unless a second real caller needs it.

## Query Model

Query lives in two layers:

- `src/core/query` — the pure compile/execute machinery: `builder.ts`, `params.ts`, `plan.ts`, `lower.ts`, `execute.ts`, `operators.ts`. The builder is immutable — every chainable method returns a fresh builder. The lowered plan is the stable internal representation.
- `src/features/query` — the query-*composition* layer (moved here from `runtime/query`): it composes `core/query` (pure planning/execution) with `features/localization` (locale shaping) to produce the shaped results the runtime entrypoints serve. It is framework-free but feature-consuming, which is exactly why it lives in `features/`, not `core/` (`core` may not import `features`).

Shared query normalization helpers live next to the query model, not in runtime helpers.

## LLM markdown output

The LLM markdown output feature (`/raw/*.md`, `/llms.txt`, `/llms-full.txt`, and the component→markdown serializers) is split across two homes:

- `src/features/agent` — the framework-free half: the serializer types, the per-app serializer registry (`createAgentMarkdownRegistry`), the pure render walker (`renderAgentMarkdownBody(body, context)`), the pure link/image/xml/json helpers, and the path helpers. It reads no config directly — everything it needs arrives on the `AgentMarkdownContext` the caller builds.
- `src/runtime/server/agent-markdown.ts` — the thin config-bound half: the H3 handlers that build the context from `contentConfig()` plus the per-app registry, and the public registration convenience functions.

The code identifiers stay `agent` (the shipped module option is `agent: {...}`); "LLM markdown output" is the prose name for the same feature.

Agent output does not own a parallel locale configuration. All localized
agent pages and routes derive from the resolved content locale policy;
`agent.site` contains presentation and identity fields only.

## Request Context

Request-scoped runtime state lives in `src/integrations/nitro/context.ts`.
It owns:
- runtime config
- scoped storages
- memoized contents/graph artifacts
- request-local clock access

Nothing else should create parallel request caches.

Client query contexts follow the same ownership rule. Nuxt-bound request
capabilities (`useRequestFetch` and the preview cookie token) are captured once
when the context is created. Nested operations such as reference population
reuse those captured values; they must not call Nuxt composables after an async
boundary, where Vue setup context is no longer guaranteed.

## Public Surface

Public package exports are the compatibility seam. Current subpaths:
- `@lupinum/ginko-content`
- `@lupinum/ginko-content/config`
- `@lupinum/ginko-content/server`
- `@lupinum/ginko-content/provider`
- `@lupinum/ginko-content/client`
- `@lupinum/ginko-content/agent`
- `@lupinum/ginko-content/agent-paths`
- `@lupinum/ginko-content/agent-registry`
- `@lupinum/ginko-content/cms-contract`
- `@lupinum/ginko-content/cms-import`
- `@lupinum/ginko-content/testing/provider-fixture`
- `@lupinum/ginko-content/testing/provider-contract`
- `@lupinum/ginko-content/transformers`

Internal source layout should optimize for clarity, not mirror the export map.
`meta/public-surface.json` classifies every committed package subpath,
client/server facade export, and generated app auto-import with category,
audience, and docs target.

## Search

Collection search-section generation remains in this package under `src/features/search`.
Full-text search transport, indexing, and runtime bindings also live in this package under `src/runtime`.

MiniSearch and Pagefind are filesystem/default-provider search paths. Provider-owned search is selected through the `provider` search engine and delegates to the active provider.

## Providers

Server-side content access should dispatch through `getContentProvider(event)` and the `ContentProvider` contract. API handlers should not branch on provider names.

The filesystem provider maps files, frontmatter, folders, numeric prefixes, and `.navigation.yml` into normalized content results. Future CMS or custom providers should map their own native records into the same contract instead of making core code understand their storage model.

New contributors should start with `packages/content/docs/ONBOARDING.md`.
