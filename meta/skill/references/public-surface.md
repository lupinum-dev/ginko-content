# Public Surface

Use this when changing imports, exports, docs snippets, package boundaries, or public API names.

## Package Identity

- Package name: `@lupinum/ginko-content`.
- Nuxt module registration should use `@lupinum/ginko-content`.
- This repository is the core engine and default filesystem provider, not Ginko CMS, Studio, admin UI, or an MCP workflow host.

## Committed Exports

The package export map is a compatibility commitment:

- `@lupinum/ginko-content`
- `@lupinum/ginko-content/config`
- `@lupinum/ginko-content/client`
- `@lupinum/ginko-content/server`
- `@lupinum/ginko-content/provider`
- `@lupinum/ginko-content/agent`
- `@lupinum/ginko-content/cms-contract`
- `@lupinum/ginko-content/cms-import`
- `@lupinum/ginko-content/testing/provider-fixture`
- `@lupinum/ginko-content/testing/provider-contract`
- `@lupinum/ginko-content/transformers`
- `@lupinum/ginko-content/transformers/markdown`
- `@lupinum/ginko-content/transformers/yaml`
- `@lupinum/ginko-content/transformers/json`
- `@lupinum/ginko-content/transformers/csv`

Do not document or encourage deep runtime imports unless deliberately promoting an internal API.

Treat CMS and testing subpaths as advanced public surfaces. They are committed package exports, but they should not appear in beginner content-reading docs.

The machine-readable public-surface classification lives in `meta/public-surface.json`. Contract tests compare that file to the package export map, public client/server facade value and type exports, and generated app auto-imports. When adding or removing a public export, update the classification with the intended audience and docs target instead of editing tests directly.

## Classification Categories

Use the narrowest category that describes the intended audience:

- `stable-query-*`: core content reads used by app and server authors.
- `stable-app-*`: the `useContentPage`/`useContentSearch` Vue/Nuxt composables and the pure query functions app code pairs with `useAsyncData` for lists, navigation, and locale-aware behavior.
- `stable-server-*`: Nitro/H3 server helpers that require an event.
- `stable-provider-*`: provider author APIs, provider error helpers, cache hints, and cache adapters.
- `stable-search-*`, `stable-site-data-*`, `stable-sitemap-*`, `stable-toc-*`: feature-specific public helpers and types.
- `advanced-agent-*`: agent markdown paths, serializers, llms text generation, and agent site output. These are public extension points, not beginner content APIs.
- `advanced-cms-*`: CMS contract/import surfaces. Keep CMS workflow logic outside core.
- `testing-only-*`: package-supported test fixtures and provider contract suites.
- `transport-query-type`: serialized query/envelope shapes. Treat these as advanced unless a user-facing API explicitly needs them.
- `*-compatibility`: retained compatibility surfaces. Do not teach them as the preferred path in beginner docs.

If none of the categories fit, stop and decide whether the export is actually public. Do not add broad catch-all categories such as `utility` or `misc`.

## Config Exports

From `@lupinum/ginko-content/config`:

- `defineContentConfig`
- `defineCollection`
- `reference`
- collection and schema types

Use these in `content.config.ts`.

## Client Facade Exports

The public client facade (`@lupinum/ginko-content/client`) exports:

- `one`
- `many`
- `paginate`
- `backlinks`
- `resolveOne`
- `surround`
- `navigation`
- `getCollectionPath`
- `useContentPage`
- `useContentSearch`
- `querySiteData`
- `extractContentToc`

This is the final hard-cut composable surface (VNEXT.md 10.4–10.8): exactly `useContentPage` and `useContentSearch` as composables, everything else a pure query function paired with `useAsyncData` by app code. There is no `useContentOne`, `useContentMany`, `useContentHead`, `useContentPagination`, `useContentBacklinks`, `useContentResolveOne`, `useContentVariants`, `useContentTree`, `useContentNavigation`, `useContentNeighbors`, `useContentSwitchLocalePath`, `useContentSearchData`, `useContentSearchResults`, `useContentToc`, or `useContentPreview` — these are hard-cut deletions, not deprecated aliases.

Docs can import from `@lupinum/ginko-content/client`, but app code usually relies on Nuxt auto-imports after the module is installed.

## Generated App Auto-Imports

Nuxt app auto-import wiring exposes exactly two functions: `useContentPage` and `useContentSearch`. It deliberately does not auto-import the low-level query primitives (`one`, `many`, `paginate`, `resolveOne`, `surround`, `backlinks`, `navigation`), `getCollectionPath`, or `querySiteData` — app code imports those explicitly from `@lupinum/ginko-content/client` and pairs them with `useAsyncData` and an explicit, stable key.

Current app-facing route pages should use `useContentPage(collectionHandle, options)` — it owns SSR payload integration, route watching, stable keying, and stale-page flash suppression, and exposes an opt-in `surround` option for previous/next. It does not throw a default 404, does not mutate `<head>`, and does not execute redirects; the app reads `route.requestedPath`/`route.resolvedPath` and decides that policy itself. Raw string collection names remain supported for dynamic/plugin code, but docs and examples should prefer handles from `~/content.config`.

## Server Exports And Auto-Imports

The public server facade and generated `#content/server` types expose:

- `one`
- `many`
- `paginate`
- `backlinks`
- `resolveOne`
- `surround`
- `navigation`
- `getCollectionPath`
- `queryCollectionsSitemapEntries`
- `createContentProviderError`
- provider cache helpers and provider document helpers for Nitro server runtime
  convenience.

Use `#content/server` inside Nuxt server runtime when appropriate. Package-level
provider code should use `@lupinum/ginko-content/provider`, which is the
Nitro-free provider-author surface for `ContentProvider`, provider query
helpers, cache helpers, provider errors, and provider document shaping helpers.

The current `/server` facade also exports cache helpers. Treat those as
advanced surfaces unless a doc is specifically aimed at Nitro server runtime
authors.

## Provider Contract Test Exports

`@lupinum/ginko-content/testing/provider-contract` is a testing-only public
surface for provider authors. It exports the fixture-bound
`runProviderContractSuite()` and reusable assertions:

- `unwrapProviderContractResult`
- `expectUnsupportedProviderOperation`
- `expectUnsupportedProviderQueryShape`
- `LEGACY_PROVIDER_ENVELOPE_FIELDS`
- `expectNoLegacyProviderEnvelopeFields`
- `expectProviderDocumentEnvelope`
- `expectProviderCapabilities`

Keep this surface small. Do not add speculative query-response, projection,
generic provider-error, or route-envelope helpers unless an external provider
contract need proves the assertion belongs here.

## Rendering Components

Runtime components include content rendering primitives such as `ContentRenderer`, `ContentRendererInline`, and prose components. User content components live under `components/content`.

The module registers runtime app components globally, excluding `Prose/**` and `internal/**`, and also registers user `components/content` directories from Nuxt layers.

## Type Generation

The module generates types that augment `@lupinum/ginko-content`:

- `ContentCollectionMap`
- `ContentCollectionI18nMap`

When public collection typing changes, inspect generated type tests before changing docs.

## Drift Checks

When touching public surface:

- Inspect `packages/content/package.json` `exports`.
- Inspect `packages/content/src/public/client.ts`.
- Inspect `packages/content/src/public/server.ts`.
- Inspect `packages/content/src/config.ts`.
- Inspect `packages/content/src/module/runtime-assets.ts`.
- Run relevant contract tests from `test/contracts/runtime-assets-contracts.test.ts`, `module-contracts.test.ts`, and query/server tests.
