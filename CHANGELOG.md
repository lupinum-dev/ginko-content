# Changelog

## v0.3.0-rc.1

This release candidate combines the previously unpublished content-engine work
and the data-source/portability work into one release from `v0.2.1`. It is a
coordinated pre-1.0 hard cutover; no intermediate `0.3` or `0.4` package is
required. See [Migrating from 0.2.1 to 0.3](/docs/migration/from-0-2-to-0-3).

### Breaking changes

- Require Node.js 22 or newer.
- Replace the broad composable surface with `useContentPage` and
  `useContentSearch`. Use the pure client query functions with `useAsyncData` for
  lists, navigation, pagination, backlinks, surroundings, and direct reads.
- Return canonical `route` and `resolution` facts on documents instead of the
  former top-level `path`, `localePaths`, and `variants` fields.
- Remove `@lupinum/ginko-content/cms-import`. Use the runtime-neutral
  `@lupinum/ginko-content/portability` codecs and the bounded
  `@lupinum/ginko-content/portability/node` directory helpers.

### Added and improved

- Add the bounded `ContentDataSource` contract, its Nuxt/H3 binder, canonical
  contract hashing, portable documents, deterministic codecs, structural
  references/assets, and reusable conformance tests.

- Add build-owned content validation for internal links, heading anchors, quick
  links, Nuxt route names, and local assets. Builds persist a versioned report;
  `content.validation: 'error'` blocks invalid snapshots, while the default
  `'report'` mode remains diagnostic. `ginko-content validate` reads that exact
  report from Nuxt's configured build directory.
- Improve the normalized search experience with contextual plain-text
  MiniSearch excerpts and explicit immutable index ownership. Pagefind now emits
  one index per locale plus a versioned locale manifest, supports selected- and
  all-language queries, limits before detail loading, and returns plain excerpts.
  Existing Pagefind sites should rebuild their generated index.
- Add a reproducible MiniSearch/Orama benchmark over Ginko-generated docs and
  localized content. MiniSearch remains the JSON engine; Orama is benchmark-only
  and is not a new runtime backend.
- Document consumer-owned search previews, all-language toggles, collection
  categories, and agent-readable copy actions, and add docs semantic-structure
  and compressed-asset budget gates.
- Raise the supported Node.js runtime from the now end-of-life Node 20 line to
  Node 22 or newer, and verify the full release on Node 24 LTS.
- Bound Nuxt and optional Vitest peer support to their current major lines so
  dependency compatibility claims remain finite and testable.
- Add real static-generation manifests, generated-link integrity, broader
  hydration checks, exact-tarball pnpm/npm consumers, and scheduled dependency
  compatibility canaries.
- Work around the Windows production-build failure present in Nuxt
  4.4.3-4.4.8 with Nitropack 2.13.4 by replacing Nuxt's broken file-URL
  prerender cache mount with Nitro's built-in memory driver. Other platforms
  and storage mounts are unchanged.

### Migrating from 0.2.1

1. Move deployments to Node.js 22 or newer.
2. Replace deleted composables with the pure query functions documented in the
   migration guide; keep `useContentPage` and `useContentSearch` for their
   route/search state ownership.
3. Read public route and locale resolution from `document.route` and
   `document.resolution`.
4. Move CMS import/export code to the portability subpaths and delete duplicated
   filesystem-to-CMS mapping.
5. Rebuild generated search indexes. Enable strict content validation explicitly
   with `content.validation: 'error'` after resolving the diagnostic report.
6. Run provider/data-source contract tests and certify Ginko CMS against the
   exact `0.3.0-rc.1` tarball before promoting `0.3.0`.

## v0.2.1

- Add Nitro-free provider document helper exports from
  `@lupinum/ginko-content/provider`: `normalizeProviderDocument`,
  `shapeProviderDocument`, `ProviderDocumentInput`, and
  `ShapeProviderDocumentOptions`. Provider packages no longer need to import the
  broad server facade just to shape provider documents.
- Add reusable provider contract assertion helpers from
  `@lupinum/ginko-content/testing/provider-contract` so third-party providers
  can verify 0.2 envelope, capability, and unsupported-query invariants against
  their own fixtures.

## v0.2.0

