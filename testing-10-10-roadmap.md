# Ginko Content 10/10 Testing Roadmap

Status: implementation roadmap

Audience: maintainers, contributors, release owners, and coding agents

Scope: `@lupinum/ginko-content`, filesystem provider, provider contract,
runtime APIs, generated output, package artifacts, public docs/examples,
CMS-neutral contract/import surfaces, cache/revalidation helpers, sitemap,
search, i18n routing, and agent-readable markdown/LLM output.

## End Goal

Ginko reaches a 10/10 testing standard when a maintainer can release from a
clean tree and say:

`pnpm release:verify` passed. The package was packed and installed into a fresh
Nuxt app outside the monorepo. The fresh app typechecked, built, started, and
served content. Production browser e2e passed for locale switching and search.
Static output checks passed for localized pages, search payloads, sitemaps,
raw markdown, `llms.txt`, and `llms-full.txt`. Provider conformance passed for
filesystem, in-memory, malformed, provider-owned search, and cache fixtures.
Public export, generated type, docs drift, CMS contract, and package-surface
checks passed. Static markdown negotiation limitations are documented honestly.
No known flaky test was ignored.

This roadmap turns that target into phases. Each phase should be merged only
after its verification steps pass.

## Current Baseline

Already strong:

- Vitest project separation exists in `vitest.config.ts`.
- Contract tests exist for architecture, package exports, runtime assets,
  provider fixtures, query responses, sitemap assertions, and docs drift.
- Provider fixture/conformance infrastructure exists in
  `packages/content/src/testing`.
- Production server fetch smoke exists in `test/e2e/prod-smoke.test.ts`.
- `test/helpers/fixture-server.ts` can build and serve production fixtures.
- Downstream consumer has proven useful generated-output assertions in
  `/Users/matthias/Git/workspace/shadcn-starter-i18n/app/generated-output.test.ts`.

Known gaps:

- No library-owned browser e2e for hydration, clicked locale switching, or
  search UI.
- No packed fresh Nuxt consumer test outside the monorepo.
- No compact internal `agent-output` fixture matching real downstream custom
  serializer usage.
- No internal generated-output test as strong as the downstream consumer.
- Pagefind/static search needs stronger production-output coverage.
- SSR/hybrid markdown negotiation needs a focused fixture separate from static
  prerender behavior.
- The release gate does not yet run package consumer, browser, static-output,
  search matrix, and agent-output gates.

Known limitation:

- Pure static prerendered HTML cannot universally support same-URL
  `Accept: text/markdown` negotiation or middleware-generated `Link` headers.
  Static deployments must use generated markdown routes such as `/raw/**.md`,
  `/:route/index.md`, `/llms.txt`, and `/llms-full.txt`.

## Phase 0: Stabilize The Current Confidence Baseline

Goal: make sure the current refactor remains green before adding new test
infrastructure.

### Todos

- [ ] Run the focused library contract gate.
- [ ] Run source typecheck.
- [ ] Run docs build.
- [ ] Run package build.
- [ ] Run downstream tarball install/build/check against
      `/Users/matthias/Git/workspace/shadcn-starter-i18n`.
- [ ] Keep `confidence-verification.md` updated with actual evidence.
- [ ] Keep the static markdown negotiation limitation documented in public docs.

### Verification

```bash
pnpm vitest run \
  test/contracts/architecture-boundaries.test.ts \
  test/contracts/package-exports-contracts.test.ts \
  test/contracts/provider-fixture-conformance.test.ts \
  test/contracts/query-response-contracts.test.ts \
  test/contracts/runtime-assets-contracts.test.ts \
  test/contracts/runtime-config-contracts.test.ts \
  test/contracts/sitemap-assert-contracts.test.ts \
  test/unit/docs-drift.test.ts \
  test/unit/agent-markdown.test.ts \
  test/unit/static-output-routes.test.ts \
  test/unit/pagefind.test.ts

pnpm typecheck:source
pnpm build:packages
pnpm docs:build
git diff --check
```

Downstream:

