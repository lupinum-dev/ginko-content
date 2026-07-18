# Architecture

Ginko is a Nuxt module with a provider-neutral core and a first-class filesystem provider.

The implementation should keep domain logic framework-light, provider dispatch explicit, and public APIs stable. Filesystem content is the default user experience today. External providers are an architectural boundary, not a reason to make beginner docs or common app code provider-heavy.

## Source Layout

All package source lives under `packages/content/src/`.

```txt
src/
  core/          pure domain logic
  features/      framework-free capabilities built on core
  storage/       filesystem content, parsed artifacts, manifest, validation
  integrations/  Nitro and Vue bindings
  module/        Nuxt module setup helpers
  parsers/       markdown, yaml, json, csv entrypoints
  runtime/       Nuxt/Nitro runtime entrypoints
  public/        package export facades
  types/         shared type definitions
  utils.ts       small cross-cutting helpers
  config.ts      public config exports
  module.ts      Nuxt module entrypoint
```

The layout is a constraint, not decoration. Domain behavior should not accumulate in runtime entrypoints or generic utility folders.

## Layering Rules

Allowed dependency direction:

1. `core` -> `types`
2. `features` -> `core`, `types`
3. `integrations` -> `features`, `core`, `types`
4. `storage` -> `integrations`, `features`, `core`, `types`
5. `runtime` -> `storage`, `integrations`, `features`, `core`, `types`
6. `public` -> stable export facades over runtime/config/server/provider APIs

Disallowed:

- `core` importing from `runtime`
- `features` importing from `runtime`
- `storage` importing from `runtime`
- `core` importing Nitro, Vue, Nuxt, or H3 APIs
- provider-specific branching in API handlers when the provider contract can dispatch
- new generic `utils` directories that hide domain logic

## Module Setup

`src/module.ts` is the Nuxt module entrypoint. It validates that the app has a `content.config.ts` with collections, resolves module options, wires runtime config, registers templates, registers runtime imports/components, and installs Nitro handlers/plugins.

Large setup concerns belong in `src/module/*`, not inline in `module.ts`.

Important module-time boundaries:

- `content.config.ts` owns collections, providers, schemas, and references.
- `nuxt.config.ts` `content` owns runtime behavior: i18n, sitemap, search, markdown, watch, sources, and provider selection.
- Virtual provider templates load external providers by configured provider name.

## Provider Dispatch

Server-side content access goes through `getContentProvider(event)`.

The default provider is `filesystem`. External providers are registered by name in `content.config.ts` and are loaded through generated virtual provider modules.

API handlers and public server helpers should call the provider contract uniformly:

```txt
request -> getContentProvider(event) -> provider method -> normalized result
```

They should not branch on provider names. Provider capabilities and typed provider errors are the extension boundary.

## Filesystem Provider

The filesystem provider maps content files into the normalized content contract.

It owns filesystem-specific behavior:

- file and folder routing
- `.navigation.yml`
- `index.md` folder metadata
- numeric ordering prefixes
- draft and partial conventions
- Markdown/MDC/YAML/JSON/CSV parsing
- filesystem-derived canonical identity
- translated-slug numeric-prefix identity

These are not requirements for every provider. A CMS provider should map its native route records, published projections, and navigation model into the same normalized results.

## Ingest And Storage

Ingest follows parse -> transform -> validate.

- fixed ingest sequence: `src/integrations/nitro/ingest.ts`
- Nitro orchestration: `src/integrations/nitro/ingest.ts`
- parser entrypoints: `src/parsers`
- validation: `src/storage/validation.ts`
- canonical graph and variant lookup: `src/storage/graph.ts`

The storage layer answers "what content exists?" for the filesystem provider. It should not become a generic CMS data model.

## Query Model

Public query options compile through a params IR into stable internal plans.