> **This is the foundational-refactor release and a hard cutover — there are no
> compatibility shims.** It is a single, coordinated breaking change to the
> document envelope, the provider wire contract, the public export map, and
> production loading. This section is the complete migration guide; a provider
> author or CMS integrator should be able to migrate using only what is written
> below. Read it top to bottom before upgrading. The primary consumer is
> ginko-cms — its per-item cutover checklist is at the end.

### Migrating a provider — the short version

If you only maintain a `ContentProvider`, do these four things:

1. Change your `query`/`navigationQuery` signatures to accept a
   `ContentProviderQuery` (and typed `ContentProviderNavigationOptions`) instead
   of the old builder-params object. See **Provider wire v1** below.
2. Stop emitting underscore metadata. Return the **minimal provider document**
   (`ProviderDocumentInput`) and let `shapeProviderDocument()` derive the route
   envelope. See **Minimal provider document** below.
3. Rename your internal `canonicalPath` derivation to `unprefixedPath`; emit the
   opaque `canonicalKey`. See **Envelope field map** and **`unprefixedPath`**.
4. Import provider _types_ from `@lupinum/ginko-content/provider` and the wire
   _helpers_ from `@lupinum/ginko-content/server`. See **Public surface**.

---

### Production loading (Phase 2)

**Sealed snapshot pipeline.** Production no longer rebuilds the content graph
per request. The build now emits one sealed snapshot (`snapshot.json`, stored as
a single item in the existing parsed-cache mount, written by the prerendered
cache warm route). Each production process loads that snapshot once and builds
the graph once; the per-request lazy-load machinery and the per-document
parsed-cache reads are gone from the prod path.

- **Build fails on an incomplete snapshot.** A missing or skipped document now
  fails the build (with the offending source id named) instead of silently
  404ing in production. A `prerender:done` verification step fails the build if
  `snapshot.json` is absent.
- **SSR-only (non-prerendered) deployments must keep the cache warm route in the
  prerender route list** so the snapshot is written. Dev and preview behavior is
  unchanged (watch-and-reparse, request-scoped memoization, per-document cache
  all remain for dev/prerender).
- The **dev parsed cache is now content-hashed** (hashes the body, not
  `mtime`/`size`), so same-size/same-mtime edits can no longer serve a stale
  parse.

---

### Document envelope field map (Phase 3)

The legacy underscore metadata is **deleted**. `ParsedContent` is the canonical
document envelope. No aliases ship. This is a mechanical but total rename —
every place you read `_x` off a document changes. **User
frontmatter is unaffected**: these renames apply only to the system meta fields
declared by ginko-content's types, never to arbitrary frontmatter keys a user
file may contain.

**Top-level identity fields (`_x` → `x`):**

| Old | New | Notes |
|---|---|---|
| `_id` | `id` | Required. Fully-qualified, locale-suffixed system id. |
| `_collection` | `collection` | |
| `_locale` | `locale` | |
| `_path` | `path` | The variant's own (possibly translated-slug-localized) route path. |
| `_canonicalKey` | `canonicalKey` | **Public, opaque** identity join key (see below). |
| `_type` | `type` | Document kind (`markdown`/`yaml`/…). |
| `_draft` | `draft` | |
| `_partial` | `partial` | |
| `_dir` on resolved variant results | `dir` | Directory `.navigation.yml` config merged onto route-variant query results. |

**File provenance → one nested, optional `file` object** (optional because
non-filesystem/CMS providers have no file):

| Old | New |
|---|---|
| `_source` | `file.source` |
| `_file` | `file.path` |
| `_stem` | `file.stem` |
| `_dir` | `file.dir` |
| `_basename` | `file.basename` |
| `_extension` | `file.extension` |

**Per-request resolution meta → folded into the existing `resolved` envelope**
(the modern `localePaths`/`variants`/`resolved` shape already carried most of
this):

| Old | New |
|---|---|
| `_requestedLocale` | `resolved.requestedLocale` |
| `_resolvedLocale` | `resolved.locale` |
| `_availableLocales` | `resolved.availableLocales` |
| `_variantPaths` | `localePaths` (public projected form) / `resolved.variantPaths` (raw) |
| `_requestedPath` | `resolved.requestedPath` |
| `_requestedRef` | `resolved.requestedRef` |
| `_requestedRoute` | `resolved.requestedRoute` |
| `_resolvedRefs` | `resolved.resolvedRefs` |
| `_fallback` | `resolved.fallback` |
| `_empty` | removed (no readers) |