```bash
mkdir -p /Users/matthias/Git/workspace/.local-tarballs
pnpm pack --pack-destination /Users/matthias/Git/workspace/.local-tarballs

cd /Users/matthias/Git/workspace/shadcn-starter-i18n
pnpm add -w /Users/matthias/Git/workspace/.local-tarballs/lupinum-ginko-content-*.tgz
pnpm build
pnpm test app/generated-output.test.ts
pnpm check
git diff --check
```

### Acceptance Criteria

- All commands pass.
- Any warnings are classified as Ginko-caused or unrelated.
- `confidence-verification.md` records the exact commands and result.
- No claim is made that static same-URL markdown negotiation works.

## Phase 1: Internal Generated-Output Smoke

Goal: bring the consumer's strongest pattern into the library: build a real
fixture, inspect `.output/public`, and assert generated artifacts semantically.

### Todos

- [ ] Create `test/e2e/generated-output-smoke.test.ts`.
- [ ] Reuse `startFixtureServer` or add a helper that builds a fixture and
      exposes its `.output/public` path.
- [ ] Choose or create one small production fixture with:
      two locales, translated content routes, one data-only collection, one
      draft/partial, sitemap enabled, search enabled, and agent markdown
      enabled.
- [ ] Assert generated HTML exists for expected localized pages.
- [ ] Assert sitemap includes expected content routes.
- [ ] Assert sitemap excludes disabled, draft, partial, and data-only routes.
- [ ] Assert sitemap alternates point at translated public paths.
- [ ] Assert no sitemap or HTML artifact contains `127.0.0.1`, `localhost`,
      or `[::1]`.
- [ ] Assert generated raw markdown files exist.
- [ ] Assert `/:route/index.md` equals the corresponding `/raw/**.md`.
- [ ] Assert `llms.txt` and `llms-full.txt` exist when enabled.
- [ ] Assert generated output contains no repeated locale prefixes such as
      `/de/de/` or `/en/en/`.

### Verification

```bash
pnpm vitest run --config vitest.config.ts --project e2e \
  test/e2e/generated-output-smoke.test.ts

pnpm test:e2e
git diff --check
```

### Acceptance Criteria

- Static output is validated from actual `.output/public`, not mocked data.
- Assertions are semantic and small; no giant HTML/XML snapshots.
- The test fails if local origins leak into generated sitemap or HTML.
- The test fails if generated markdown routes disappear.

## Phase 2: Compact Agent Output Fixture

Goal: make agent-readable output a first-class tested product surface.

### Todos

- [ ] Add `playground/ginko-agent-output`.
- [ ] Keep fixture content tiny and readable.
- [ ] Include two locales: `de` and `en`.
- [ ] Include one docs page collection with translated slugs.
- [ ] Include one service-like page collection with translated collection
      roots.
- [ ] Include one legal/app page configured with `defineAgentAppPage`.
- [ ] Include one data collection excluded from agent output.
- [ ] Include one draft and one partial that must not appear in agent output.
- [ ] Add fake MDC components:
      `callout`, `card`, `gallery`, `chart`, and `consent-embed`.
- [ ] Register custom serializers in a fixture server plugin using
      `registerAgentMarkdownSerializers`,
      `registerAgentMarkdownComponents`, and
      `defineAgentMarkdownComponent`.
- [ ] Assert custom serializer output appears in `/raw/**.md`.
- [ ] Assert custom serializer output appears in `llms-full.txt`.
- [ ] Assert unknown components use the documented fallback.
- [ ] Assert disabled/draft/private/data-only content does not leak.
- [ ] Assert agent paths reject traversal and encoded traversal.

### Verification

```bash
pnpm --dir playground/ginko-agent-output build

pnpm vitest run \
  test/unit/agent-markdown.test.ts \
  test/runtime/api-auxiliary-boundaries.test.ts \
  test/e2e/generated-output-smoke.test.ts

pnpm test:e2e
```

### Acceptance Criteria

- The fixture proves real downstream-style custom serializers without copying
  the downstream business app.
- Agent output is deterministic.
- `llms.txt` is concise and link-based.
- `llms-full.txt` includes allowed content only.
- Raw markdown contains content body and serializer output, not HTML layout.

## Phase 3: Production Browser E2E

Goal: prove the browser-only risks: hydration, clicked locale switching, search
UI, and client navigation.

