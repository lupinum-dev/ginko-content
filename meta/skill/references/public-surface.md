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
- `@lupinum/ginko-content/toc`
- `@lupinum/ginko-content/transformers`
- `@lupinum/ginko-content/transformers/*`

Do not document or encourage deep runtime imports unless deliberately promoting an internal API.

## Config Exports

From `@lupinum/ginko-content/config`:

- `defineContentConfig`
- `defineCollection`
- `reference`
- collection and schema types

Use these in `content.config.ts`.

## Client Exports And Auto-Imports

The public client facade and Nuxt auto-import wiring expose:

- `one`
- `many`
- `resolveOne`
- `variants`
- `tree`
- `neighbors`
- `useContentOne`
- `useContentMany`
- `useContentResolveOne`
- `useContentVariants`
- `useContentTree`
- `useContentNeighbors`
- `useContentLocaleSwitch`
- `useContentSearchData`
- `useContentSearchResults`
- `querySiteData`
- `extractContentToc`
- `useContentToc`

Docs can import from `@lupinum/ginko-content/client`, but app code usually relies on Nuxt auto-imports after the module is installed.

## Server Exports And Auto-Imports

The public server facade and generated `#content/server` types expose:

- `one`
- `many`
- `resolveOne`
- `variants`
- `tree`
- `neighbors`
- `queryCollectionsSitemapEntries`
- `createContentProviderError`
- `ContentProvider`
- `ContentProviderCapabilities`
- `ContentProviderErrorCode`

Use `#content/server` inside Nuxt server runtime when appropriate. Use `@lupinum/ginko-content/server` for package-level or provider code that imports the public server contract.

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
