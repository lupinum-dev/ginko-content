# Integration Testing Refactor Progress

Started: 2026-06-08

Goal: complete `integration-testing-refactor-plan.md` without adding duplicate
test infrastructure or weakening the release gate.

## Current Status

Overall status: completed

Current phase: completed

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
| 4 | Consolidate production fixture builds | Completed |
| 5 | Replace thin wrapper scripts | Completed |
| 6 | Optional dependency integration matrix | Completed |
| 7 | Provider-owned sitemap and search fixtures | Completed |
| 8 | Static and SSR markdown contract hardening | Completed |
| 9 | Browser e2e focus and failure capture | Completed |
| 10 | Packed consumer matrix | Completed |
| 11 | Docs and CI alignment | Completed |
| 12 | Performance and flake budget | Completed |

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

Status: completed

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

## Phase 7: Provider-Owned Sitemap And Search Fixtures

Status: completed

### Todos

- [x] Extend `playground/ginko-provider-search` so the provider advertises and
  implements sitemap entries in addition to provider-owned search.
- [x] Add generated XML coverage proving provider sitemap entries reach Nuxt
  Sitemap output.
- [x] Assert provider sitemap entries use the configured production site URL.
- [x] Assert provider-native storage IDs do not leak into generated sitemap XML.
- [x] Keep provider-owned search coverage for delegation, route-safe paths, and
  absent local index routes.
- [x] Add a provider resolver negative case for sitemap capability without a
  `sitemapEntries` method.
- [x] Add provider sitemap result validation so malformed provider sitemap
  entries fail with `provider_result_invalid`.
- [x] Add a runtime contract test for malformed provider sitemap entries.

### Evidence

- `pnpm vitest run --config vitest.config.ts --project nuxt test/contracts/provider-contracts.test.ts`
  passed.
- `pnpm test:sitemap:static` passed with both filesystem i18n sitemap output
  and provider-owned sitemap XML output.
- `pnpm test:search:matrix` passed after the provider fixture change.
- `pnpm typecheck:source` passed.
- `git diff --check` passed.

## Phase 8: Static And SSR Markdown Contract Hardening

Status: completed

### Todos

- [x] Keep the static same-URL markdown negotiation limitation documented in
  public docs.
- [x] Verify SSR behavior: HTML by default, markdown for
  `Accept: text/markdown`, explicit route markdown, raw markdown, Link headers,
  and `Content-Signal`.
- [x] Verify static-safe behavior: generated `/raw/**.md`,
  `/:route/index.md`, `/llms.txt`, and `/llms-full.txt` outputs.
- [x] Verify disabled agent output returns HTML/404 according to route type.
- [x] Add traversal coverage for raw markdown routes:
  `../`, encoded traversal, double-encoded traversal, null byte, and repeated
  slash normalization.
- [x] Reject unsafe raw request paths before middleware skip logic.

### Evidence

- `pnpm vitest run --config vitest.config.ts --project unit test/unit/agent-markdown.test.ts`
  passed.
- `pnpm vitest run --config vitest.config.ts --project runtime test/runtime/api-auxiliary-boundaries.test.ts`
  passed.
- `pnpm vitest run --config vitest.config.ts --project e2e test/e2e/agent-markdown-negotiation.test.ts`
  passed after the traversal fix.
- `pnpm vitest run --config vitest.config.ts --project e2e test/e2e/agent-markdown-negotiation.test.ts test/e2e/agent-output-smoke.test.ts test/e2e/generated-output-smoke.test.ts`
  passed.
- `pnpm typecheck:source` passed.
- `git diff --check` passed.

## Phase 9: Browser E2E Focus And Failure Capture

Status: completed

### Todos

- [x] Keep browser coverage to one high-signal production fixture flow.
- [x] Extract local browser failure capture for console errors, hydration/Ginko
  warnings, failed `/api/_content` requests, and 4xx/5xx responses.
- [x] Verify German translated route rendering.
- [x] Verify locale switch to English and back to German.
- [x] Verify localized search result path and rendered target page.
- [x] Verify browser back/forward preserves the localized route flow.
- [x] Avoid screenshot or visual-regression expansion.

### Evidence

