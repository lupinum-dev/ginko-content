# Ginko Content 10/10 Testing Progress

Started: 2026-06-08

Goal: execute phases 0 through 10 from `testing-10-10-roadmap.md`, with each
phase tracked by implementation status, verification evidence, blockers, and
next actions.

## Current Status

Overall status: completed

Current phase: all roadmap phases completed.

Guiding rules:

- Prefer the lowest reliable test layer.
- Keep browser e2e small and focused on browser-only risk.
- Do not add second sources of truth.
- Do not claim static same-URL markdown negotiation works.
- Record exact verification commands and outcomes.

## Phase Summary

| Phase | Name | Status |
| --- | --- | --- |
| 0 | Stabilize current confidence baseline | Completed |
| 1 | Internal generated-output smoke | Completed |
| 2 | Compact agent output fixture | Completed |
| 3 | Production browser e2e | Completed |
| 4 | Packed fresh Nuxt consumer test | Completed |
| 5 | SSR/static markdown contract split | Completed |
| 6 | Search matrix hardening | Completed |
| 7 | Sitemap/static edge matrix | Completed |
| 8 | Provider/cache/revalidation conformance | Completed |
| 9 | CMS-neutral contract/import hardening | Completed |
| 10 | Docs/examples/public API drift | Completed |

## Phase 0: Stabilize Current Confidence Baseline

Status: completed

Purpose: prove the current refactor remains green before adding new test
infrastructure.

### Todos

- [x] Run focused library contract gate.
- [x] Run source typecheck.
- [x] Run package build.
- [x] Run docs build.
- [x] Run `git diff --check`.
- [x] Pack library tarball.
- [x] Install tarball in downstream consumer.
- [x] Run downstream build.
- [x] Run downstream generated-output test.
- [x] Run downstream check.
- [x] Run downstream `git diff --check`.
- [x] Classify warnings.
- [x] Update confidence evidence.

### Evidence

- 2026-06-08: `pnpm vitest run test/contracts/architecture-boundaries.test.ts test/contracts/package-exports-contracts.test.ts test/contracts/provider-fixture-conformance.test.ts test/contracts/query-response-contracts.test.ts test/contracts/runtime-assets-contracts.test.ts test/contracts/runtime-config-contracts.test.ts test/contracts/sitemap-assert-contracts.test.ts test/unit/docs-drift.test.ts test/unit/agent-markdown.test.ts test/unit/static-output-routes.test.ts test/unit/pagefind.test.ts`
  passed: 11 files, 106 tests.
- 2026-06-08: `pnpm typecheck:source` passed.
- 2026-06-08: `pnpm build:packages` passed.
- 2026-06-08: `git diff --check` passed.
- 2026-06-08: first `pnpm docs:build` attempt failed because it ran in
  parallel with `pnpm build:packages` and the docs app resolved
  `dist/config.mjs` before the package build had finished. Rerunning after the
  package build completed passed.
- 2026-06-08: `pnpm docs:build` passed on sequential rerun.
- 2026-06-08: root `pnpm pack --pack-destination /Users/matthias/Git/workspace/.local-tarballs`
  produced `lupinum-ginko-content-workspace-0.0.0.tgz`. This is not accepted
  as package evidence because it packs the workspace root, not the content
  package.
- 2026-06-08: `pnpm --dir packages/content pack --pack-destination /Users/matthias/Git/workspace/.local-tarballs`
  passed and produced
  `/Users/matthias/Git/workspace/.local-tarballs/lupinum-ginko-content-0.1.4.tgz`.
- 2026-06-08: downstream
  `pnpm add -w /Users/matthias/Git/workspace/.local-tarballs/lupinum-ginko-content-0.1.4.tgz`
  passed in `/Users/matthias/Git/workspace/shadcn-starter-i18n`.
- 2026-06-08: downstream `pnpm build` passed.
- 2026-06-08: downstream `pnpm test app/generated-output.test.ts` passed:
  1 file, 8 tests.