### Todos

- [ ] Decide whether to use `@nuxt/test-utils/e2e` browser support inside
      Vitest or add a small `@playwright/test` command.
- [ ] Add a browser test project or script named `test:e2e:browser`.
- [ ] Start a production-built fixture server before the browser test.
- [ ] Fail the test on Ginko-related console errors.
- [ ] Fail the test on failed content API/search requests.
- [ ] Use accessible names or stable test ids, not layout/CSS selectors.
- [ ] Open a German translated docs route.
- [ ] Assert German heading/body is rendered.
- [ ] Click the English locale switch.
- [ ] Assert the URL becomes the canonical English translated route.
- [ ] Assert English heading/body is rendered.
- [ ] Click back to German and assert the German translated route.
- [ ] Open search UI.
- [ ] Search for a locale-specific term.
- [ ] Assert at least one route-safe result.
- [ ] Click the result and assert final URL and heading.

### Verification

```bash
pnpm test:e2e:browser
```

If implemented through Vitest:

```bash
pnpm vitest run --config vitest.config.ts --project e2e \
  test/e2e/browser-locale-search.test.ts
```

### Acceptance Criteria

- Test runs against a production-built server, not dev mode.
- Locale switching is click-tested in a browser.
- Search result navigation is click-tested in a browser.
- No hydration or Ginko runtime errors appear.
- Browser coverage stays small; query/provider/markdown internals remain in
  lower-level tests.

## Phase 4: Packed Fresh Nuxt Consumer Test

Goal: prove the package works outside the monorepo from the built tarball.

### Todos

- [ ] Add `scripts/test-packed-consumer.mjs`.
- [ ] Add `test:package-consumer` script.
- [ ] Build packages before packing.
- [ ] Pack `packages/content` into a temp directory.
- [ ] Create a temp Nuxt app outside the monorepo.
- [ ] Install the packed tarball and required peer dependencies.
- [ ] Add minimal `content.config.ts`.
- [ ] Add one Markdown file.
- [ ] Add one route page using the public client API.
- [ ] Run `nuxi prepare`.
- [ ] Run typecheck.
- [ ] Run production build.
- [ ] Start the built server.
- [ ] Fetch `/` and one content API route.
- [ ] Import every public subpath from the packed package:
      `@lupinum/ginko-content`,
      `@lupinum/ginko-content/config`,
      `@lupinum/ginko-content/client`,
      `@lupinum/ginko-content/server`,
      `@lupinum/ginko-content/toc`,
      `@lupinum/ginko-content/transformers`,
      `@lupinum/ginko-content/cms-contract`,
      `@lupinum/ginko-content/cms-import`,
      `@lupinum/ginko-content/testing/provider-fixture`,
      and `@lupinum/ginko-content/testing/provider-contract`.
- [ ] Assert packed output contains no `workspace:*`.
- [ ] Assert expected `.d.ts` files exist.
- [ ] Clean up temp dirs and server process in `finally`.

### Verification

```bash
pnpm test:package-consumer
pnpm pack:check
```

### Acceptance Criteria

- The test does not rely on workspace source links.
- The app typechecks, builds, starts, and serves content.
- Every public subpath resolves from packed output.
- Failure messages identify missing export, missing declaration, install
  failure, build failure, or runtime failure.

## Phase 5: SSR And Static Markdown Contracts

Goal: make markdown negotiation behavior precise and tested by deployment mode.

### Todos

- [ ] Add a focused SSR/hybrid fixture or route that is not prerendered.
- [ ] Enable `content.agent.markdownNegotiation`.
- [ ] Enable `content.agent.linkHeaders`.
- [ ] Fetch a non-prerendered route without `Accept: text/markdown`.
- [ ] Assert it returns HTML.
- [ ] Fetch the same route with `Accept: text/markdown`.
- [ ] Assert it returns markdown.
- [ ] Assert HTTP `Link` headers are present where the alternate exists.
- [ ] Assert an unknown route returns a documented 404/error.
- [ ] Assert disabled agent markdown returns documented status.
- [ ] Keep static generated-output tests asserting explicit markdown URLs work.
- [ ] Keep docs saying same-URL negotiation is SSR/hybrid behavior, not a pure
      static guarantee.

