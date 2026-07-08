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
- `@lupinum/ginko-content/transformers/*`

Do not document or encourage deep runtime imports unless deliberately promoting an internal API.

Treat CMS and testing subpaths as advanced public surfaces. They are committed package exports, but they should not appear in beginner content-reading docs.

The machine-readable public-surface classification lives in `meta/public-surface.json`. Contract tests compare that file to the package export map, public client/server facade value and type exports, and generated app auto-imports. When adding or removing a public export, update the classification with the intended audience and docs target instead of editing tests directly.

## Classification Categories

Use the narrowest category that describes the intended audience:

- `stable-query-*`: core content reads used by app and server authors.
- `stable-app-*`: Vue/Nuxt composables for route pages, lists, navigation, head data, and locale-aware app behavior.
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

The public client facade exports:

- `one`
- `many`
- `paginate`
- `backlinks`
- `resolveOne`
- `variants`
- `tree`
- `neighbors`
- `getCollectionPath`
- `agentMarkdownPathForRoute`
- `agentRawPathForRoute`
- `normalizeAgentRoutePath`
- `useContentHead`
- `useContentPage`
- `useContentOne`
- `useContentMany`
- `useContentPagination`
- `useContentBacklinks`
- `useContentResolveOne`
- `useContentVariants`
- `useContentTree`
- `useContentNavigation`
- `useContentNeighbors`
- `useContentSearch`
- `useContentSearchData`
- `useContentSearchResults`
- `querySiteData`
- `extractContentToc`
- `useContentToc`

Docs can import from `@lupinum/ginko-content/client`, but app code usually relies on Nuxt auto-imports after the module is installed.

## Generated App Auto-Imports

Nuxt app auto-import wiring exposes the route/page composables, search data helpers, `querySiteData`, `getCollectionPath`, and the compatibility fallback `useContentSwitchLocalePath`. It deliberately does not auto-import low-level query primitives such as `one`, `many`, `resolveOne`, `variants`, `tree`, or `neighbors`.

Current app-facing route pages should use `useContentPage(collectionHandle)` as the ergonomic wrapper. Explicit one-document reads should use `useContentOne(collectionHandle, { by })`. Raw string collection names remain supported for dynamic/plugin code, but docs and examples should prefer handles from `~/content.config`.

## Server Exports And Auto-Imports

The public server facade and generated `#content/server` types expose:

- `one`
- `many`
- `paginate`
- `backlinks`
- `resolveOne`
- `variants`
- `tree`
- `neighbors`
- `getCollectionPath`
- `queryCollectionsSitemapEntries`
- `createContentProviderError`
- `ContentProvider`
- `ContentProviderCapabilities`
- `ContentProviderErrorCode`

Use `#content/server` inside Nuxt server runtime when appropriate. Use `@lupinum/ginko-content/server` for package-level or provider code that imports the public server contract.

The current `/server` facade also exports cache and agent helpers. Treat those as advanced surfaces until Phase 2 classifies whether they stay under `/server` or move to agent/cache-focused subpaths.

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
