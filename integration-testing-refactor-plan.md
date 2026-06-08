# Integration Testing Refactor Plan

Status: proposed implementation plan

Goal: make Ginko Content's production integration tests faster, clearer, less
duplicated, and stronger. This plan builds on `testing-10-10-roadmap.md` and
`testing-10-10-progress.md`; it does not replace them.

The target is maximum practical release confidence:

- real built package behavior, not only source imports.
- real Nuxt production output, not mocked module behavior.
- real packed-package installs, not only workspace links.
- small browser coverage for browser-only risk.
- deep contract/unit coverage for pure behavior.
- no second source of truth between docs, generated assets, public metadata,
  package exports, and test fixtures.

## Current Baseline

The current release gate is strong and should be preserved:

```bash
pnpm run release:verify
```

It already runs the workspace verification, packed consumer test, browser e2e,
search matrix, static sitemap check, production audit, and release packaging.

The current weakness is not lack of total coverage. The weakness is that
production fixture testing is still too expensive and too fragmented:

- `test/e2e/generated-output-smoke.test.ts` builds and inspects generated
  artifacts.
- `test/e2e/sitemap-static.test.ts` builds the same i18n fixture again for
  focused sitemap assertions.
- `test/e2e/search-matrix.test.ts` builds several search fixtures.
- `test/e2e/agent-output-smoke.test.ts` builds the agent fixture.
- `test/browser-e2e/locale-search.test.ts` builds and drives a production
  browser flow.
- `scripts/test-search-matrix.mjs` and `scripts/test-sitemap-static.mjs` are
  thin wrappers around one Vitest file each.
- `test/helpers/fixture-server.ts` builds packages, builds a fixture, starts a
  server, and exposes only a running server handle, even when the test only
  needs `.output/public`.

This creates avoidable rebuilds, repeated assertions, and a higher cost for
adding better integration checks.

## Design Principles

- Keep one canonical release gate: `pnpm run release:verify`.
- Prefer one shared fixture harness over per-test process orchestration.
- Separate generated artifact checks from live server checks.
- Use structured assertions instead of regex-heavy ad hoc parsing where the
  output has a known format.
- Keep browser tests tiny and focused on hydration, navigation, locale
  switching, and client-side behavior.
- Keep fixture apps small, named by risk area, and documented.
- Avoid fixture snapshots that make refactoring painful.
- Do not claim static same-URL `Accept: text/markdown` negotiation works.
- Do not introduce compatibility shims, test-only production code, or hidden
  test behavior.

## End State

The release owner should be able to say:

`pnpm run release:verify` passed from a clean tree. The suite built the package,
installed the tarball into a fresh Nuxt app, built production fixtures, inspected
generated HTML/search/sitemap/agent artifacts, ran live server API checks, ran
one browser flow for locale/search navigation, and proved no drafts, partials,
private records, local origins, raw provider paths, or repeated locale prefixes
leaked into public output.

The suite should also be efficient enough that adding one more generated-output
assertion does not require adding another full Nuxt build.

## Phase 1: Shared Production Fixture Harness

Goal: replace repeated fixture setup with one small, explicit test harness.

### Todos

- [ ] Add `test/helpers/production-fixture.ts`.
- [ ] Keep `test/helpers/fixture-server.ts` temporarily, but move reusable
      logic into the new helper.
- [ ] Support these operations:
      - build workspace packages once per Vitest process.
      - build a fixture once per fixture root plus environment variant.
      - expose `publicDir`, `serverDir`, and build metadata.
      - optionally start the built Nitro server.
      - stop the server reliably in `finally`.
      - capture build/server output and print it only on failure.
      - allocate deterministic safe ports.
- [ ] Add a stable fixture key format:
      `relativeFixturePath + sortedEnv + buildMode`.
- [ ] Avoid cross-test mutable request state. Cache only build artifacts, not
      runtime server responses.
- [ ] Add a helper to invalidate a fixture build when the fixture directory
      changes inside the same run, if future dev/HMR tests need it.
- [ ] Update one test first, preferably `generated-output-smoke.test.ts`, to
      prove the helper shape.

### Verification

```bash
pnpm vitest run --config vitest.config.ts --project e2e \
  test/e2e/generated-output-smoke.test.ts

pnpm test:e2e
pnpm typecheck:source
git diff --check
```