- 2026-06-08: downstream `pnpm check` passed.
- 2026-06-08: downstream `git diff --check` passed.
- Current warnings: pnpm warns that the `pnpm` field in `package.json` is no
  longer read for package extensions. Docs build also emits sourcemap/chunk-size
  and browser-external warnings from Nuxt/Vite dependencies. Downstream check
  emits Node/npm deprecation/config warnings from Nuxt/package-manager tooling,
  and downstream build emits the known `nuxt-schema-org` `IMPORT_IS_UNDEFINED`
  warning. No warning is currently classified as a Ginko product failure.
- 2026-06-08: downstream tarball install changed only the tarball integrity in
  `/Users/matthias/Git/workspace/shadcn-starter-i18n/pnpm-lock.yaml`, because
  the local `0.1.4` tarball was rebuilt. That is a verification artifact to
  commit or restore in the downstream repo separately, not a source change in
  this package.

### Blockers

None yet.

## Phase 1: Internal Generated-Output Smoke

Status: completed

Implemented work:

- Added `test/e2e/generated-output-smoke.test.ts`.
- Reused `playground/ginko-i18n` instead of adding another fixture.
- Added real sitemap integration through `@nuxtjs/sitemap@8.0.15`.
- Added minimal agent site/pages configuration to the fixture.
- Added draft and partial fixture documents that must not leak into generated
  public output.
- Asserted generated localized HTML, search index, sitemap XML, raw markdown,
  route `index.md`, `llms.txt`, `llms-full.txt`, no local origins, and no
  repeated locale prefixes from actual `.output/public` files.
- Changed the e2e Vitest project from a single-file include to
  `test/e2e/**/*.test.ts`.
- Fixed a real agent path bug found by this test: fallback German agent pages
  were generating invalid raw routes such as
  `/raw/de/leitfaden/guide/advanced.md`. Agent page-index generation now uses
  provider public paths when available and otherwise builds fallback paths from
  the source locale route before applying the requested locale prefix.
- Added a fast unit regression in `test/unit/agent-markdown.test.ts` for the
  fallback agent path case.

### Evidence

- 2026-06-08: first focused generated-output run failed because enabling agent
  markdown for all docs exposed duplicate fixture routes for `/guide`. Root
  cause was the fixture docs collection including locale home pages and guide
  index pages. Fixed by narrowing the docs source to translated guide folders.
- 2026-06-08: second focused generated-output run failed because fallback
  German agent output linked to `/raw/de/leitfaden/guide/advanced.md`, which
  404ed. Root cause was duplicated route reconstruction in
  `packages/content/src/runtime/server/agent-markdown.ts`. Fixed by using the
  provider/public route when available and handling fallback source-locale
  routes explicitly.
- 2026-06-08: `pnpm vitest run test/unit/agent-markdown.test.ts` passed:
  1 file, 22 tests.
- 2026-06-08:
  `pnpm vitest run --config vitest.config.ts --project e2e test/e2e/generated-output-smoke.test.ts`
  passed: 1 file, 1 test.
- 2026-06-08: `pnpm test:e2e` passed: 2 files, 3 tests.
- 2026-06-08: `pnpm typecheck:source` passed.
- 2026-06-08: `git diff --check` passed.
- 2026-06-08: reran
  `pnpm vitest run --config vitest.config.ts --project e2e test/e2e/generated-output-smoke.test.ts`
  after scoping `@nuxtjs/sitemap` to `playground/ginko-i18n`; passed:
  1 file, 1 test.

### Blockers

None.

## Phase 2: Compact Agent Output Fixture

Status: completed

Implemented work:

- Added `playground/ginko-agent-output`.
- Included English and German content routes for docs and services.
- Included an app-owned localized legal page through `defineAgentAppPage`.
- Included a data-only collection plus draft and partial content that must not
  leak into agent output.
- Added a downstream-shaped Nitro plugin that registers custom serializers with
  `registerAgentMarkdownSerializers`, `registerAgentMarkdownComponents`, and
  `defineAgentMarkdownComponent`.
- Covered custom serializer output for `callout`, `card`, `gallery`, `chart`,
  and `consent-embed`.
- Added `test/e2e/agent-output-smoke.test.ts` to inspect generated raw
  markdown, `/:route/index.md`, `llms.txt`, localized `llms.txt`,
  `llms-full.txt`, localized `llms-full.txt`, and exclusion behavior.