- normalized params: `src/core/query/params.ts`
- lowered plan: `src/core/query/plan.ts`
- lowering: `src/core/query/lower.ts`
- execution: `src/core/query/execute.ts`
- operators: `src/core/query/operators.ts`

Public app queries use collection handles with the unified API: `one(handle, options)`, `many(handle, options)`, `resolveOne(handle, options)`, `navigation(handle, options)`, and `surround(handle, options)`. Server code uses the same verbs with the active H3 event as the first argument.

Provider-backed query behavior must respect declared capabilities. Unsupported operators or unsupported query shapes should fail with typed provider errors rather than silently degrading.

## Locale Resolution

Locale behavior is part of the core content model.

When `@nuxtjs/i18n` is installed, it is the locale source of truth. Ginko adds content-specific behavior: fallback chains, translated slug mode, strict translated-slug validation, and collection-level i18n opt-in.

Rules:

- Single-document page resolution is locale-aware with fallback by default.
- List queries do not mix fallback locales by default.
- Route-less server contexts have no hidden ambient locale.
- Language switching uses canonical identity, not string prefix swapping.
- Shared-slug and translated-slug modes both resolve through canonical identity.

## Navigation, Surroundings, And Pages

App code should prefer:

- `useContentPage(handle)` for route-backed page loading
- `navigation(handle)` for collection navigation
- `page.route.alternates` for locale-aware route switching after resolving a document
- `many(handle, options)` for explicit lists and filters

Lower-level server collection helpers can exist internally, but the public package server surface stays intentionally small.

## Search

Ginko supports three search modes:

- MiniSearch JSON index for small-to-medium static/runtime use
- Pagefind for static, sharded search
- provider-owned search via `engine: 'provider'`

The built-in filesystem search path derives search sections from parsed content. Provider-owned search should not force non-filesystem data into local static indexes.

Search is not a reason to add native runtime database dependencies to core.

## Sitemap

Ginko owns content-backed sitemap entries. `@nuxtjs/sitemap` owns XML output, hreflang rendering, sitemap indexes, and robots integration.

The module registers a content sitemap source when sitemap support is enabled. Content collections are included unless config excludes them or the collection is data-only and not opted in.

For localized sources, Ginko projects canonical variants into the Nuxt Sitemap v8
source-entry contract: every entry carries its locale sitemap name in `_sitemap`
and the complete reciprocal hreflang set, including `x-default` when a default
variant exists. Nuxt Sitemap partitions those entries into locale child XML
sitemaps. Docs layers and consumers must not reconstruct or filter that identity.

## Public Surface

The package export map is a compatibility commitment:

- `@lupinum/ginko-content`
- `@lupinum/ginko-content/config`
- `@lupinum/ginko-content/client`
- `@lupinum/ginko-content/server`
- `@lupinum/ginko-content/provider`
- `@lupinum/ginko-content/agent`
- `@lupinum/ginko-content/agent-paths`
- `@lupinum/ginko-content/agent-registry`
- `@lupinum/ginko-content/cms-contract`
- `@lupinum/ginko-content/data-source`
- `@lupinum/ginko-content/portability`
- `@lupinum/ginko-content/portability/node`
- `@lupinum/ginko-content/testing/provider-fixture`
- `@lupinum/ginko-content/testing/provider-contract`
- `@lupinum/ginko-content/transformers`

The package manifest, explicit facade modules, generated API reference, and
package contracts enforce this list without a duplicate symbol inventory.
Public docs must match these exports. Internal runtime, storage, manifest,
renderer, and provider loader details should stay private unless deliberately promoted.

## Extension Rules

When adding a feature:

1. Put pure domain behavior in `core` or `features`.
2. Put Nitro/Vue/Nuxt coupling in `integrations` or `runtime`.
3. Put filesystem-specific behavior in the filesystem provider/storage path.
4. Put provider-neutral behavior behind the provider contract.
5. Add provider capabilities and typed provider errors for unsupported cases.
6. Update ADRs when the decision changes the product boundary or public contract.