### Verification

```bash
pnpm vitest run \
  test/unit/agent-markdown.test.ts \
  test/runtime/api-auxiliary-boundaries.test.ts

pnpm test:e2e
pnpm test:e2e:browser
pnpm docs:build
```

### Acceptance Criteria

- Static behavior and SSR/hybrid behavior are tested separately.
- Tests do not expect middleware headers on already-prerendered static HTML.
- Public docs match the tested contract.

## Phase 6: Search Matrix Hardening

Goal: prove search behavior across MiniSearch, Pagefind, and provider-owned
search without exploding the fixture matrix.

### Todos

- [ ] Keep one MiniSearch fixture with localized search.
- [ ] Add or strengthen one Pagefind static-output fixture.
- [ ] Add one provider-owned search fixture.
- [ ] Assert search payloads contain route-safe public paths.
- [ ] Assert search excludes drafts, partials, private fields, disabled
      collections, and data-only collections unless explicitly allowed.
- [ ] Assert locale filtering does not leak wrong-locale results.
- [ ] Assert disabled search returns documented behavior.
- [ ] Assert provider search selected without provider capability fails loudly.
- [ ] Browser-test only one representative search flow.

### Verification

```bash
pnpm vitest run \
  test/unit/search-behavior.test.ts \
  test/unit/pagefind.test.ts \
  test/client/search-composables.test.ts \
  test/runtime/api-search-boundaries.test.ts

pnpm test:search:matrix
pnpm test:e2e:browser
```

### Acceptance Criteria

- MiniSearch, Pagefind, and provider-owned search each have one focused proof.
- Browser e2e proves user search once, not every engine.
- Generated search paths never use raw `_path` when a route-safe `path` exists.

## Phase 7: Sitemap And Static Output Edge Matrix

Goal: prove sitemap/static output for realistic edge cases beyond the happy
path.

### Todos

- [ ] Add missing-translation case.
- [ ] Add deeply nested localized route.
- [ ] Add route excluded from sitemap.
- [ ] Add draft/partial excluded from sitemap.
- [ ] Add trailing slash/no-trailing slash behavior if supported.
- [ ] Add image metadata case if sitemap images are supported.
- [ ] Add base URL or app base path case if supported.
- [ ] Assert route counts for fixture sitemaps.
- [ ] Assert alternates exist only for actual variants.
- [ ] Assert no repeated locale prefixes.
- [ ] Assert no local origins.
- [ ] Assert empty sitemap output fails through sitemap assertion.

### Verification

```bash
pnpm vitest run \
  test/contracts/sitemap-query-contracts.test.ts \
  test/contracts/sitemap-assert-contracts.test.ts \
  test/contracts/module-contracts.test.ts

pnpm test:sitemap:static
pnpm test:e2e
```

### Acceptance Criteria

- Ginko owns content-backed sitemap entries.
- Nuxt Sitemap owns XML output.
- The test catches missing, empty, repeated-locale, and local-origin sitemap
  regressions.

## Phase 8: Provider, Cache, And Revalidation Conformance

Goal: make provider authors safe and make cache/revalidation failures explicit.

### Todos

- [ ] Extend provider conformance for valid list/first/count envelopes.
- [ ] Extend provider conformance for malformed envelopes.
- [ ] Add provider-owned search conformance.
- [ ] Add provider-owned sitemap/site-data conformance.
- [ ] Add provider cache hint conformance.
- [ ] Add provider invalidation conformance.
- [ ] Add cache adapter tests for noop, tag-capable, and path-only adapters.
- [ ] Add revalidation token tests.
- [ ] Add tag-only invalidation against path-only adapter negative test.
- [ ] Assert provider errors include code, provider name when available, query
      mode, and actual shape where useful.

### Verification

```bash
pnpm vitest run \
  test/contracts/provider-contracts.test.ts \
  test/contracts/provider-fixture-conformance.test.ts \
  test/contracts/filesystem-provider-conformance.test.ts \
  test/runtime/api-provider-boundary.test.ts \
  test/runtime/api-revalidate-boundary.test.ts \
  test/unit/cache-hints.test.ts
```