### Acceptance Criteria

- Existing e2e behavior is unchanged.
- A generated-output-only test can inspect `.output/public` without starting a
  server.
- A live-server test can start the same built fixture without triggering a
  second build.
- Failure messages include the fixture path and relevant captured output.

## Phase 2: Generated Artifact Assertion Library

Goal: make generated-output tests semantic, consistent, and easy to extend.

### Todos

- [ ] Add `test/helpers/generated-artifacts.ts`.
- [ ] Implement:
      - `listGeneratedTextArtifacts(publicDir)`.
      - `readGeneratedArtifact(publicDir, path)`.
      - `assertNoLocalOrigins(artifacts)`.
      - `assertNoRepeatedLocalePrefixes(artifacts, locales)`.
      - `assertNoRawInternalPaths(artifacts)`.
      - `assertNoPrivateContentLeaks(artifacts, forbiddenTerms)`.
      - `readSearchIndex(publicDir)`.
      - `readMarkdownPair(publicDir, routePath)`.
- [ ] Use helpers in generated output, sitemap, search, and agent e2e tests.
- [ ] Keep assertion messages path-specific so failures immediately identify
      the bad generated file.

### Verification

```bash
pnpm vitest run --config vitest.config.ts --project e2e \
  test/e2e/generated-output-smoke.test.ts \
  test/e2e/sitemap-static.test.ts \
  test/e2e/agent-output-smoke.test.ts

pnpm test:e2e
```

### Acceptance Criteria

- No loss of current assertions.
- Repeated local-origin and repeated-locale-prefix checks are centralized.
- New generated-output checks can be added without copying regex blocks.

## Phase 3: Structured Sitemap Assertions

Goal: make sitemap integration tests stronger and less brittle.

### Todos

- [ ] Add `test/helpers/sitemap-artifacts.ts`.
- [ ] Implement lightweight XML parsing helpers:
      - `parseSitemapIndex(xml)`.
      - `parseSitemapUrlset(xml)`.
      - `readSitemapBundle(publicDir)`.
      - `collectSitemapLocs(bundle)`.
      - `collectHreflangAlternates(bundle)`.
- [ ] Replace ad hoc `<loc>` regex parsing in
      `test/e2e/sitemap-static.test.ts`.
- [ ] Assert these invariants:
      - `sitemap_index.xml` points to expected child sitemaps.
      - each expected locale child sitemap exists.
      - each expected child sitemap is non-empty.
      - localized content paths are in the correct sitemap.
      - alternates point at route-safe localized paths.
      - data-only, draft, partial, and private routes are absent.
      - no `_payload`, `/api/_content`, raw `_path`, localhost, or repeated
        locale prefixes appear in sitemap output.
- [ ] Add one focused negative fixture or synthetic assertion test for:
      - empty child sitemap.
      - missing child sitemap.
      - placeholder host.
      - forbidden internal path.

### Verification

```bash
pnpm vitest run \
  test/contracts/sitemap-assert-contracts.test.ts \
  test/contracts/sitemap-query-contracts.test.ts

pnpm vitest run --config vitest.config.ts --project e2e \
  test/e2e/sitemap-static.test.ts
```

### Acceptance Criteria

- Sitemap tests explain failures in terms of sitemap contract violations.
- Sitemap XML parsing is shared and not duplicated between e2e and doctor tests
  unless there is a strong reason.
- Negative cases prove the assertions fail when the output is unsafe.

## Phase 4: Consolidate Production Fixture Builds

Goal: reduce release-gate time without weakening coverage.

### Todos

- [ ] Convert these tests to use the shared production fixture harness:
      - `test/e2e/generated-output-smoke.test.ts`.
      - `test/e2e/sitemap-static.test.ts`.
      - `test/e2e/agent-output-smoke.test.ts`.
      - `test/e2e/search-matrix.test.ts`.
      - `test/e2e/agent-markdown-negotiation.test.ts`.
      - `test/browser-e2e/locale-search.test.ts`, if practical.
- [ ] Avoid starting a server for artifact-only tests.
- [ ] Keep a server for API, content negotiation, search endpoint, and browser
      tests.
