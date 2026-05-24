# Changelog

## Unreleased

## v2.13.4

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