### Acceptance Criteria

- External providers cannot depend on raw array/document/number/undefined query
  shapes.
- Unsupported provider behavior fails with typed actionable errors.
- Revalidation success cannot mean silent no-op when no layer handled the
  request.

## Phase 9: CMS-Neutral Contract And Import Hardening

Goal: keep CMS support useful without letting CMS runtime/editor/admin concerns
leak into core.

### Todos

- [ ] Keep `cms-contract` runtime-neutral.
- [ ] Add or strengthen import-purity tests for `cms-contract`.
- [ ] Add golden tests for CMS contract artifacts.
- [ ] Add field metadata tests for text, richtext, image, asset, relation,
      object, array, enum, date, number, boolean, and localized fields.
- [ ] Add routing tests for flat/tree, singleton, localized prefix, localized
      singleton path, and translated slug mode.
- [ ] Add unsupported Zod construct tests.
- [ ] Add `cms-import` parser tests for Markdown/MDC/YAML/JSON/JSON5 and graph
      construction.
- [ ] Add tarball import check for `cms-contract` and `cms-import`.
- [ ] Add architecture test that core exports no CMS admin/editor/workflow/MCP
      behavior.

### Verification

```bash
pnpm vitest run \
  test/unit/cms-contract-purity.test.ts \
  test/unit/cms-contract-schema-artifact.test.ts

pnpm test:package-consumer
pnpm lint
```

### Acceptance Criteria

- CMS contract/import helpers stay runtime-neutral.
- Core query/render/search/sitemap code does not branch on CMS storage models.
- CMS admin/editor/MCP workflows remain out of this package.

## Phase 10: Docs, Examples, And Public API Drift

Goal: keep docs/examples aligned with the actual public API.

### Todos

- [ ] Ensure every public export has category, audience, and docs target in
      `meta/public-surface.json`.
- [ ] Ensure stable and compatibility exports are documented.
- [ ] Ensure beginner docs do not teach advanced provider/cache/CMS/agent APIs
      as the normal path.
- [ ] Ensure docs use `path`, not raw `_path`, for UI links.
- [ ] Ensure docs do not use removed APIs.
- [ ] Ensure examples import from public subpaths only.
- [ ] Ensure examples do not import `@nuxt/content`.
- [ ] Ensure README peer dependency requirements match `package.json`.
- [ ] Ensure docs include static vs SSR markdown behavior.

### Verification

```bash
pnpm vitest run \
  test/contracts/package-exports-contracts.test.ts \
  test/contracts/runtime-assets-contracts.test.ts \
  test/unit/docs-drift.test.ts

pnpm docs:build
pnpm examples:build
pnpm lint
```

### Acceptance Criteria

- Public surface metadata, docs, examples, package exports, and generated
  auto-imports agree.
- A new user can follow docs without reading internals.
- A contributor cannot accidentally add an undocumented public export.

## Phase 11: Release Gate Automation

Goal: make the 10/10 checks runnable as commands, not manual knowledge.

### Todos

- [ ] Add `test:static-output`.
- [ ] Add `test:agent`.
- [ ] Add `test:search:matrix`.
- [ ] Add `test:e2e:browser`.
- [ ] Add `test:package-consumer`.
- [ ] Add `verify:fast` for normal PRs.
- [ ] Update `verify` only after new commands are stable enough for regular
      use.
- [ ] Update `release:verify` to include the full release gate.
- [ ] Ensure all new scripts clean up temp directories and server processes.
- [ ] Ensure all new scripts produce actionable failure messages.

### Target Command Map

```jsonc
{
  "test:static-output": "node scripts/test-static-output.mjs",
  "test:agent": "node scripts/test-agent-output.mjs",
  "test:search:matrix": "node scripts/test-search-matrix.mjs",
  "test:e2e:browser": "playwright test",
  "test:package-consumer": "node scripts/test-packed-consumer.mjs",
  "verify:fast": "pnpm dev:prepare && pnpm lint && pnpm build:packages && pnpm test && pnpm typecheck",
  "verify": "pnpm dev:prepare && pnpm lint && pnpm build:packages && pnpm docs:build && pnpm examples:build && pnpm test && pnpm test:e2e && pnpm typecheck && pnpm test:quickstart",
  "release:verify": "pnpm verify && pnpm run audit:prod && pnpm run release:pack && pnpm test:package-consumer && pnpm test:static-output && pnpm test:agent && pnpm test:search:matrix && pnpm test:e2e:browser"
}
```

