# Integration Testing Refactor Progress

Started: 2026-06-08

Goal: complete `integration-testing-refactor-plan.md` without adding duplicate
test infrastructure or weakening the release gate.

## Current Status

Overall status: in progress

Current phase: Phase 2 - Generated Artifact Assertion Library

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
| 2 | Generated artifact assertion library | In progress |
| 3 | Structured sitemap assertions | In progress |
| 4 | Consolidate production fixture builds | Pending |
| 5 | Replace thin wrapper scripts | Pending |
| 6 | Optional dependency integration matrix | Pending |
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

Status: in progress

### Todos

- [x] Add `test/helpers/generated-artifacts.ts`.
- [x] Move local-origin, repeated-locale-prefix, private-content, search-index,
  and markdown-route/raw-route artifact assertions into shared helpers.
- [x] Use the helper in generated-output smoke.
- [x] Use the helper in agent-output smoke.
- [ ] Use the helper in search matrix checks where static search artifacts are
  asserted.
- [ ] Re-run the affected e2e and release-gate checks after the remaining
  conversions.

### Evidence

- `pnpm vitest run --config vitest.config.ts --project e2e test/e2e/generated-output-smoke.test.ts test/e2e/sitemap-static.test.ts test/e2e/agent-output-smoke.test.ts`
  passed.
- `pnpm typecheck:source` passed.
- `git diff --check` passed.

## Phase 3: Structured Sitemap Assertions

Status: in progress

### Todos

- [x] Add `test/helpers/sitemap-artifacts.ts`.
- [x] Parse sitemap index files into child sitemap public paths.
- [x] Parse sitemap URL entries and alternates structurally.
- [x] Convert `test/e2e/sitemap-static.test.ts` away from broad string-only
  assertions for route presence and alternates.
- [ ] Add focused negative fixture/assertion coverage for missing/empty child
  sitemaps and repeated locale prefixes.
- [ ] Re-run sitemap static checks in the broader release gate.

### Evidence

- `pnpm vitest run --config vitest.config.ts --project e2e test/e2e/generated-output-smoke.test.ts test/e2e/sitemap-static.test.ts test/e2e/agent-output-smoke.test.ts`
  passed.
- `pnpm typecheck:source` passed.
- `git diff --check` passed.