- Confirmed unknown components use the current XML preservation fallback.

### Evidence

- 2026-06-08:
  `pnpm vitest run --config vitest.config.ts --project e2e test/e2e/agent-output-smoke.test.ts`
  first failed because the test expected an omitted-component note, while the
  current fallback preserves unknown components as XML. The assertion was
  corrected to match the current contract.
- 2026-06-08:
  `pnpm vitest run --config vitest.config.ts --project e2e test/e2e/agent-output-smoke.test.ts`
  passed: 1 file, 1 test.
- 2026-06-08: `pnpm test:e2e` passed: 3 files, 4 tests.
- 2026-06-08: `pnpm typecheck:source` passed.
- 2026-06-08: `git diff --check` passed.

### Blockers

None.

## Phase 3: Production Browser E2E

Status: completed

Implemented work:

- Added a dedicated `browser-e2e` Vitest project and `pnpm test:e2e:browser`.
- Added `playwright-core` as the browser automation runtime and a Chromium
  executable resolver that can use an installed browser or an explicit
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.
- Added `test/browser-e2e/locale-search.test.ts`.
- Added a small search page to `playground/ginko-i18n` so browser e2e can test
  real localized search result navigation.
- Converted the i18n catch-all page to the documented `useContentPage(docs, {
  fallback: true })` route-page API.
- Removed a duplicate layout-level `useContentOne` query that tried to mirror
  route-page state for locale switching. That query was a second source of
  truth and caused real browser-visible 404 content API probes on non-content
  routes and during locale transitions.
- Fixed `useContentPage` prerender behavior. The helper previously inferred
  locale through runtime/i18n access inside an async-evaluated computed, which
  produced `[nuxt] instance unavailable` during production prerender. It now
  captures collection i18n config synchronously and derives route-page locale
  from the current route path unless the caller explicitly passes `locale`.
- Tightened locale context capture so `resolveActiveLocale` no longer reads
  `nuxtApp.$i18n` lazily from a captured Nuxt app object.

### Evidence

- 2026-06-08: first `pnpm test:e2e:browser` attempt failed because the local
  Playwright cache pointed at a missing Chromium binary. Fixed the test harness
  to accept `PLAYWRIGHT_CHROMIUM_EXECUTABLE` and fall back to installed macOS
  browsers.
- 2026-06-08: browser e2e then exposed a real locale-switching issue:
  `/de/leitfaden/erste-schritte` linked English to
  `/leitfaden/erste-schritte` instead of `/guide/getting-started`. Root cause
  was the fixture using the lower-level `useContentOne` route read without the
  route-page publisher.
- 2026-06-08: switching the catch-all page to `useContentPage` exposed a
  production prerender failure for translated route pages:
  `/guide`, `/guide/getting-started`, `/de/leitfaden`, and
  `/de/leitfaden/erste-schritte` returned 500 during prerender. Root cause was
  late runtime/i18n access inside the `useContentPage` inferred-locale path.
- 2026-06-08: browser e2e exposed two content API 404s after the route-page
  fix. Root cause was the layout querying `docs` on every route to support
  locale switching. Removed that duplicated content query and let
  `useContentPage` publish the active content route.
- 2026-06-08: `pnpm build:packages` passed after source changes.
- 2026-06-08: `pnpm --dir playground/ginko-i18n build` passed after rebuilding
  packages.
- 2026-06-08: `pnpm test:e2e:browser` passed: 1 file, 1 test.
- 2026-06-08: `pnpm typecheck:source` passed.
- 2026-06-08: `git diff --check` passed.
- 2026-06-08: `pnpm test:e2e` passed: 3 files, 4 tests.

### Blockers

None.

## Phase 4: Packed Fresh Nuxt Consumer Test

Status: completed

Implemented work:

- Added `scripts/test-packed-consumer.mjs`.
- Added root `test:package-consumer`.
- The script builds packages, packs `packages/content`, extracts the tarball,
  rejects `workspace:*` ranges, installs the tarball into a temporary Nuxt app
  outside the monorepo, verifies expected declaration files, runs public subpath
  imports, runs `nuxi prepare`, runs `nuxi typecheck`, builds production,
  starts the built server, fetches `/`, fetches a Ginko content API route, and
  fetches a Nitro import-smoke API route.
- The fresh app imports the root Nuxt module from `nuxt.config.ts`, imports
  `/client` and `/toc` from a Vue page, imports `/server` and `/toc` from a
  Nitro handler, and bare-imports runtime-neutral/config/testing subpaths from
  Node.
- Fixed the public testing helper boundary found by the packed consumer:
  `@lupinum/ginko-content/testing/provider-fixture` no longer imports Nitro
  runtime cache-hint helpers. It records cache hints on the synthetic fixture
  event through testing-local helpers backed by core cache-hint merging.
- Updated the provider contract suite to read testing fixture cache hints
  through `getProviderFixtureCacheHint`.

### Evidence

- 2026-06-08: first packed-consumer attempts failed when bare Node imports
  tried to load the package root, `/client`, and `/server`. Root cause: those
  are Nuxt/Vue/Nitro-context public exports, not runtime-neutral Node entry
  points. The test now proves them in their real Nuxt/Vue/Nitro contexts.
- 2026-06-08: packed-consumer then failed importing
  `@lupinum/ginko-content/testing/provider-fixture` because it pulled
  `nitropack/runtime` through runtime cache-hint helpers. Fixed the root cause
  by making the testing fixture cache-hint path runtime-neutral.
- 2026-06-08: packed-consumer then failed importing
  `@lupinum/ginko-content/testing/provider-contract` without Vitest. This is
  expected because the testing contract defines Vitest tests and `vitest` is an
  optional peer. The fresh app now installs `vitest@4.1.6` for that import.
- 2026-06-08: packed-consumer then failed `nuxi typecheck` because the minimal
  synthetic Nuxt app had no `tsconfig.json`. Fixed by writing the standard
  `tsconfig.json` that extends `./.nuxt/tsconfig.json`.
- 2026-06-08: packed-consumer then over-asserted navigation titles. The content
  API returned the route entry but not the markdown title in the default
  navigation payload. The assertion now checks the route entry contract.
- 2026-06-08:
  `pnpm vitest run test/contracts/provider-fixture-conformance.test.ts test/contracts/package-exports-contracts.test.ts`
  passed: 2 files, 35 tests.
- 2026-06-08: `pnpm typecheck:source` passed.
- 2026-06-08: `pnpm test:package-consumer` passed.
- 2026-06-08: `pnpm pack:check` passed.
- 2026-06-08: `git diff --check` passed.

### Blockers

None.

## Phase 5: SSR And Static Markdown Contracts

Status: completed

Implemented work:

- Added a non-prerendered `/ssr-only` route to
  `playground/ginko-agent-output`.
- Explicitly enabled `content.agent.linkHeaders` and
  `content.agent.markdownNegotiation` in the agent-output fixture.
- Added an app-owned agent page for `/ssr-only` so the same public route can
  serve HTML by default and markdown through `Accept: text/markdown`.
- Added `test/e2e/agent-markdown-negotiation.test.ts`.
- Added `playground/ginko-agent-disabled` to prove `content.agent: false`
  removes agent route handlers and negotiation middleware in a production app.
- Made `agent-link-headers` page-aware. It now advertises `/raw/**.md` and
  `/:route/index.md` alternates only when the current route resolves to agent
  markdown.
- Kept static behavior tested through generated files:
  `docs/agent-components/index.md` and `raw/docs/agent-components.md`.
- Documented that same-URL `Accept: text/markdown` negotiation is SSR/hybrid
  middleware behavior, not a pure static hosting guarantee.

### Evidence

- 2026-06-08: first focused negotiation run failed because app-owned agent
  pages resolved markdown but did not expose `rawPath`/`markdownPath` on the
  returned object used by the new link-header middleware. Fixed the root cause
  by deriving advertised alternates from the normalized public route.
