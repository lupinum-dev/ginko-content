# Integration Testing Refactor Progress

Started: 2026-06-08

Goal: complete `integration-testing-refactor-plan.md` without adding duplicate
test infrastructure or weakening the release gate.

## Current Status

Overall status: in progress

Current phase: Phase 7 - Provider-Owned Sitemap And Search Fixtures

Guiding rules:

- Build production fixtures once when the same fixture/environment output is
  still current.
- Do not cache runtime responses or provider state.
- Prefer artifact-only checks over live servers when no server behavior is
  needed.
- Keep `pnpm run release:verify` as the single release confidence command.
- Do not claim static same-URL markdown negotiation works.

## Phase Summary

| Phase | Name | Status |
| --- | --- | --- |
| 1 | Shared production fixture harness | Completed |
| 2 | Generated artifact assertion library | Completed |
| 3 | Structured sitemap assertions | Completed |
| 4 | Consolidate production fixture builds | In progress |
| 5 | Replace thin wrapper scripts | Completed |
| 6 | Optional dependency integration matrix | Completed |
| 7 | Provider-owned sitemap and search fixtures | Pending |
| 8 | Static and SSR markdown contract hardening | Pending |
| 9 | Browser e2e focus and failure capture | Pending |
| 10 | Packed consumer matrix | Pending |
| 11 | Docs and CI alignment | Pending |
| 12 | Performance and flake budget | Pending |

## Phase 1: Shared Production Fixture Harness

Status: completed

### Todos

- [x] Add `test/helpers/production-fixture.ts`.
- [x] Keep `test/helpers/fixture-server.ts` as a compatibility facade.
- [x] Convert generated-output smoke to artifact-only fixture build.
- [x] Convert sitemap static smoke to artifact-only fixture build.
- [x] Run focused e2e tests.
- [x] Update this progress file with evidence.

### Evidence

- `pnpm vitest run --config vitest.config.ts --project e2e test/e2e/generated-output-smoke.test.ts test/e2e/sitemap-static.test.ts`
  passed before the helper extraction.
- `pnpm vitest run --config vitest.config.ts --project e2e test/e2e/generated-output-smoke.test.ts test/e2e/sitemap-static.test.ts test/e2e/agent-output-smoke.test.ts`
  passed after the helper extraction.
- `pnpm typecheck:source` passed.
- `git diff --check` passed.

### Notes

- Fixture `.output` directories are shared by env variants. The harness must not
  reuse a stale build when the same fixture was rebuilt with different env.

## Phase 2: Generated Artifact Assertion Library

Status: completed

### Todos

- [x] Add `test/helpers/generated-artifacts.ts`.
- [x] Move local-origin, repeated-locale-prefix, private-content, search-index,
  and markdown-route/raw-route artifact assertions into shared helpers.
- [x] Use the helper in generated-output smoke.
- [x] Use the helper in agent-output smoke.
- [x] Use the helper in search matrix checks where static search artifacts are
  asserted.
- [x] Re-run the affected e2e and release-gate checks after the remaining
  conversions.

### Evidence

- `pnpm vitest run --config vitest.config.ts --project e2e test/e2e/generated-output-smoke.test.ts test/e2e/sitemap-static.test.ts test/e2e/agent-output-smoke.test.ts`
  passed.
- `pnpm test:search:matrix` passed after the search matrix switched to the
  shared search-index artifact reader.
- `pnpm typecheck:source` passed.
- `git diff --check` passed.

## Phase 3: Structured Sitemap Assertions

Status: completed

### Todos

- [x] Add `test/helpers/sitemap-artifacts.ts`.
- [x] Parse sitemap index files into child sitemap public paths.
- [x] Parse sitemap URL entries and alternates structurally.
- [x] Convert `test/e2e/sitemap-static.test.ts` away from broad string-only
  assertions for route presence and alternates.
- [x] Add focused negative fixture/assertion coverage for missing/empty child
  sitemaps and repeated locale prefixes.
- [x] Re-run sitemap static checks in the broader release gate.

### Evidence

- `pnpm vitest run --config vitest.config.ts --project e2e test/e2e/generated-output-smoke.test.ts test/e2e/sitemap-static.test.ts test/e2e/agent-output-smoke.test.ts`
  passed.
- `pnpm test:sitemap:static` passed after the sitemap command moved to direct
  Vitest execution.
- `pnpm vitest run --config vitest.config.ts --project unit test/unit/generated-artifact-helpers.test.ts`
  passed with negative coverage for empty sitemap indexes, missing child
  sitemaps, empty child sitemaps, and repeated locale prefixes.