- [ ] Measure before/after wall-clock time for:
      - `pnpm test:e2e`.
      - `pnpm test:search:matrix`.
      - `pnpm test:sitemap:static`.
      - `pnpm run release:verify`.
- [ ] Record timing evidence in `testing-10-10-progress.md` or a new progress
      note.

### Verification

```bash
pnpm test:e2e
pnpm test:e2e:browser
pnpm test:search:matrix
pnpm test:sitemap:static
pnpm run release:verify
```

### Acceptance Criteria

- The same or stronger assertions pass.
- The release gate is not slower.
- Production fixture output remains deterministic.
- No test requires knowledge of another test's execution order.

## Phase 5: Replace Thin Wrapper Scripts

Goal: remove command indirection that does not add behavior.

### Todos

- [ ] Decide whether stable command names are worth keeping.
- [ ] If keeping names, update `package.json` scripts to call Vitest directly:
      - `test:search:matrix`.
      - `test:sitemap:static`.
- [ ] Delete `scripts/test-search-matrix.mjs` and
      `scripts/test-sitemap-static.mjs` if they remain thin wrappers.
- [ ] If script behavior is needed later, create one real script:
      `scripts/test-production-fixtures.mjs`.
- [ ] Update docs that mention the deleted scripts.

### Verification

```bash
pnpm test:search:matrix
pnpm test:sitemap:static
pnpm run release:verify
git diff --check
```

### Acceptance Criteria

- Fewer files own the same command behavior.
- Command names remain stable for maintainers and CI.
- No wrapper script exists unless it performs real orchestration.

## Phase 6: Optional Dependency Integration Matrix

Goal: prove integrations fail clearly when optional dependencies are absent and
work correctly when present.

### Todos

- [ ] Audit optional integrations:
      - `@nuxtjs/sitemap`.
      - `@nuxtjs/i18n`.
      - MiniSearch.
      - Pagefind.
      - Shiki / `@shikijs/transformers`.
- [ ] Classify each as:
      - required runtime dependency.
      - optional dependency with guarded behavior.
      - peer dependency documented for a feature.
      - dev-only fixture dependency.
- [ ] Fix unresolved packed-consumer warnings if they are product issues.
      Current warning to classify:
      `@shikijs/transformers` unresolved from `dist/parsers/markdown-plugins.js`.
- [ ] Add tests for:
      - sitemap enabled with `@nuxtjs/sitemap`.
      - sitemap enabled without `@nuxtjs/sitemap`.
      - i18n enabled with localized sitemap.
      - Pagefind selected and assets emitted.
      - Pagefind selected but dependency missing, if the dependency is meant to
        be optional.
      - MiniSearch selected and search endpoint works.
      - provider-owned search selected and local index routes are absent.
- [ ] Add docs mapping feature flags to dependency requirements.

### Verification

```bash
pnpm test:search:matrix
pnpm test:sitemap:static
pnpm test:package-consumer
pnpm docs:build
pnpm run release:verify
```

### Acceptance Criteria

- Optional integration behavior is documented and tested.
- Missing optional dependencies fail with actionable diagnostics or are lazily
  avoided.
- Packed consumer output has no unexplained unresolved dependency warnings.

## Phase 7: Provider-Owned Sitemap And Search Fixtures

Goal: prove external providers are not second-class citizens in generated
output.

### Todos

- [ ] Extend or add a compact provider-owned fixture that implements:
      - `query`.
      - `page`.
      - `routeMeta`.
      - `search`.
      - `sitemapEntries`.
      - optional `siteData`.
- [ ] Assert provider-owned search:
      - delegates to provider search.
      - returns route-safe paths.
      - excludes provider-native storage IDs.
      - omits local search index routes.
- [ ] Assert provider-owned sitemap:
      - provider entries reach final generated XML.
      - provider entries use production `site.url`.
      - provider entries include alternates where available.
      - disabled/data-only provider content does not leak.
- [ ] Add negative provider cases:
      - provider advertises sitemap capability but has no method.
      - provider method returns malformed sitemap entries.
      - provider lacks sitemap capability and public sitemap is requested.

### Verification

