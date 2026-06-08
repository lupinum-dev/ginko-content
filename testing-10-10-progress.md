# Ginko Content 10/10 Testing Progress

Started: 2026-06-08

Goal: execute phases 0 through 10 from `testing-10-10-roadmap.md`, with each
phase tracked by implementation status, verification evidence, blockers, and
next actions.

## Current Status

Overall status: active

Current phase: Phase 4, packed fresh Nuxt consumer test.

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
| 4 | Packed fresh Nuxt consumer test | Not started |
| 5 | SSR/static markdown contract split | Not started |
| 6 | Search matrix hardening | Not started |
| 7 | Sitemap/static edge matrix | Not started |
| 8 | Provider/cache/revalidation conformance | Not started |
| 9 | CMS-neutral contract/import hardening | Not started |
| 10 | Docs/examples/public API drift | Not started |

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

Status: not started

Planned work:

- Add `scripts/test-packed-consumer.mjs`.
- Add `test:package-consumer`.
- Install packed package into a temp Nuxt app outside the monorepo.
- Verify typecheck, build, start, fetches, public subpath imports, and tarball
  contents.

## Phase 5: SSR And Static Markdown Contracts

Status: not started

Planned work:

- Add focused SSR/hybrid fixture or non-prerendered route.
- Prove `Accept: text/markdown` and `Link` headers only where Nitro middleware
  handles the request.
- Keep static contract on explicit generated markdown routes.

## Phase 6: Search Matrix Hardening

Status: not started

Planned work:

- Strengthen MiniSearch, Pagefind, and provider-owned search coverage.
- Keep browser search coverage to one representative flow.

## Phase 7: Sitemap And Static Output Edge Matrix

Status: not started

Planned work:

- Cover missing translations, nested localized routes, exclusions, drafts,
  partials, alternates, local-origin leaks, and repeated locale prefixes.

## Phase 8: Provider, Cache, And Revalidation Conformance

Status: not started

Planned work:

- Extend provider conformance for envelopes, provider-owned search/site data,
  cache hints, invalidation, and typed negative cases.

## Phase 9: CMS-Neutral Contract And Import Hardening

Status: not started

Planned work:

- Strengthen CMS contract purity, artifact golden tests, field metadata,
  routing modes, unsupported schema diagnostics, and packed subpath imports.

## Phase 10: Docs, Examples, And Public API Drift

Status: not started

Planned work:

- Keep public-surface metadata, docs, examples, package exports, generated
  declarations, and beginner/advanced docs boundaries in sync.