- `pnpm test:e2e` passed and included `test/e2e/sitemap-static.test.ts`.
- `pnpm typecheck:source` passed.
- `git diff --check` passed.

## Phase 4: Consolidate Production Fixture Builds

Status: in progress

### Todos

- [x] Convert `test/e2e/generated-output-smoke.test.ts`.
- [x] Convert `test/e2e/sitemap-static.test.ts`.
- [x] Convert `test/e2e/agent-output-smoke.test.ts`.
- [x] Convert static artifact reads in `test/e2e/search-matrix.test.ts`.
- [x] Convert artifact-only paths in
  `test/e2e/agent-markdown-negotiation.test.ts`.
- [x] Review `test/browser-e2e/locale-search.test.ts` for practical harness
  reuse without hiding browser failure modes.
- [x] Measure current wall-clock time for the broader release commands that are
  practical during this phase.

### Evidence

- `pnpm vitest run --config vitest.config.ts --project e2e test/e2e/generated-output-smoke.test.ts test/e2e/sitemap-static.test.ts test/e2e/agent-output-smoke.test.ts`
  passed.
- `pnpm test:search:matrix` passed.
- `pnpm test:sitemap:static` passed.
- `pnpm vitest run --config vitest.config.ts --project e2e test/e2e/agent-markdown-negotiation.test.ts`
  passed after the artifact-only static markdown check switched to
  `buildProductionFixture`.
- `pnpm test:e2e` passed: 6 files, 12 tests, 239.61s Vitest duration,
  4:01.59 wall-clock.
- `pnpm test:e2e:browser` passed: 1 file, 1 test, 45.64s Vitest duration,
  48.748s wall-clock.

### Notes

- `test/browser-e2e/locale-search.test.ts` already uses the compatibility
  facade backed by the shared production harness. Keeping it server-backed is
  correct because it verifies hydration, browser route transitions, search
  requests, console errors, failed content API requests, and 4xx/5xx responses.

## Phase 5: Replace Thin Wrapper Scripts

Status: completed

### Todos

- [x] Keep the stable command names because they are useful release-gate
  vocabulary.
- [x] Update `package.json` so `test:search:matrix` and
  `test:sitemap:static` call Vitest directly.
- [x] Delete `scripts/test-search-matrix.mjs`.
- [x] Delete `scripts/test-sitemap-static.mjs`.

### Evidence

- `pnpm test:search:matrix` passed.
- `pnpm test:sitemap:static` passed.
- `pnpm typecheck:source` passed.
- `git diff --check` passed.

## Phase 6: Optional Dependency Integration Matrix

Status: completed

### Todos

- [x] Audit optional integrations:
  `@nuxtjs/sitemap`, `@nuxtjs/i18n`, MiniSearch, Pagefind, Shiki, and
  `@shikijs/transformers`.
- [x] Classify each integration dependency.
- [x] Fix the packed-consumer unresolved `@shikijs/transformers` warning by
  making `@shikijs/transformers` a runtime dependency. Built package code can
  import it at runtime, so keeping it as a peer-optional/dev-only dependency
  was the wrong contract.
- [x] Add packed-consumer output validation that rejects unresolved external
  dependency warnings during the fresh Nuxt app build.
- [x] Document the dependency model in the root README and published package
  README.
- [x] Verify MiniSearch, Pagefind, provider-owned search, sitemap, i18n sitemap,
  packed consumer, and docs build gates.

### Dependency Classification

| Integration | Classification |
| --- | --- |
| Shiki and `@shikijs/transformers` | Runtime dependencies of `@lupinum/ginko-content`. |
| MiniSearch | Runtime dependency of `@lupinum/ginko-content`; default built-in search backend. |
| Pagefind | Runtime dependency of `@lupinum/ginko-content`; used when the Pagefind backend is selected. |
| Provider-owned search | Provider capability; no extra package. |
| `@nuxtjs/i18n` | App dependency when Nuxt locale routing is used. |
| `@nuxtjs/sitemap` | App dependency when sitemap XML output is published. |

### Evidence

- `pnpm test:search:matrix` passed for MiniSearch, Pagefind, provider-owned
  search, and disabled search.
- `pnpm test:sitemap:static` passed for i18n sitemap output.
- `pnpm test:package-consumer` passed after the dependency warning became a
  release-gate failure condition.
- `pnpm docs:build` passed.
- `pnpm typecheck:source` passed.
- `git diff --check` passed.
