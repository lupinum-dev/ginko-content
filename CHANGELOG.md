# Changelog

## Unreleased

### Removed

- Removed the experimental `./cms-exchange` subpath, source, and tests. CMS
  migration/export flows now live outside this package; `./cms-contract` and
  `./cms-import` remain the supported CMS-facing surfaces.

## v0.1.7

### Added

- Added the experimental `./cms-exchange` CMS exchange helpers for filesystem
  import planning, asset reference scanning, and rendered export manifests.
- Added the `./provider` package subpath for provider authors.

### Changed

- Restored legacy root package entry fields used by package consumers.
- Hardened the release audit dependency setup.

### Fixed

- Ignored managed asset schemes in the CMS exchange asset scanner.

## v0.1.6

### Fixed

- Removed runtime imports of raw content config from Nitro storage and virtual
  config templates.
- Serialized function-backed agent app pages into runtime-safe markdown per
  locale.
- Preserved derived collection reference metadata for runtime validation without
  live schemas.

## v0.1.5

### Fixed

- Fixed markdown `$` refs so content graph references win over colliding
  configured quick links.
- Fixed finalized `content.links` runtime config, no-i18n named route quick
  links, and requested-locale fallback URLs for localized markdown refs.

## v0.1.4

### Fixed

- Made `/raw/*.md` the single generated and advertised agent markdown route
  shape for static output, link headers, prerender routes, and generated
  internal markdown links.
- Fixed the i18n static output fixture by declaring `nuxt-site-config`
  directly where `@nuxtjs/sitemap` is used.

## v0.1.3

### Changed

- Prepared the dream experience release against the packed package flow used by
  the Nuxt UI and shadcn consumer apps.
- Verified generated static output, route switching, localized search, author
  backlinks, and sitemap URL identity across `saas-template`, `saas-i18n`, and
  `shadcn-starter`.
- Added the `pnpm test:golden` vNext proof for provider-shape docs, blog,
  authors, navigation, search, route metadata, i18n paths, and sitemap
  assertions.
- Added `content.sitemap.assert.requireProductionSiteUrl` for production-like
  sitemap release checks that reject placeholder origins.
- Removed the old named collection declaration overload. Collection map keys are
  now the only collection identity source.

### Fixed

- Fixed schema-driven backlink and populate usage so consumers no longer need
  app-local author field workarounds or populated post casts.
- Added early populate target mismatch diagnostics when relation metadata points
  to a different collection than the requested populate target.
- Fixed consumer-visible search triggers and generated docs/sitemap behavior in
  the Nuxt UI examples.
- Localized the German Asian cuisine article body while preserving route
  identity, MDC content, media, tabs, and author references.

## v0.1.2

### Changed

- Changed `useContentPage(..., { surround })` to return semantic `previous` and
  `next` values instead of exposing the route-page previous/next data as a
  positional tuple.
- Added collection-handle support to `useContentSearchData(handle, options)` for
  Nuxt UI static search data.
- Made reference population examples and tests field-keyed with
  `populate: { author: authors }`.
- Kept `surround` as the public previous/next query vocabulary and rejected the
  `neighbors` rename.

### Documentation

- Updated route-page, navigation, migration, and API docs to teach
  `useContentPage()` as the route-page helper and `useContentOne()` as the
  explicit custom-read primitive.
- Updated CMS-backed search guidance to use provider-backed search helpers
  instead of static section-data search.

## v0.1.1

### Changed

- Made named collection declarations the documented public collection
  declaration shape for that release.
- Added a Nuxt quickstart fixture that prepares, typechecks, and builds the
  documented first-page path.
- Added docs drift checks for stale collection syntax, fallback examples, and
  exported collection handles.

### Documentation

- Reworked beginner docs around the copy-pastable `content.config.ts`,
  `content/index.md`, and `pages/[...slug].vue` path.
- Removed fallback and provider concepts from beginner examples.
- Updated migration docs to distinguish Nuxt Content collection syntax from the
  Ginko collection API.

## v0.1.0

### Fixed

- Fixed locale fallback queries so fallback variants are selected before sorting. This keeps ordered result sets stable when the fallback document has different sort metadata.
- Fixed reference resolution for documents that define a short `id`. The canonical collection key remains authoritative and the short id works as an alias.
- Fixed search section filtering so `filterQuery` is applied consistently by the server search path.
- Fixed sitemap generation for localized content by seeding sitemap entries from every configured locale and emitting absolute image URLs.
- Fixed sitemap assertion mode handling so `both` runs during compiled sitemap checks.
- Fixed package ESM output paths for public exports and Nuxt runtime assets.

### Changed

- Added release-oriented package export smoke tests and sitemap/query regression coverage.
- Added Fallow configuration and scripts for advisory analysis plus regression tracking.
- Added the search i18n playground to `dev:prepare` so generated Nuxt types stay current before release checks.

### Documentation

- Corrected markdown plugin configuration examples.
- Replaced the nonexistent query `path()` API with `_path` filtering examples.
- Documented the `@nuxtjs/sitemap` requirement in sitemap module options.
- Updated installation docs to include `zod`.
- Corrected stale example labels.