**Navigation item differences:** `NavItem._path` maps to `unprefixedPath`, not
`path`, because navigation `path` is the route-ready value. `NavItem._fallback`
maps to top-level `fallback`, not `resolved.fallback`.

**Removed from the public envelope entirely** (now `features/navigation` build
internals, typed module-privately): `_navigationPath`, `_navigationKind`, `_key`,
`_output`. The former `_navigation` marker is now the internal `navigationFile`
flag and remains present on provider/search filtering paths.

**`canonicalKey` is public but opaque.** It is a locale-agnostic identity join
key. Under `translatedSlugs` it is a numeric key (e.g. `1/1`), path-shaped only
by coincidence otherwise. **Never parse it or render it as a URL** — use `path`
for links. Providers must emit it (or let the normalization seam derive it).
There is **no `canonicalPath` field on the document envelope**.

**Missing-document stub.** Internal loaders now use a missing-document stub
shape `{ id, body: null, missing: true }`. Public app and provider code should
treat `body: null` / `missing: true` as the not-found marker; no
`MissingDocument` type or `isRealDocument()` guard is exported.

### `content:file:beforeParse` hook payload renamed (Phase 3)

The `content:file:beforeParse` hook payload (`module/augmentations.ts`) was
renamed from `{ _id, body }` to `{ id, body }`, following the envelope
de-underscoring above. Hooks that read `file._id` must migrate to `file.id`.

### Reserved frontmatter keys (Phase 3)

The system-computed keys `id`, `collection`, `locale`, `path`, `canonicalKey`,
`type`, `file`, `resolved`, `variants`, `localePaths`, `unprefixedPath`, and
`dir` are now **reserved**. If a user frontmatter block defines one of them, the
key is stripped from user data at parse time and a dev/build warning names the
file and key. (For `id`, the warning points you at `ref`.)

`dir` was added to the reserved set: the query executor's `withDirConfig` stamps
the resolved directory `.navigation` config object onto variant-resolution
(`resolveVariant`) results as a top-level `dir` at query time, so an authored
`dir:` frontmatter key would otherwise be **silently clobbered** there. (`dir` is not stamped at parse time —
`path-meta` writes the directory name only to the nested `file.dir`.) Reserving
it applies the same strip+warn policy as the other system keys.

### Frontmatter `id` alias removed — use `ref` (Phase 3)

The user-facing "explicit id" frontmatter alias is **retired**. `ref` is now the
single user-facing stable-alias field for internal content links. The reference
match order is canonical key → `ref` → path/source-path candidates. A document's identity comes
from the system, never from a user alias. **Migration:** replace any
`id:` frontmatter used as a cross-reference/cross-locale alias with `ref:`.
SSR-only deployments can leave old `$id` markdown links as broken URLs unless
you exercise those routes; prerendered builds fail through crawler 404s.

---

### Provider wire v1 (Phase 3)

**`ContentProviderQuery` is the versioned, JSON-pure provider wire contract.**
`ContentProvider.query` and `ContentProvider.navigationQuery` no longer receive
the open-ended builder-params object (`where`/`only`/`sort`/`_locale`/…). They
receive:

- `ContentProviderQuery` — `{ v: 1, collection, plan }`, where `plan` is a
  closed, JSON-serializable `ContentQueryPlan` (filter/sort/projection/limit/
  skip/mode). Every `RegExp` operand is serialized to a tagged JSON object — the
  wire carries **no live `RegExp` instances or other non-JSON values** (a
  dev-mode purity assertion enforces this).
- `ContentProviderNavigationOptions` — `{ fields?, canonical?, resolveLocale? }`
  alongside the query for `navigationQuery`.

Build a wire query from the public grammar with the exported helpers
`toContentProviderQuery()` / `toContentProviderNavigationQuery()` (constant
`PROVIDER_QUERY_VERSION`). Provider capability checking now walks the plan's
filter tree.

**Minimal provider document + normalization seam.** Providers must **stop
hand-building** underscore metadata and derived localization state
(`variants`/`localePaths`/`resolved`). Return the minimal `ProviderDocumentInput`
— required `collection`, `locale`, `path`, `body`; optional `id`, `canonicalKey`,
`type`, `file` (extra frontmatter passes through). Then:

- `normalizeProviderDocument(input)` fills derivable identity fields
  (`id` from `locale`+`path`, `canonicalKey` from `collection`+`path`, `type`
  defaults to `markdown`; leaves `file` absent unless supplied).
- `shapeProviderDocument(input, options)` normalizes and derives the full route
  envelope (`path`, `variants`, `localePaths`, `resolved`).

A provider's `page`/`routeMeta` return values come from `shapeProviderDocument`,
not from hand-built shapes.

### Query RegExp operand hardening

**Breaking — RegExp flags are now whitelisted to `i`, `m`, `s`, `u`.** This
applies to both `RegExp` literal operands (`{ field: /foo/i }`) and the
slash-delimited string form (`{ field: { $regex: '/foo/i' } }`). Any other flag
— `g`, `y`, `d` — now **throws at lowering time** (`TypeError: Unsupported
RegExp flags "…". Content queries support only i, m, s, and u.`). Previously the
string form silently accepted `g`/`y`/`d` because its trailing flags were only
interpreted downstream at execute time, producing a stateful `RegExp` that
bypassed the literal restriction.

**Untagged regex operands are now rejected.** The `$regex` comparator only
accepts a tagged wire `RegExp` (`{ __ginkoContentQueryValue: 'RegExp', source,
flags }`, produced by the current `PROVIDER_QUERY_VERSION` lowering) or a plain
string. An old-wire untagged `{ source, flags }` object operand now throws a
typed error instead of being stringified into a `'[object Object]'` character-
class regex that silently matched most inputs.

### `ContentQueryBuilderParams` privatized (Phase 3)

`ContentQueryBuilderParams` is **removed from `@lupinum/ginko-content/server`**.
It survives internally as the query IR between the public grammar and the plan,
but it is no longer a public export and is not the wire. Author queries with the
public unified grammar; providers speak `ContentProviderQuery`. (The full
retirement of the fluent string-operator builder is deferred post-0.2.0.)

---

### Directory re-cut (Phase 4) — deep imports only

Internal homes moved (no behavior change): the query composition layer to
`features/query/`, the LLM-markdown-output serializers to `features/agent/`.
**Only deep/internal imports are affected** — public subpaths are unchanged by
the move. The runtime agent markdown registry is now a **per-process singleton**
(`appRegistry`): one instance shared by every request in the server process,
registered into via `registerAgentMarkdownSerializer(name, fn, opts?)` (and
friends) from Nitro plugins at startup. `createAgentMarkdownRegistry()` /
`AgentMarkdownRegistry` remains the primitive for building isolated registries
(e.g. tests) that do not touch the shared singleton; the unused
`setupAgentMarkdownRegistry` helper (never wired) was **removed**. The
user-facing registration call signatures are **unchanged**, but serializer
callbacks receive the renamed document envelope, so reads such as
`ctx.page._path` must move to `ctx.page.path` or `ctx.page.unprefixedPath` as
appropriate.

---

### Public surface (Phase 5)

**Removed subpaths:**

- `./cms-exchange` — removed (source + tests). CMS migration/export flows live
  outside this package; `./cms-contract` and `./cms-import` remain the supported
  CMS-facing surfaces.
- `./toc` — removed. Import `extractContentToc`, `useContentToc`,
  `ContentTocOptions`, `Toc`, `TocLink` from `./client`.
- `./transformers/*` — the wildcard is removed (it leaked internals). Use the
  four explicit subpaths: `./transformers/markdown`, `./transformers/yaml`,
  `./transformers/json`, `./transformers/csv`. `./transformers` (the
  `defineTransformer` entry) is unchanged.

**New subpaths:**

- `./agent` — the LLM-markdown-output feature. All agent-markdown serializers,
  agent-site helpers, path helpers, and `AgentMarkdown*` types moved here **out
  of `./server` and `./client`**.
- `./provider` — the single home for provider **types** (`ContentProvider`,
  `ContentProviderCapabilities`, `ContentProviderResult`,
  `MaybeContentProviderResult`, `ContentProviderQuery`,
  `ContentProviderNavigationOptions`, `ContentCacheAdapter`, `ContentCacheHint`,
  `ContentCacheHintInput`, `ContentCacheInvalidateInput`,
  `ContentProviderErrorCode`). Import these from `./provider`.

