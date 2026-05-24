# Module And Runtime Config

Use this for Nuxt module setup, runtime imports/components, generated types, virtual aliases, and `nuxt.config.ts` `content` options.

## Module Entry

`packages/content/src/module.ts` is the Nuxt module entrypoint. It:

- validates that the app has `content.config.ts` with at least one collection
- resolves module options
- wires runtime config
- registers virtual templates
- registers runtime imports and components
- installs Nitro handlers and plugins

Large setup concerns belong under `packages/content/src/module/*`, not inline in `module.ts`.

## Config Ownership

`content.config.ts` owns:

- collections
- providers
- schemas
- references

`nuxt.config.ts` `content` owns runtime behavior:

- i18n
- sitemap
- search
- markdown
- watch
- sources
- provider selection
- navigation fields
- content head behavior
- path case behavior

Keep examples clear about this split.

## Important Defaults

Current module defaults include:

- `api.baseURL: '/api/_content'`
- `i18n: true`
- `sitemap: true`
- `search.engine: 'minisearch'`
- search filter excluding drafts and partials
- dev watch websocket on localhost ports `4000-4040`
- `sources: {}`
- `ignores: []`
- `collections: {}`
- `navigation.fields: []`
- `contentHead: true`
- `respectPathCase: false`

Check `module.ts` before documenting defaults; these are easy to drift.

## Runtime Imports

Client auto-imports:

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

Server auto-imports:

- `one`
- `many`
- `resolveOne`
- `variants`
- `tree`
- `neighbors`
- `queryCollectionsSitemapEntries`

If adding public runtime helpers, update facade exports, runtime imports, docs, and contract tests together.

## Virtual Aliases

The module wires virtual/generated modules for:

- `#content/virtual/transformers`
- `#content/virtual/config`
- `#content/virtual/providers`
- `#content/server`

Do not document virtual internals as general app APIs unless the public contract explicitly includes them.

## Components

The module registers runtime app components globally, excluding `Prose/**` and `internal/**`. User content components in `components/content` are registered from Nuxt layers.

When changing rendering component registration, verify both docs and component contract tests.

## Removed Or Unsupported MDC-Era Options

Do not reintroduce or document old options as supported unless the implementation deliberately adds them:

- `content.highlight`
- `content.markdown.mdc`
- `content.markdown.remarkPlugins`
- `content.markdown.rehypePlugins`
- `content.markdown.toc`

Prefer hard cutovers over compatibility glue when old Nuxt Content assumptions conflict with Ginko's model.

## Where To Verify

- `packages/content/src/module.ts`
- `packages/content/src/module/runtime-assets.ts`
- `packages/content/src/module/options.ts`
- `test/contracts/module-contracts.test.ts`
- `test/contracts/runtime-assets-contracts.test.ts`
- `test/fixtures/typecheck`