```bash
pnpm vitest run \
  test/contracts/provider-contracts.test.ts \
  test/contracts/provider-fixture-conformance.test.ts \
  test/contracts/filesystem-provider-conformance.test.ts

pnpm test:search:matrix
pnpm test:sitemap:static
```

### Acceptance Criteria

- Runtime/API/module code does not branch on provider names.
- Provider-owned search and sitemap paths are tested through provider
  capabilities.
- Unsupported provider behavior fails with `ContentProviderError`.

## Phase 8: Static And SSR Markdown Contract Hardening

Goal: make markdown/LLM behavior explicit across deployment modes.

### Todos

- [ ] Keep static limitation documented:
      static prerendered HTML cannot universally support same-URL
      `Accept: text/markdown`.
- [ ] Test SSR behavior:
      - content route with `Accept: text/markdown` returns markdown.
      - content route without markdown accept returns HTML.
      - Link headers advertise alternates only when the route exists.
- [ ] Test static-safe behavior:
      - `/raw/**.md` exists.
      - `/:route/index.md` exists.
      - `/llms.txt` exists when enabled.
      - `/llms-full.txt` exists when enabled.
      - disabled agent output returns documented status.
- [ ] Add one negative path traversal suite:
      - `../`.
      - encoded traversal.
      - null byte.
      - repeated slash policy.

### Verification

```bash
pnpm vitest run \
  test/unit/agent-markdown.test.ts \
  test/runtime/api-auxiliary-boundaries.test.ts

pnpm vitest run --config vitest.config.ts --project e2e \
  test/e2e/agent-markdown-negotiation.test.ts \
  test/e2e/agent-output-smoke.test.ts \
  test/e2e/generated-output-smoke.test.ts
```

### Acceptance Criteria

- SSR and static markdown contracts are tested separately.
- Static deployments have a reliable documented path.
- No test or doc implies static same-URL negotiation works everywhere.

## Phase 9: Browser E2E Focus And Failure Capture

Goal: keep browser coverage small but make failures highly actionable.

### Todos

- [ ] Add browser helper utilities:
      - collect console errors.
      - collect failed requests.
      - fail on hydration warnings.
      - assert no failed `/api/_content` calls.
- [ ] Keep one main browser flow:
      - open German translated route.
      - assert German content.
      - click locale switch.
      - assert English route and content.
      - use search.
      - click localized search result.
      - assert route-safe URL and content.
      - browser back/forward still preserves locale state.
- [ ] Add one optional agent discovery browser check only if runtime Link
      headers cannot be proven well enough through server fetches.
- [ ] Do not add broad visual/screenshot regression tests.

### Verification

```bash
pnpm test:e2e:browser
pnpm run release:verify
```

### Acceptance Criteria

- Browser failures include console and network diagnostics.
- Browser e2e remains small.
- The browser suite catches real user-flow regressions that unit/contract tests
  cannot catch.

## Phase 10: Packed Consumer Matrix

Goal: make tarball confidence cover the most important real install shapes.

### Todos

- [ ] Extend `scripts/test-packed-consumer.mjs` to support scenario variants:
      - minimal quickstart.
      - i18n route page.
      - sitemap enabled.
      - search enabled.
      - agent markdown enabled.
      - CMS-neutral subpath import smoke.
- [ ] Keep the default `test:package-consumer` small enough for PR/release use.
- [ ] Add an optional broader command if needed:
      `test:package-consumer:matrix`.
- [ ] Assert:
      - every public export subpath imports.
      - generated `.d.ts` files resolve.
      - no `workspace:*`.
      - no forbidden tarball files.
      - built server serves one content page and one API route.
      - optional feature dependencies are either installed or fail clearly.

### Verification

```bash
pnpm test:package-consumer
pnpm run release:pack
pnpm run release:verify
```

### Acceptance Criteria

- Tarball install is tested outside the monorepo.
- Public package artifacts match the documented export surface.
- The consumer test catches missing files, missing declarations, and missing
  required dependencies before publish.

## Phase 11: Docs And CI Alignment

Goal: make documentation, commands, and CI describe the same release reality.

### Todos

- [ ] Update `CONTRIBUTING.md` with the new fixture harness workflow.
- [ ] Update `MAINTAINING.md` with the refined release gate.
- [ ] Update `docs/release-checklist.md` if command names change.
- [ ] Update public production-readiness docs with any dependency-policy
      decisions.