- 2026-06-08: first focused negotiation run also over-asserted that
  `Accept: text/markdown` on an unknown app route should force a 404. The app
  has a catch-all HTML route, so Ginko correctly does not convert it to
  markdown. The durable contract is that unknown explicit markdown routes 404.
- 2026-06-08: disabled fixture build initially failed because Ginko requires a
  content config with at least one collection. Added a one-record data
  collection so the fixture isolates `content.agent: false`.
- 2026-06-08:
  `pnpm vitest run --config vitest.config.ts --project e2e test/e2e/agent-markdown-negotiation.test.ts`
  passed: 1 file, 3 tests.
- 2026-06-08:
  `pnpm vitest run test/unit/agent-markdown.test.ts test/runtime/api-auxiliary-boundaries.test.ts`
  passed: 2 files, 26 tests.
- 2026-06-08: `pnpm test:e2e` passed: 4 files, 7 tests.
- 2026-06-08: `pnpm test:e2e:browser` passed: 1 file, 1 test.
- 2026-06-08: `pnpm docs:build` passed.
- 2026-06-08: `pnpm typecheck:source` passed.
- 2026-06-08: `git diff --check` passed.

### Blockers

None.

## Phase 6: Search Matrix Hardening

Status: completed

Implemented work:

- Added `test/e2e/search-matrix.test.ts`.
- Added `scripts/test-search-matrix.mjs` and root `pnpm test:search:matrix`.
- Added `playground/ginko-provider-search`, a compact external-provider
  fixture for provider-owned search.
- The production search matrix now proves:
  - MiniSearch emits route-safe public paths and serves runtime search results.
  - Pagefind emits localized generated search records and public Pagefind
    assets.
  - Provider-owned search delegates to `provider.search()` and does not expose
    a local index route.
  - Disabled search omits production search endpoints.
- Strengthened `test/runtime/api-search-boundaries.test.ts` with
  provider-owned search success and unsupported-provider negative coverage.
- Kept browser coverage to the existing representative locale/search flow.

### Evidence

- 2026-06-08: `pnpm vitest run test/runtime/api-search-boundaries.test.ts`
  passed: 1 file, 6 tests.
- 2026-06-08: `pnpm test:search:matrix` passed: 1 file, 4 tests.
- 2026-06-08:
  `pnpm vitest run test/unit/search-behavior.test.ts test/unit/pagefind.test.ts test/client/search-composables.test.ts test/runtime/api-search-boundaries.test.ts`
  passed: 4 files, 17 tests.
- 2026-06-08: `pnpm test:e2e:browser` passed: 1 file, 1 test.
- 2026-06-08: `pnpm typecheck:source` passed.
- 2026-06-08: `git diff --check` passed.

### Blockers

None.

## Phase 7: Sitemap And Static Output Edge Matrix

Status: completed

Implemented work:

- Added a deeply nested translated docs route to `playground/ginko-i18n`:
  `/guide/deep/nested` and `/de/leitfaden/tief/verschachtelt`.
- Added a route-backed `internal` collection with `sitemap: false` to prove
  collection-level sitemap exclusion in generated output.
- Added `test/e2e/sitemap-static.test.ts`.
- Added `scripts/test-sitemap-static.mjs` and root
  `pnpm test:sitemap:static`.
- The static sitemap test reads generated XML from `.output/public` and
  asserts localized routes, nested localized routes, sitemap index entries,
  hreflang alternates, draft/partial/data/internal exclusions, no local
  origins, and no repeated locale prefixes.
- Kept empty sitemap and assertion failure coverage in
  `test/contracts/sitemap-assert-contracts.test.ts`.

### Evidence

- 2026-06-08: `pnpm test:sitemap:static` passed: 1 file, 1 test.
- 2026-06-08:
  `pnpm vitest run test/contracts/sitemap-query-contracts.test.ts test/contracts/sitemap-assert-contracts.test.ts test/contracts/module-contracts.test.ts`
  passed: 3 files, 30 tests.
- 2026-06-08: `pnpm test:e2e` passed: 6 files, 12 tests.
- 2026-06-08: `pnpm typecheck:source` passed.
- 2026-06-08: `git diff --check` passed.

### Blockers

None.

