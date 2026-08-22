# Changelog

## v1.0.0-beta.3

[compare changes](https://github.com/lupinum-dev/ginko-content/compare/v1.0.0-beta.2...v1.0.0-beta.3)

- Generate one canonical `.ginko/content-contract.json` artifact and expose a
  bounded Node reader for CMS and deployment tools.
- Hard-cut the prerelease provider wire to v5. Collection identity now lives
  only on the query envelope, and the obsolete route-guessing helper is gone.
- Add a bounded cache-hint constructor and a sanitized `QUERY_UNSUPPORTED`
  data-source error for backend adapters.
- Version separately deployed CMS result envelopes and reject package/component
  skew before interpreting result data.
- Expand the public conformance suites across pagination, optional operations,
  mounted paths, locale boundaries, and a complete in-memory reference source.
- Bound CMS import planning by document count, per-document bytes, and a
  256 MiB cumulative document ceiling without retaining raw document or asset
  bodies in the plan.
- Keep managed media honest and image-only. Remove the unreleased generic
  `fields.file()`, `fields.asset()`, and `file` contract shapes until Ginko can
  provide their full authoring, delivery, and portability lifecycle.
- Reuse one symlink-safe stable-file reader for generated contracts and
  portable directories, and emit the resolved Nuxt contract artifact exactly
  once per preparation lifecycle.
- Add explicit backend deadline and route-snapshot consistency coverage to the
  data-source boundary.
- Prepare the coordinated Ginko CMS adapter for strict provider-query v5 and
  response-envelope skew rejection.

## v1.0.0-beta.2

[compare changes](https://github.com/lupinum-dev/ginko-content/compare/v1.0.0-beta.1...v1.0.0-beta.2)

This beta keeps agent-readable documentation faithful to the authored source.

- Preserve code-fence language and filename metadata in raw Markdown and full
  LLM output.
- Order indexed pages by their natural numeric source paths so `llms.txt`
  follows the authored documentation journey.

## v1.0.0-beta.1

This beta defines the focused 1.0 contract. It removes prerelease
compatibility paths now, before applications depend on them, and keeps the
provider query wire at v4.

- Add `count()` for exact filtered totals without transferring bounded document
  lists.
- Resolve populated references behind the server query boundary. Browser calls
  make one request; provider reads remain bounded, deduplicated, and limited to
  eight concurrent operations. Population accepts declared reference fields
  only, and the server validates and selects them before provider dispatch.
- Give `useContentPage()` explicit `pending`, `success`, `not-found`, and
  `error` states, with `page` consistently returning a document or `null`.
- Remove the deprecated Markdown `highlight` alias. Use `shiki`.
- Centralize document projection, cache route naming, missing-static-content
  behavior, and public response envelopes; remove stale document and reference
  shapes.
- Use Nuxt's canonical site URL for all agent links. Replace
  `agent.site.url`/`profile` with required `whenToUse` and optional
  `whenNotToUse` guidance. Production agent routes require the canonical URL
  even when prerendering is disabled.
- Return a real, recoverable Markdown 404 when a server-rendered public route is
  missing and the request prefers `text/markdown`. Static deployments continue
  to use generated `/raw/**.md`, `/llms.txt`, and `/llms-full.txt` files because
  a static host cannot negotiate response formats.
- Align the quick start, examples, reference, migration guide, and release gates
  with the 1.0 contract.

## v0.4.0-rc.2

This release candidate updates the supported Nuxt dependency graph and the
package documentation. It also makes the complete workspace audit part of the
release gate and makes cold documentation deployments build the package first.

- Update Nuxt and Nuxt Kit to the patched 4.5 line.
- Keep development hot reload compatible with Nuxt 4.5 import-meta types.
- Update `js-yaml` and vulnerable transitive tools to patched releases.
- Add commit-addressed package previews for pull requests from this repository.
- Standardize the root and package READMEs around user outcomes and a minimal
  Nuxt quick start.
- Build the package before Vercel builds the documentation application.

## v0.4.0-rc.1

This prerelease aligns Ginko Content with Vue 3.5, Nuxt 4, Nuxt Kit, and Comark
0.6 while tightening the Markdown contract from configuration through browser
rendering. Install it from npm's `next` channel and rebuild generated content.

- Upgrade `comark` and `@comark/vue` together to `0.6.2`. `shiki` is the
  canonical highlighting plugin; `highlight` remains a setup-time deprecated
  alias for the `0.4.x` line. Markdown plugins now have an explicit empty
  default. Add `toc`, `summary`, `shiki`, or another supported plugin when the
  application needs it.
- Validate built-in Markdown options during Nuxt setup. Shiki configuration
  uses `themes: { light, dark }` and `languages`; the formerly documented
  singular `theme` and `langs` spellings now fail instead of being silently
  ignored.
- Close the parser-to-render contract over supported Comark output, including
  task lists, table alignment, fenced-code metadata, named component slots, GFM
  alerts, and comments. Comments are discarded before renderer, search,
  summary, portable, or agent output can expose them. Typed component
  frontmatter survives portable asset rewrite and reparse.
- Give each Markdown boundary one truthful profile. Filesystem ingestion uses
  the configured build-time plugin list; CMS and portability use a deterministic
  framework-free baseline; `ContentRendererInline` uses a fixed client-safe
  baseline for SSR, hydration, and reactive updates. Inline strings do not load
  build-time plugins, custom components, syntax highlighting, footnotes, Math,
  Mermaid, or `markdown.tags` mappings.
- Generate literal optional-plugin imports at build time so Math and Mermaid
  work in production browsers and packed consumers. Math requires the optional
  `katex` peer plus `katex/dist/katex.min.css`; Mermaid requires the optional
  `beautiful-mermaid` peer. Remove blanket Comark transpile, Vite `noExternal`,
  and Nitro inline overrides.
- Reuse parsers by isolated resolved configuration. Representative
  1,500-document ingestion improved from 406.2 ms to 21.8 ms with byte-identical
  output and no mutable cross-profile state.
- Forward Vue fallthrough attributes through `ContentRenderer` exactly once,
  including the declared `class` prop. The documented catch-all route recipe now
  keys pages by route path and throws a fatal Nuxt 404 after `useContentPage`, so
  direct requests, client navigation, and recovery agree.
- Keep Pagefind browser work behind the client lifecycle, including a non-empty
  initial query. Search defaults and mandatory result fields now have one
  framework-light owner shared by module, server, and client boundaries.
- Replace Nuxt private `_layers` access and custom module detection with
  supported Nuxt Kit APIs. Remove stale payload-extraction setup and verify real
  generated payload behavior. Preserve application-over-layer component
  precedence.
- Reduce `runtimeConfig.public.content` to the client-owned projection. Provider
  module specifiers, filesystem sources and excludes, CMS settings, agent
  definitions, schema inventories, and other server/build metadata remain in
  private runtime config and are no longer serialized into client payloads.
- Publish a manifest-derived classification of all 18 package exports and the
  data-source adapter guide. Move the packed consumer into a tracked,
  behavior-oriented fixture and verify exact tarballs with pnpm/Nuxt 4.5 and
  npm/Nuxt 4.4 consumers.
- Remove false-shared script, test-support, playground-navigation, and docs-app
  utility files. Repository policy checks now scan Git-owned files, so ignored
  auxiliary worktrees cannot contaminate release verification while normal
  untracked files remain checked.
- Bump the content cache format for normalized Markdown changes. Rebuild content,
  search indexes, and deployment caches after upgrading. The portable document
  and CMS wire formats do not change in this release candidate.

## v0.3.6

- Bundle the generated content virtual modules into the Nitro server instead of
  leaving them external. The development server previously handed
  `content.config.ts` and registered transformers to Node's ESM loader, which
  only resolves fully specified relative imports, so a config importing local
  TypeScript the way `nuxt.config.ts` does failed every request with
  `ERR_MODULE_NOT_FOUND`. Content config authoring now follows the same import
  rules as the rest of a Nuxt app.
- Accept the inline `display` styles Shiki emits. `@shikijs/transformers` marks
  highlighted and diff lines with `display: inline-block`, which the render
  policy rejected as unsafe, so any page with a highlighted code line failed to
  render.

## v0.3.5

- Resolve builtin markdown prose components as fallbacks. An app-registered
  global `ProseImg` (or a `markdown.tags` remap) now wins over the bundled
  default; apps that relied on the builtin always rendering images should
  remove any conflicting global `ProseImg` component, since the
  `markdown.image` mode no longer applies once an app component takes over.

## v0.3.4

- Normalize unbounded Zod number and array limits to `null` so contract
  generation remains canonical-JSON-safe.
- Serialize Date defaults as ISO strings and reject non-finite or otherwise
  non-JSON defaults with field-specific errors.

## v0.3.3

- Fix development content updates so the custom HMR event is always sent
  through Nuxt's client Vite server, including with separate Nuxt 4 client and
  SSR dev servers.
- Reload Nuxt automatically after valid edits to the active `content.config.*`,
  bypass stale Jiti modules, and rebuild the module-owned development cache so
  collection, route, source, and schema changes take effect without manually
  restarting the dev command.

## v0.3.2

- Preserve the Nuxt request context used to register nested query and
  navigation API paths during prerendering. Nuxt 4.5 consumers no longer emit
  `NUXT_E1001` when route surroundings or navigation perform a second
  transport request after an asynchronous boundary.
- Keep collection ownership attached to uniquely resolved Markdown reference
  aliases, including when another collection uses the same canonical key.
  Runtime resolution and build-time link validation now consume the same
  collection-scoped graph target.

## v0.3.1

- Fix Markdown references to folder-index pages when another collection uses
  the same canonical key. A uniquely matched collection-mounted alias now
  retains its collection scope through locale-variant resolution instead of
  being rejected later as an ambiguous unscoped key.

## v0.3.0

This stable release promotes the coordinated `0.2.1` → `0.3.0` hard cut after
four public release candidates. See the
[0.2 to 0.3 migration guide](https://github.com/lupinum-dev/ginko-content/blob/main/docs/content/docs/6.migration/4.ginko-version-upgrades.md)
for the complete replacement map.

- Replace the broad composable surface with `useContentPage()` and
  `useContentSearch()`, plus pure `one()`, `many()`, `paginate()`, navigation,
  surroundings, and reference helpers for explicit application reads.
  Documents expose canonical `route` and `resolution` facts instead of the
  former top-level path and locale projections.
- Add the bounded `ContentDataSource` contract, provider/data-source
  conformance suites, deterministic portability codecs, and safe Node
  directory helpers. Remove the former `cms-import` subpath; CMS integrations
  use the runtime-neutral portability and CMS-contract entry points.
- Add build-owned link and asset validation, locale-specific Pagefind indexes,
  selected- and all-language search, sealed production snapshots, exact
  tarball consumers, and static/browser release gates.
- Require Node.js 22.18–22.x, 24.11–24.x, or 26+, Nuxt 4.4.7 through Nuxt 4.x,
  and Vue 3.5.35 through Vue 3.x.

- Hard-cut the provider query wire to v4. Provider plans now carry
  pagination only under `plan.pagination`, use mandatory `by` discriminants
  for path/route/reference selectors, and are structurally closed before
  dispatch. Replace the public `ContentQueryPlan` type with
  `ContentProviderQueryPlan`; `toContentProviderQuery()` now accepts only
  context-free queries and path selectors.
- Define provider `contentPath` as a locale-specific collection-mounted,
  site-relative path without an application locale prefix. Reject route facts
  outside the configured locale mount and project canonical, provider, and
  public paths through one resolved collection locale policy. Remove the
  `longestMountForPath` CMS-contract export; route lowering now validates only
  the locale's expected mount instead of guessing from another locale.
- Require complete localized route maps and reject missing, unknown, empty, or
  non-site-relative locale mounts during setup. Provider-wire paths and graph-executor paths now
  use distinct plan types and cross their boundary through explicit
  mount/unmount operations.
- Generate filesystem paths and canonical keys from the same mount-agnostic
  source parts. Keep `.navigation.yml` rows collection-neutral, join them to
  actual pages in the named collection navigation query, and remove
  downstream root and segment-count repair heuristics.
- Preserve typed YAML component frontmatter through a shared Comark token
  plugin used by filesystem, CMS, and portability parsing. Remove the
  source-scanning shadow parser and keep inline bindings unsafe.
- Remove `CONTENT_REFERENCE_PREFIX` and description-based reference semantics.
  References are now identified only by `CONTENT_REFERENCE_METADATA_KEY`, whose
  value changes from `"__nuxt_content_ref__:"` to `"ginko:contentReference"`;
  migrate manually described schemas to `reference()` or
  `withContentReferenceMetadata()`.
- Count arrays toward the HTTP query-depth limit and bound programmatic query
  values at 64 levels so hostile inputs fail with a path-bearing
  `ContentQueryInputError` instead of overflowing the stack.
- Make provider plans and nested plan collections readonly, remove the
  subjective documentation-footer wording check, and share one population
  implementation between single- and multi-document queries.
- Add the runtime-free `@lupinum/ginko-content/navigation` entry with generic,
  readonly tree traversal helpers for navigation consumers outside Nuxt.
- Promote `sidebar: section | group` to shared navigation metadata and validate
  invalid values in Markdown frontmatter and `.navigation.yml` sidecars.
- Diagnose unknown navigation select fields and locale sidecars that match no
  navigation tree during development and builds, with process-level warning
  deduplication and no production-runtime failures.
- Require a named collection for navigation queries; ambiguous
  cross-collection navigation is rejected instead of applying an arbitrary
  route policy.
- **Breaking:** make the `path` vocabulary in application queries canonical.
  `by: { path }` and `where: { path }` now exclude the collection route mount,
  so `by: { path: '/guide/getting-started' }` becomes
  `by: { path: '/getting-started' }` and a collection index is `/` in every
  locale. Filesystem `canonicalKey` values follow the same rule (`1/1` becomes
  `1`). Stale mounted values select nothing rather than throwing: `one()`
  returns `null`, `many()` returns `[]`, and `paginate()` returns an empty page
  with `total: 0`, with an advisory development-only hint on a mount-shaped
  `by: { path }` miss. `by: { route }` is unchanged and still takes the full
  public URL. Internally these selectors stay canonical until provider
  serialization, where they are mounted exactly once; direct provider tooling
  names its mounted selector `providerPath`.
- Require provider-authored `canonicalKey` on every document so changing a
  collection mount cannot change identity. Resolve one mandatory default
  locale in locale policy and reject unlocalized provider facts in any other
  locale.
- Carry navigation locale selection only in `query.plan.resolveLocale`; remove
  the duplicate provider navigation options object.
- Keep `getCollectionPath()` honest and context-free: handles using inherited
  `i18n: true` must use an explicit collection-local
  `{ locales, defaultLocale }` policy before this helper can project them.

## v0.3.0-rc.4

- Harden the prerelease public query vocabulary: array-valued schema fields now
  infer element operands for `$in`, `$nin`, `$contains`, and `$containsAny`;
  fallback accepts booleans, `'default'`, or an exact readonly locale chain;
  logical `$not` is the only negation form; and public sorts use only `asc` or
  `desc`. These public vocabulary changes do not alter provider wire v3.
- Tighten site data so in-process providers return required `data` plus an
  optional timestamp while request key and locale remain canonical. Remote
  data sources continue echoing identity for binder validation. Remove the
  public `LocalizedDoc` and `ContentCollectionStringName` type aliases.
- Treat an unknown configured provider as a server error while preserving the
  separate runtime-neutral and H3-aware provider-error constructors.

- Correct the supported runtime floors to the versions required by the current
  Nuxt dependency graph: Node.js 22.18–22.x, 24.11–24.x, or 26+, and Vue
  3.5.35–3.x. The exact minimum Node runtime is now exercised in CI.
- Normalize locale fallback once for both locale and variant queries. Explicit
  fallback chains now override configured policy consistently for list, path,
  route, and reference selectors; an empty fallback list and `fallback: false`
  both mean exact resolution; and the `default` shorthand resolves to the
  collection default rather than the site-wide default.
- Harden the public data-source binder so arbitrary backend status and code
  fields cannot escape as trusted public errors. Enforce byte limits against
  the actual UTF-8 payload while retaining explicit NFC requirements for cache
  tags and paths.
- Refuse publication from the source package directory and keep the inspected
  release tarball as the only supported publication input. Remove release-only
  preflight residue and redundant workspace dependencies.
- Hard-cut the prerelease provider query wire from v2 to v3 and keep `$nin` as
  a first-class provider-plan comparison operator. There is no v2 dispatch or
  compatibility adapter. Providers
  that relied on `$nin` lowering to `$in` under a negation must advertise and
  execute `$nin` directly. Logical `$and`, `$or`, and `$not` plan nodes remain
  structural parts of the v3 wire and are not advertised capabilities. The
  exported provider conformance suite now requires result-asserting probes for
  all three mandatory logical nodes.
- Apply public `only` and `without` projection after provider-document
  validation. Filesystem and fixture providers now keep complete identity and
  route facts across the raw provider seam instead of maintaining a fragile
  projection allowlist.
- Validate one site-relative `contentPath` contract for provider query
  documents and auxiliary route facts before public route projection.
- Reject provider-only `$regex` and `$options` syntax from public queries, and
  validate public HTTP operator operands, field paths, sort locales, terminal
  modes, and pagination shapes against the documented query grammar before
  provider dispatch.
- Delete the obsolete regex-sentinel query transport and keep regex-like
  strings inert. Encode browser query parameters as UTF-8 so non-Latin content
  survives the Buffer-free transport path.
- Make provider query wire validation unconditional and JSON-strict, reject
  undeclared runtime collections before provider dispatch, and require
  capability declarations to contain only supported, unique operators and
  pagination modes.
- Align the public provider types with the enforced raw boundary: `query()` now
  returns `ProviderDocumentInput` envelopes rather than a caller-selected
  generic, and `siteData()` returns JSON-pure data rather than a caller-selected
  generic. Provider implementations using those type parameters must remove
  them when upgrading to this prerelease.
- Tighten validation of the documented provider query envelopes. Offset
  responses must echo the exact requested `skip` and `limit`, counts must be
  non-negative safe integers, and a missing provider `first` result uses
  `undefined`. Public single-result HTTP responses continue to use top-level
  `null` when no document exists.
- Treat explicit `paging` as the only pagination authority when present,
  require positive page sizes, and reject malformed filesystem cursors instead
  of silently restarting at the first page. Third-party provider cursors remain
  opaque to Ginko.
- Reject malformed, sparse, or non-JSON provider query, navigation,
  surroundings, search, route, sitemap, site-data, and data-source results at
  their boundaries with structured provider errors. The exported provider and
  data-source conformance suites now validate canonical query envelopes.
- Support structured JSON/YAML/CSV bodies and arbitrary custom-transformer file
  extensions in the public document types. Preserve released
  `normalizeProviderDocument()` output as valid provider input when its derived
  `path` exactly matches `contentPath`.
- Reject malformed, traversal-bearing, or separator-encoded provider content
  paths before route projection while retaining valid percent-encoded content.
- Bound cache-revalidation request bodies and target lists before signature
  verification or adapter dispatch, authenticate the exact request bytes,
  reject malformed UTF-8, and accept only the documented `tags` and `paths`
  fields.
- Keep cache invalidation single-owned by `ContentCacheAdapter`; remove stale
  provider-level invalidation guidance and delete the CMS workflow demo that
  duplicated behavior already covered by the provider contract and public
  caching guide.
- Keep runtime collection i18n configuration as the single locale-policy
  source, including explicit `i18n: false`, and prevent sitemap locale-key
  collisions for collection and canonical identities containing punctuation.
- Stop inventing per-document fallback alternates from incomplete route facts.
  Query results now include every concrete provider variant plus only the
  fallback route proven by the current resolution; whole-collection sitemap
  alternates continue to use the canonical route index.
- Make `createFixtureContentProvider()` follow production visibility rules by
  excluding drafts from query results, document variants, navigation, and
  provider-owned search while retaining draft route facts for consumer-side
  sitemap and route policy tests.
- Remove the runtime special case for Nuxt Content v2's sitemap source. Running
  Nuxt Content and Ginko together is unsupported; Ginko now deduplicates only
  the sitemap source it owns.
- Remove the filesystem-specific implicit `file.stem` sort from provider query
  normalization. Unsorted results now use provider order; callers requiring
  deterministic pagination must specify a sort. Provider conformance now proves
  sort, first, and supported count semantics in addition to advertised filters
  and pagination.
- Export the low-level `ContentProviderQueryInput` from the provider subpath for
  the existing provider-lowering helpers. Programmatic and HTTP lowering now
  share one closed key vocabulary and reject unknown keys, scalar or empty
  filters, contradictory terminals, malformed selectors, and invalid paging
  before a broader query can reach a provider.

## v0.3.0-rc.3

- Fix filesystem-provider navigation after the provider hard cutover. Canonical
  navigation now reads trusted graph documents and directory configuration
  directly, while the public provider boundary continues to expose raw route
  facts and reject structural documents. This prevents SSR navigation from
  disappearing during client hydration in Ginko Docs consumers.
- Project locale-switcher paths from canonical provider route facts instead of
  relying on the removed public-document `path` field.
- Require canonical paths at the trusted navigation-builder boundary and keep
  `page: false` control nodes out of fallback surround results.

## v0.3.0-rc.2

- Stop shipping the unexported `compatibility.json` release-stack snapshot.
  Package manifests and executable compatibility lanes are the maintained
  sources of truth.
- Export `findFirstNavigationPage()` from the client and server entry points for
  resolving collection and section entry pages through structural navigation
  groups. `ContentNavigationTreeItem.path` is now correctly optional; consumers
  that access arbitrary navigation paths must guard structural nodes first.

## v0.3.0-rc.1

This release candidate combines the previously unpublished content-engine work
and the data-source/portability work into one release from `v0.2.1`. It is a
coordinated pre-1.0 hard cutover; no intermediate `0.3` or `0.4` package is
required. See
[Migrating from 0.2.1 to 0.3](https://github.com/lupinum-dev/ginko-content/blob/main/docs/content/docs/6.migration/4.ginko-version-upgrades.md).

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
- Fix hash-addressed `file:` installs by inlining Ginko Content's complete
  server implementation into Nitro instead of leaving package-internal files
  as absolute filesystem imports.
- Known issue: Nuxt 4.4.7–4.4.8 production builds can fail during Nitro
  prerendering on Windows when Nuxt's cache-driver file URL is externalized as
  a raw drive-letter import. Build release artifacts on Linux or macOS until
  the upstream Nuxt/Nitro path handling is corrected.

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
> below. Read it top to bottom before upgrading.

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