- [ ] Keep GitHub Actions release job aligned with `pnpm run release:verify`.
- [ ] Add docs drift checks if new public dependency requirements are
      documented in multiple places.

### Verification

```bash
pnpm vitest run test/unit/docs-drift.test.ts
pnpm docs:build
pnpm run release:verify
```

### Acceptance Criteria

- There is one documented release command.
- Public docs do not teach unsupported behavior.
- Internal maintainer docs and CI do not diverge.

## Phase 12: Performance And Flake Budget

Goal: keep maximum confidence sustainable.

### Todos

- [ ] Record baseline timings for:
      - `pnpm test:e2e`.
      - `pnpm test:e2e:browser`.
      - `pnpm test:package-consumer`.
      - `pnpm run release:verify`.
- [ ] After fixture-harness consolidation, record the new timings.
- [ ] Add explicit timeouts per test based on real build cost.
- [ ] Remove arbitrary sleeps where polling can observe readiness.
- [ ] Make server startup wait for real readiness, not only output text.
- [ ] Ensure every child process is stopped in `finally`.
- [ ] Add an issue for any test that needs retry/quarantine. Do not keep
      permanent quarantine.

### Verification

```bash
pnpm test:e2e
pnpm test:e2e:browser
pnpm run release:verify
```

### Acceptance Criteria

- The suite has known timing characteristics.
- No test depends on execution order.
- No long-running child process remains after test completion.
- The release gate remains practical for maintainers.

## Proposed Implementation Order

1. Phase 1: shared production fixture harness.
2. Phase 2: generated artifact assertion library.
3. Phase 3: structured sitemap assertions.
4. Phase 4: consolidate production fixture builds.
5. Phase 5: remove thin wrapper scripts.
6. Phase 6: optional dependency integration matrix.
7. Phase 7: provider-owned sitemap and search fixtures.
8. Phase 8: static and SSR markdown contract hardening.
9. Phase 9: browser e2e failure capture.
10. Phase 10: packed consumer matrix.
11. Phase 11: docs and CI alignment.
12. Phase 12: performance and flake budget.

Do not merge a later phase that relies on duplicated fixture orchestration if
an earlier phase can remove that duplication first.

## Highest-Impact First Pull Request

The first PR should be intentionally narrow:

- Add `test/helpers/production-fixture.ts`.
- Convert `generated-output-smoke.test.ts` to use it.
- Convert `sitemap-static.test.ts` to use artifact-only output where possible.
- Keep command behavior unchanged.
- Run:

```bash
pnpm vitest run --config vitest.config.ts --project e2e \
  test/e2e/generated-output-smoke.test.ts \
  test/e2e/sitemap-static.test.ts

pnpm test:e2e
pnpm run release:verify
```

This PR proves the new shape without changing every test at once.

## Risks And Mitigations

- Risk: shared fixture build caching creates hidden coupling.
  Mitigation: cache only build artifacts by explicit fixture key; never cache
  runtime responses or provider state.

- Risk: integration helpers become a second framework.
  Mitigation: keep helpers small, test-specific, and boring. Delete helpers
  that only wrap one line.

- Risk: stronger release gate becomes too slow.
  Mitigation: measure timings and move broad matrices behind explicit release
  or nightly commands while keeping the stable release gate meaningful.

- Risk: optional dependency behavior is ambiguous.
  Mitigation: classify each dependency once, document it, and enforce it in
  packed-consumer or fixture tests.

- Risk: sitemap XML parsing becomes over-engineered.
  Mitigation: use a small XML parser or minimal structured helper scoped to
  sitemap tags. Avoid a generic XML abstraction.

## Definition Of Done

This refactor is done when:

- production fixture builds are shared or intentionally isolated.
- artifact-only tests do not start servers.
- live server tests do not rebuild fixtures unnecessarily.
- sitemap/search/agent/generated-output assertions use shared semantic helpers.
- optional dependency behavior is documented and tested.
- provider-owned search and sitemap generated-output paths are covered.
- browser e2e captures console and network failures.
- packed consumer tests cover the minimum real install surfaces.
- docs, CI, package scripts, and release instructions agree.
- `pnpm run release:verify` passes from a clean tree.