## Phase 8: Provider, Cache, And Revalidation Conformance

Status: completed

Implemented work:

- Confirmed the existing provider fixture/conformance suite covers strict
  list/first/count query envelopes, malformed provider results, provider-owned
  search sections/search/sitemap/site-data, cache hints, dependency tracking,
  provider invalidation, and data-only sitemap failures.
- Added `noopContentCache()` coverage for tag-only and path invalidation.
- Added explicit tag-capable adapter behavior coverage.
- Added a revalidation boundary regression proving cache adapter invalidation
  failures are propagated and search caches are not cleared after a failed
  invalidation.

### Evidence

- 2026-06-08:
  `pnpm vitest run test/contracts/provider-contracts.test.ts test/contracts/provider-fixture-conformance.test.ts test/contracts/filesystem-provider-conformance.test.ts test/runtime/api-provider-boundary.test.ts test/runtime/api-revalidate-boundary.test.ts test/unit/cache-hints.test.ts`
  passed: 6 files, 60 tests.
- 2026-06-08: `pnpm typecheck:source` passed.
- 2026-06-08: `git diff --check` passed.

### Blockers

None.

## Phase 9: CMS-Neutral Contract And Import Hardening

Status: completed

Completed work:

- Added `cms-import` parser and graph tests for Markdown, MDC, YAML, JSON,
  JSON5, collection matching, localized metadata, references, and canonical
  variant graph construction.
- Fixed `cms-import` JSON5 editable-source extraction so it uses the same JSON5
  parser semantics as the shared JSON transformer instead of silently producing
  empty frontmatter for JSON5 object syntax.
- Strengthened CMS schema artifact tests so public CMS field helper metadata for
  rich text, image, asset/file, relation, relations, object, array, select,
  number, boolean, date, slug, labels, required state, and localization is
  preserved in the generated CMS contract.
- Added an architecture boundary check that the package exports, public-surface
  metadata, and public facade files do not expose CMS admin, editor, workflow,
  MCP, Studio, or Convex behavior from this core package.
- Re-verified packed consumer imports for `@lupinum/ginko-content/cms-contract`
  and `@lupinum/ginko-content/cms-import`.

### Evidence

- 2026-06-08:
  `pnpm vitest run test/contracts/architecture-boundaries.test.ts test/unit/cms-contract-purity.test.ts test/unit/cms-contract-schema-artifact.test.ts test/unit/cms-import.test.ts`
  passed: 4 files, 21 tests.
- 2026-06-08: `pnpm test:package-consumer` passed and imported both CMS
  subpaths from the packed tarball.
- 2026-06-08: `pnpm lint` passed.
- 2026-06-08: `pnpm typecheck:source` passed.
- 2026-06-08: `git diff --check` passed.

### Blockers

None.

## Phase 10: Docs, Examples, And Public API Drift

Status: completed

Implemented work:

- Keep public-surface metadata, docs, examples, package exports, generated
  declarations, and beginner/advanced docs boundaries in sync.
- Aligned the package README and installation docs with the actual package peer
  dependency floors: Nuxt 4.4.7 or later and Vue 3.5 or later.
- Extended docs drift checks to scan JSON files as well as source and markdown
  files so example package manifests are covered by import/dependency policy.
- Added a docs drift check that examples, playgrounds, and fixtures import
  Ginko only through public package subpaths declared in `package.json`.
- Added a docs drift check that examples, playgrounds, and fixtures do not
  import or depend on `@nuxt/content` directly.
- Added a docs drift check that the package README and installation guide
  state peer dependency floors matching `packages/content/package.json`.

### Evidence

- 2026-06-08:
  `pnpm vitest run test/contracts/package-exports-contracts.test.ts test/contracts/runtime-assets-contracts.test.ts test/unit/docs-drift.test.ts`
  passed: 3 files, 38 tests.
- 2026-06-08: `pnpm docs:build` passed.
- 2026-06-08: `pnpm examples:build` passed.
- 2026-06-08: `pnpm lint` passed.
- 2026-06-08: `pnpm typecheck:source` passed.
- 2026-06-08: `git diff --check` passed.

### Blockers

None.