**`./server` changes:** the agent surface (≈31 values, ≈12 types) moved to
`./agent`; the provider _types_ above moved to `./provider`; the privatized
`ContentQueryBuilderParams` is gone. Provider wire/seam _values_ stay on
`./server` (`PROVIDER_QUERY_VERSION`, `toContentProviderQuery`,
`toContentProviderNavigationQuery`, `withContentCache`,
`createContentProviderError`, `normalizeProviderDocument`,
`shapeProviderDocument`) plus their input types (`ProviderDocumentInput`,
`ShapeProviderDocumentOptions`). **Added:** `headersContentCache` — a new
`./server` export, the active-`apply` cache adapter (from `cache-adapters.ts`)
that writes `Cache-Control`/`ETag` response headers.

**`./client` changes:** the three agent path helpers moved to `./agent`.

**Root entry (`@lupinum/ginko-content`) curated.** The old
`export type * from './types'` wildcard is gone. The root now exports a curated
set only (`ModuleOptions`, `ContentCollectionHandle`, `ParsedContent`, `NavItem`,
`Toc`, `TocLink`, `ContentNavigationItem`, `StrictParsedContent`,
`ContentCollectionMap`, `ContentCollectionI18nMap`, plus `ModuleHooks`). The
retired fluent-builder type leaks (`ContentQueryBuilder`,
`ContentQueryBuilderParams`, `ContentQueryBuilderWhere`, `QueryGroupBuilder`,
`CollectionQueryBuilder`, `CollectionQueryOperator`, …) are **no longer exported
from the root**.

### Result-shape rename: `canonicalPath` → `unprefixedPath` (Phase 5)

The result/route/nav-item field `canonicalPath` is renamed to `unprefixedPath`
across `ContentPageResult`, `ContentRouteMeta`, `ContentLocaleRoute`,
`LocalizedContentDocument`, and nav items. It was always locale-**specific** ("the
resolved variant's route path before locale prefixing", e.g. fr `/demarrage` vs
en `/getting-started`), never canonical — the old name was a misnomer. Update
every read of `canonicalPath` on a query result to `unprefixedPath`.

Navigation `stem` values now use the full normalized stem for dotted numeric
filenames instead of the truncated legacy value. This fixes matching, but code
that compared the old truncated value must update.

### Deterministic locale ordering (Phase 5)

`variants[]`, `resolved.availableLocales`, and `localePaths` are now emitted in a
**canonical, request-independent order** on every resolution path (the
CMS/provider path, the storage-reference path, and the query-plan/route paths).
Previously the order was insertion- or request-dependent — the same document
queried under a different requested locale could return its locales in a
different order (e.g. the i18n playground flipped `de,en` to `en,de` depending on
which locale you asked for).

The order is: the collection's **default locale first**, then the remaining
locales in the collection's configured `locales[]` order (falling back to the
global `content.locales[]` order where no collection config is threaded), then
any leftover locales in input/insertion order. This is uniform across **all**
`variants[]` / `availableLocales` / `localePaths` producers, independent of the
requested locale.

This canonical rule is **not** shared by the standalone locale-listing APIs
`queryCollectionLocales` (`./server`) and `resolveCollectionLocales`: those
intentionally remain **alphabetically** sorted and are a deliberately distinct
ordering from the `variants[]` / `availableLocales` contract above.

### i18n queries require an explicit locale (Phase 5)

Two type holes are closed. On an **i18n collection handle**, `many(handle)` (zero
args) and `tree(handle, {})` (empty options) no longer compile — the options
object is now required and its type already requires `locale`. Pass an explicit
`{ locale }`. Non-i18n handles are unaffected (`many(handle)` still compiles).

### Config: CMS layout typings → opaque `editor` passthrough (Phase 5)

`ContentCmsFieldConfig` no longer types the CMS layout attributes `hidden`,
`order`, `width`, and `condition`. They are replaced by a single opaque
`editor?: Record<string, unknown>` passthrough that ginko-content stores and
forwards but does not interpret. Correspondingly, the emitted `CmsFieldContract`
**removed** the required members `hidden: boolean`, `order: number`,
`width: 'full' | 'half'` and the optional `condition?`, and **added** optional
`editor?` (absent — key omitted — when no `editor` was supplied). The field array
is now emitted in deterministic **insertion order**; ginko-content no longer
computes or reindexes a numeric `order`.