- `pnpm test:e2e:browser` passed.
- `pnpm typecheck:source` passed.
- `git diff --check` passed.

## Phase 10: Packed Consumer Matrix

Status: completed

### Todos

- [x] Keep the default `test:package-consumer` as the release-gate packed
  install smoke.
- [x] Expand the fresh Nuxt app to install the packed package plus the sitemap
  integration it relies on for XML output.
- [x] Verify the fresh app builds and starts from the packed package.
- [x] Verify public package subpaths import from the packed package output.
- [x] Verify generated declaration files exist in the packed package.
- [x] Verify no `workspace:*` ranges leak into the packed package.
- [x] Verify the fresh app build does not hide unresolved external dependency
  warnings.
- [x] Verify generated sitemap XML, search API/index behavior, and agent
  markdown outputs from the packed package consumer.

### Evidence

- `pnpm test:package-consumer` passed after the fresh app was expanded to
  include `@nuxtjs/sitemap`, content sitemap output, configured agent markdown
  output, `llms.txt`, and raw markdown output.
- `pnpm typecheck:source` passed.
- `git diff --check` passed.

## Phase 11: Docs And CI Alignment

Status: completed

### Todos

- [x] Keep GitHub Actions release verification aligned with
  `pnpm run release:verify`.
- [x] Remove stale failure-triage references to deleted wrapper scripts.
- [x] Document the shared production fixture harness and artifact assertion
  helpers in contributor docs.
- [x] Update the release checklist so packed-consumer coverage includes public
  subpaths, declarations, sitemap XML, search behavior, and agent markdown
  output.
- [x] Verify docs drift and docs build after the documentation changes.

### Evidence

- `.github/workflows/ci.yml` already runs `pnpm run release:verify` in the
  release verification job with Chrome configured for browser e2e.
- `pnpm vitest run --config vitest.config.ts --project unit test/unit/docs-drift.test.ts`
  passed.
- `pnpm docs:build` passed.
- `pnpm typecheck:source` passed.
- `git diff --check` passed.

## Phase 12: Performance And Flake Budget

Status: completed

### Todos

- [x] Record timing baselines for release-sensitive commands.
- [x] Add explicit Vitest timeouts for production e2e projects based on real
  fixture build cost.
- [x] Remove the fixed post-listen delay from the production fixture server
  helper.
- [x] Keep server startup based on observable HTTP readiness.
- [x] Ensure packed-consumer server shutdown waits for process exit before
  escalating to `SIGKILL`.
- [x] Record the shared-dist concurrency rule for release commands.
- [x] Add no retries or quarantines.

### Timing Baseline

| Command | Result | Wall-clock |
| --- | --- | --- |
| `pnpm test:e2e` | Passed, 6 files / 14 tests | 4:23.93 |
| `pnpm test:e2e:browser` | Passed, 1 file / 1 test | 39.007s |
| `pnpm test:package-consumer` | Passed | 1:19.75 |
| `pnpm run release:verify` | Passed | 21:07.95 |

### Evidence

- `pnpm test:package-consumer` passed after packed-consumer shutdown was made
  polling-based.
- `pnpm test:e2e` passed after the fixed readiness delay was removed from the
  shared production fixture helper.
- `pnpm test:e2e:browser` passed with the same readiness helper.

### Notes

- Do not run package-building commands such as `pnpm test:package-consumer` in
  parallel with production fixture e2e commands. The packed-consumer script
  intentionally builds and packs the package, which cleans `packages/content/dist`.
  Fixture builds import the workspace package output. `pnpm run release:verify`
  runs these checks sequentially and is the supported confidence gate.
- No test retry or quarantine was added.

## Final Release Verification

Status: completed

### Evidence

- `pnpm run release:verify` passed after all phases were completed.
- The release gate ran the full workspace verification, packed consumer smoke,
  browser e2e, search matrix, static sitemap checks, production audit, and local
  release pack.
- The packed consumer check installed the local tarball into a fresh Nuxt app,
  verified public subpath imports and declarations, built and started the app,
  and checked search, sitemap, and agent markdown outputs from the installed
  package.
- The final release pack wrote
  `.pack/lupinum-ginko-content-0.1.4.tgz` for human inspection. The tarball is
  intentionally not committed.