### Verification

```bash
pnpm verify:fast
pnpm verify
pnpm release:verify
```

### Acceptance Criteria

- `release:verify` is the single technical release gate.
- Publishing remains manual.
- The gate proves package artifact behavior, static output, browser flows,
  search, sitemap, agent output, docs, examples, and type safety.

## Phase 12: Nightly Quality Ratchet

Goal: catch ecosystem drift, platform drift, slow regressions, and weak pure
logic tests without slowing every PR.

### Todos

- [ ] Add nightly compatibility matrix for locked Nuxt and latest compatible
      Nuxt patch/minor.
- [ ] Add Pagefind latest-compatible smoke.
- [ ] Add MiniSearch latest-compatible smoke if useful.
- [ ] Add dev HMR content edit/add/delete tests.
- [ ] Add locale variant add/delete HMR test.
- [ ] Add navigation metadata HMR test.
- [ ] Add large fixture performance smoke.
- [ ] Add deterministic property-style tests before mutation testing.
- [ ] Add mutation/resilience tests for query, locale, provider capability,
      cache hint, and agent path normalization.
- [ ] Add Windows path tests if CI budget allows.

### Verification

Nightly-only commands can be slower:

```bash
pnpm release:verify
pnpm test:nightly
```

### Acceptance Criteria

- Nightly failures create actionable issues.
- Flaky tests are fixed or quarantined with owner and expiration.
- Nightly failures are not ignored long enough to become noise.

## Cross-Phase Anti-Flake Rules

All phases must follow these rules:

- No arbitrary sleeps.
- Use polling for observable conditions.
- Use fixed time, timezone, and locale where output depends on them.
- No external network dependency in tests.
- No npm registry dependency except explicit manual release verification.
- Use local tarballs for package consumer tests.
- Avoid giant snapshots.
- Use structural assertions and small golden files.
- Fail browser tests on Ginko-related console errors, hydration warnings,
  uncaught exceptions, and failed content API requests.
- Clean up servers and temp directories in `finally`.
- Do not retry deterministic product bugs.
- Do not add public APIs only to make tests easier.

## Priority Order

Implement in this order for the fastest path to real confidence:

1. Phase 1: Internal generated-output smoke.
2. Phase 2: Compact agent output fixture.
3. Phase 3: Production browser e2e.
4. Phase 4: Packed fresh Nuxt consumer test.
5. Phase 5: SSR/static markdown contract split.
6. Phase 6: Search matrix hardening.
7. Phase 7: Sitemap/static edge matrix.
8. Phase 8: Provider/cache/revalidation conformance.
9. Phase 9: CMS-neutral contract/import hardening.
10. Phase 10: Docs/examples/public API drift.
11. Phase 11: Release gate automation.
12. Phase 12: Nightly quality ratchet.

## Definition Of 10/10

The testing system is 10/10 when:

- `pnpm release:verify` passes from a clean tree.
- A packed tarball installs into a fresh Nuxt app outside the monorepo.
- The fresh app typechecks, builds, starts, and serves content.
- Production browser e2e verifies translated locale switching and search.
- Static output checks verify localized pages, sitemap, search assets, raw
  markdown, `llms.txt`, and `llms-full.txt`.
- Static output checks fail on local-origin leaks and repeated locale prefixes.
- SSR/hybrid markdown negotiation is proven separately from static output.
- Provider conformance covers filesystem, in-memory, malformed, provider-owned
  search, provider-owned sitemap/site-data, cache hints, and invalidation.
- Public API metadata, package exports, docs, examples, generated declarations,
  and tarball output are drift-checked.
- CMS-neutral contract/import helpers are tested and remain runtime-neutral.
- No stale docs teach removed APIs or old Nuxt Content patterns.
- No known flaky tests are permanently ignored.
- Every fixed release bug gets the cheapest permanent regression test that
  would have caught it.