**`slug === 'docs'` heuristic removed.** Collection type is no longer inferred
from the slug `docs` or from `cms.route.rootSlug`. Declare it explicitly with
`cms: { type: 'flat' | 'tree' }`. An undeclared collection now defaults to
`flat` with a build-time warning.

### Provider conformance suite renamed + capability-parameterized (Phase 5)

`testing` exports renamed (hard cut, no aliases):

- `runSaasProviderFixtureContractSuite` → `runProviderContractSuite` (options
  interface `SaasProviderFixtureContractSuiteOptions` →
  `ProviderContractSuiteOptions`).
- `createSaasProviderFixture` → `createDefaultProviderFixture`.

The suite is now capability-parameterized: pass
`ProviderContractSuiteOptions.expectedCapabilities` (a
`ContentProviderCapabilities`); each capability's checks run (and its
false-value typed-error behavior is asserted) independently, so a provider that
does not implement, say, `searchSections` can still run the suite.

### Search option rename notes

`content.search.filterQuery` now uses the de-underscored document fields. The
default changed from `{ _draft: false, _partial: false }` to
`{ draft: false, partial: false }`; custom overrides must make the same rename.
Pagefind is now an optional peer dependency: projects using
`search.engine: 'pagefind'` must install `pagefind` in the app.

### Runtime JSON value invariant

Provider queries and production snapshots are JSON-valued. YAML timestamps are
served as ISO strings after snapshot serialization, `undefined` object keys are
dropped in production snapshots, and non-finite values such as `Infinity`/`NaN`
fail the build instead of serializing to `null`. Query `Date` operands now lower
to ISO-8601 strings on the provider wire (`serializeQueryValue`).

Snapshot builds now **reject enumerable symbol-keyed properties** (previously
silently dropped by `JSON.stringify`, including symbol keys carried on arrays)
instead of admitting a lossy round-trip. Aggregated snapshot errors now carry
per-document `docId:$.path` detail (e.g. `docs/en/guide:$.data.when`) so the
offending value is locatable.

---

### ginko-cms cutover checklist

ginko-cms hard-cuts to 0.2 (no dual-contract layer). In one gated commit:

1. Rewrite `packages/cms/src/nuxt-provider.mjs` in TS, importing `ContentProvider`
   from `@lupinum/ginko-content/provider`; accept `ContentProviderQuery` + the
   typed navigation options; emit the minimal `ProviderDocumentInput` and let
   `shapeProviderDocument` derive the envelope (stop building `_id`/`_source`/
   `_collection`/`_type`/`_path`/`_locale`/`_canonicalKey`/`_variantPaths` and the
   `variants`/`localePaths`/`resolved` state by hand). Import cache-tag vocabulary
   from `@lupinum/ginko-cms-contract`.
2. Rename the provider's internal `canonicalPath` derivation to `unprefixedPath`;
   never expose `canonicalPath` as a contract field.
3. Replace the provider-contract shadow test with the real ginko-content types +
   `runProviderContractSuite` against the packed provider.
4. Re-sync the vendored `/cms-contract` (`describeId` now returns de-underscored
   keys `source`/`path`/`extension`/`file`/`basename`).
5. Update migration/import readers (`_canonicalKey`/`_locale`/`_id`/`_file` →
   `canonicalKey`/`locale`/`id`/`file.*`) and assert migration output never emits
   reserved frontmatter keys (`id`, `collection`, `locale`, `path`,
   `canonicalKey`, `type`, `file`, `resolved`, `variants`, `localePaths`,
   `unprefixedPath`, `dir`); anything that emitted `id` uses `ref`.
6. Move the studio `slugifyUrlSegment` import from `/config` to `/cms-contract`.
7. Update docs/skills that list `_draft`/`_partial`/`_locale`/`_path`/`_stem` as
   provider query fields to the new names (or drop them — `ContentProviderQuery`
   makes them implementation details).
8. Bump the `@lupinum/ginko-content` peer to `^0.2.0`; regenerate
   `compatibility.json`.
9. Gate `contract.contractVersion` against the exported `CMS_CONTRACT_VERSION`
   before `collectionFromContract`.
10. Pass explicit `cms.type` for tree collections and adopt the `editor`
    passthrough for layout fields.

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
