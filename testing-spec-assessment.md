# Testing Spec Assessment

Date: 2026-06-08

Scope:

- Library: `/Users/matthias/Git/workspace/ginko-content`
- Real consumer inspected: `/Users/matthias/Git/workspace/shadcn-starter-i18n`
- Related local plan: `confidence-test-plan.md`

## Executive Summary

The proposed testing spec is directionally correct and matches the real risks in
Ginko Content: public API drift, provider contract drift, i18n route switching,
static output, sitemap output, search output, agent-readable markdown/LLM
surfaces, packed package behavior, and docs drift.

It should not be implemented as one huge test program immediately. The right
path is to adopt the architecture, then implement a small number of high-value
gates that prove real production behavior. The consumer app already exposed the
most important missing confidence pattern: build the real app, inspect
`.output/public`, fetch the built server, and browser-test route switching and
search. That pattern should be copied into the library as small fixtures and
scripts, not copied as a full business app.

The highest-value next step is not more unit tests. It is production-built
fixture coverage for:

- locale switching across translated slugs;
- search result navigation;
- sitemap/static output with i18n alternates and no local-origin leaks;
- agent raw markdown, `llms.txt`, and `llms-full.txt`;
- packed tarball install into a fresh Nuxt app.

## External Testing Guidance Checked

The spec aligns with the official tool guidance:

- Nuxt recommends separating Nuxt runtime tests from Nuxt e2e tests for
  stability and supports project-based Vitest organization:
  https://nuxt.com/docs/4.x/getting-started/testing
- Nuxt also supports running e2e against an already-running target host, which
  matches our production-built server strategy:
  https://nuxt.com/docs/4.x/getting-started/testing
- Playwright recommends resilient user-facing locators and avoiding tests of
  third-party dependencies:
  https://playwright.dev/docs/best-practices
- Vitest projects/workspaces are intended for monorepos and multiple
  configurations, which matches the current `vitest.config.ts` structure:
  https://v2.vitest.dev/guide/workspace

The current repo already follows part of this guidance:

- `vitest.config.ts` separates `unit`, `provider`, `contracts-node`,
  `runtime`, `client`, `nuxt`, and `e2e` projects.
- `test/e2e/prod-smoke.test.ts` builds production fixtures and fetches the
  resulting server.
- `test/helpers/fixture-server.ts` builds packages once, allocates ports, starts
  the Nitro server, and cleans up the process.

The missing piece is browser-level production testing. The repo currently has
production server fetch tests, but no Playwright browser gate for hydration,
click navigation, route switching, or search UI.

## What Makes Sense To Adopt

### Adopt: Contract-First Test Architecture

This is the strongest part of the spec.

Ginko is a library with a provider boundary and generated public assets. Tests
should protect contracts, not implementation details. The repo already has the
right shape:

- `test/contracts/package-exports-contracts.test.ts`
- `test/contracts/provider-fixture-conformance.test.ts`
- `test/contracts/query-response-contracts.test.ts`
- `test/contracts/runtime-assets-contracts.test.ts`
- `test/unit/docs-drift.test.ts`
- `packages/content/src/testing/provider-contract.ts`
- `packages/content/src/testing/provider-fixture.ts`

Recommendation:

- Keep expanding these contract tests before adding broad browser coverage.
- Every new public export, generated import, provider capability, query result
  shape, or agent output policy should have a contract test.

### Adopt: Production-Built Reality For Fragile Flows

This is necessary. Dev mode is not enough for:

- prerendered static output;
- generated sitemaps;
- generated raw markdown;
- `llms.txt` and `llms-full.txt`;
- production hydration;
- locale route switching;
- Pagefind assets.

The consumer proved this. The local-origin leak was visible only after building
and inspecting generated output. The same class of bug should be caught in
library-owned fixtures.

Recommendation:

- Keep `test/e2e/prod-smoke.test.ts`.
- Add a generated-output smoke test for an internal fixture, modeled after
  `/Users/matthias/Git/workspace/shadcn-starter-i18n/app/generated-output.test.ts`.
- Add one browser production smoke test after the internal fixture exists.

### Adopt: Small E2E, Deep Contracts

This is the right balance.

The spec lists many e2e flows, but only a few need browser execution. Most
agent markdown, provider, sitemap, search payload, query, and type behavior
belongs in unit/contract/runtime tests.

Browser tests should cover only:

- hydration has no Ginko-related console errors;
- locale switch links navigate to translated routes;
- search UI loads results and result clicks navigate;
- a page exposes markdown alternate discovery if supported in that mode.

Everything else should be tested through fetches, generated-output assertions,
and contracts.

### Adopt: Generated Artifacts Are Product

This is essential for Ginko.

The repo should treat these as release artifacts:

- `.output/public` static files;
- generated `#content/*` declarations;
- auto-import declarations;
- `llms.txt`;
- `llms-full.txt`;
- `/raw/**.md`;
- sitemap XML;
- package tarball contents.

Recommendation:

- Add scripts for static-output and packed-consumer tests.
- Make `release:verify` include them once stable.

### Adopt: No Silent Degradation

This matches the refactor direction.

Keep enforcing:

- malformed provider results fail;
- unsupported operators fail;
- data collections do not silently appear in route/search/sitemap output;
- disabled agent/search/sitemap features return clear outcomes;
- path traversal against raw markdown endpoints fails.

## What Should Be Refined

### Refine: Do Not Build Nine Heavy Layers Immediately

The nine-layer model is useful as a target architecture, but implementing all
layers now would create too much surface area at once.

Recommended staging:

1. Protect current known risks: i18n, search, sitemap/static, agent output,
   tarball install.
2. Add provider/CMS/cache conformance hardening.
3. Add browser e2e.
4. Add nightly scale/mutation later.

### Refine: Browser E2E Should Be Smaller Than The Spec Suggests

The browser layer in the spec lists many flows. Keep only the ones that prove
browser-specific risk.

Recommended first browser spec:

- open German quickstart translated route;
- assert content rendered;
- click English locale switch;
- assert English route and content;
- search for a German or English term;
- click result;
- assert route and content;
- assert no Ginko-related console errors or failed content API requests.

Do not browser-test every raw markdown body, sitemap entry, cache header, or
provider negative case.

### Refine: Agent Link Header Expectations Must Be Deployment-Aware

The spec says agent link headers should be tested. That is right for SSR/hybrid
routes. It is not right to expect runtime middleware-created `Link` headers on
already-prerendered static HTML.

Required wording:

- Static contract: generated markdown routes and HTML `<link rel="alternate">`
  if implemented.
- SSR/hybrid contract: `Accept: text/markdown` and HTTP `Link` headers can be
  tested when Nitro middleware handles the request.

The test suite should explicitly prove both:

- static output does not claim same-URL negotiation;
- SSR/hybrid negotiation works when middleware runs.

### Refine: Pagefind Should Be Release/Nightly Until It Is Cheap

Search is high risk, but Pagefind can be slow and platform-sensitive.

Recommendation:

- MiniSearch smoke in regular PR gate.
- Pagefind static-output smoke in full PR/release gate.
- Provider-owned search smoke when the fixture exists.

### Refine: Mutation Testing Is A Later Quality Ratchet

Mutation/resilience tests are useful for query, locale, provider capability,
cache hints, and agent path normalization. They should not block the next
confidence pass.

Recommendation:

- Add deterministic table/property-style tests first.
- Add mutation testing only after the high-risk fixture gaps are closed.

## What Should Be Deferred

Defer these until after production-built fixture coverage exists:

- Full nightly compatibility matrix.
- Large 1,000-document performance fixture.
- Windows/macOS matrix.
- Mutation testing.
- Full CMS artifact matrix beyond current purity/contract checks.
- Dev HMR browser tests.
- Broad cache/revalidation browser e2e.

These are real quality improvements, but they do not close the biggest current
confidence gaps as directly as static output, browser locale/search, and tarball
consumer tests.

## Consumer Patterns Worth Pulling Into Ginko

### 1. Generated Static Output Assertions

Source:

- `/Users/matthias/Git/workspace/shadcn-starter-i18n/app/generated-output.test.ts`

Useful patterns:

- Parse generated sitemap blocks by `<url>...</url>`.
- Compare URL paths instead of raw XML snapshots.
- Assert positive and negative route inclusion.
- Assert localized alternates.
- Assert no `127.0.0.1`, `localhost`, or `[::1]`.
- Assert generated HTML files exist.
- Assert generated raw markdown and `index.md` copies are identical.
- Assert `llms.txt` and `llms-full.txt` contain public, route-safe links.
- Assert generated output includes component serializer output.

Recommended internal adaptation:

- Create `test/e2e/generated-output-smoke.test.ts`.
- Run it against a small new fixture, not the consumer app.
- Reuse semantic assertions, not the exact business strings.

### 2. Real Route-Aware Locale Switch Fallback

Source:

- `/Users/matthias/Git/workspace/shadcn-starter-i18n/app/composables/useLocalizedRouteSwitch.ts`
- `/Users/matthias/Git/workspace/shadcn-starter-i18n/app/components/site/SiteLocaleSwitcher.vue`

Useful pattern:

- Prefer `useContentSwitchLocalePath(targetLocale)`.
- Fall back to Nuxt i18n `useSwitchLocalePath(targetLocale)`.
- Keep app-owned locale-switch UI thin.

Recommended internal adaptation:

- Keep `useContentSwitchLocalePath` as the compatibility/public bridge.
- Add a browser fixture that uses the same pattern through a minimal locale
  switch component.
- Test that translated route switching is canonical-identity based, not string
  replacement based.

Do not copy the full app switcher UI. The fixture should only include links or
buttons with stable accessible names.

### 3. App Site Config As Canonical Origin

Source:

- `/Users/matthias/Git/workspace/shadcn-starter-i18n/app/site.config.ts`
- `/Users/matthias/Git/workspace/shadcn-starter-i18n/app/composables/useCanonicalUrl.ts`
- `/Users/matthias/Git/workspace/shadcn-starter-i18n/server/plugins/sitemap-origin.ts`

Useful pattern:

- One app-owned site URL source of truth.
- Generated output tests enforce no local origins.

Recommended internal adaptation:

- Add a fixture with a clear production origin like
  `https://ginko-fixture.example`.
- Assert sitemap, HTML metadata, raw markdown frontmatter, and LLM links use
  that origin.
- Do not add another source of truth in Ginko. Ginko should consume configured
  site/agent URLs and avoid writing global public runtime config.

### 4. Custom Agent Markdown Serializers

Source:

- `/Users/matthias/Git/workspace/shadcn-starter-i18n/server/utils/agent-serializers.ts`
- `/Users/matthias/Git/workspace/shadcn-starter-i18n/server/plugins/agent-serializers.ts`

Useful patterns:

- Register component serializers once.
- Cover both kebab-case MDC names and PascalCase Vue component names.
- Serialize business-specific components to clean markdown.
- Use helpers from `@lupinum/ginko-content/server`, such as
  `defineAgentMarkdownComponent`, `registerAgentMarkdownSerializers`,
  `getMarkdownProp`, and markdown/XML helpers.

Recommended internal adaptation:

- Create an `agent-output` fixture with a few fake components:
  `callout`, `card`, `gallery`, `chart`, and `consent-embed`.
- Add unit tests for serializer helpers.
- Add generated-output tests proving the custom serializer output appears in
  `/raw/**.md` and `llms-full.txt`.

### 5. Agent Policy In Config, Not App Routes

Source:

- `/Users/matthias/Git/workspace/shadcn-starter-i18n/app/agent-readiness.test.ts`
- `/Users/matthias/Git/workspace/shadcn-starter-i18n/content.config.ts`

Useful pattern:

- The app tests that it does not create parallel `server/routes/llms.txt.get.ts`
  or `server/routes/raw/[...slug].get.ts`.
- Agent sections, site metadata, pages, and policy live in Ginko content config.

Recommended internal adaptation:

- Keep architecture tests that prevent duplicate app/server routes in examples.
- Add a fixture-level readiness test that fails if agent routes are hand-coded
  instead of generated by Ginko.

### 6. Collection Mix Matching Real Use

Source:

- `/Users/matthias/Git/workspace/shadcn-starter-i18n/content.config.ts`
- `/Users/matthias/Git/workspace/shadcn-starter-i18n/content/**`

Useful pattern:

- Multiple page collections: docs, blog, services, references, legal.
- Multiple data collections: authors, testimonials, faqs.
- Localized routes with translated collection roots:
  `/leistungen` vs `/en/services`, `/dokumentation` vs `/en/docs`.
- Data collections excluded from sitemap.
- Agent enabled only where intended.

Recommended internal adaptation:

- Create one compact canonical scenario fixture with:
  docs, blog, services, authors, one data-only collection, one legal singleton,
  two locales, one missing translation, one translated slug pair, one MDC
  component page, and one disabled/draft page.
- Do not copy the whole consumer content tree.

## Proposed Internal Fixture Changes

### Add `playground/ginko-agent-output`

Purpose:

- Agent raw markdown, `llms.txt`, `llms-full.txt`, custom serializers, i18n
  agent routes, static generated markdown files.

Should include:

- Two locales.
- One docs collection with translated slugs.
- One services collection with translated roots.
- One legal/app page configured through `defineAgentAppPage`.
- One data collection excluded from agent output.
- One draft/partial excluded from agent output.
- Fake MDC components with custom serializers.

Tests:

- Runtime/API tests for `resolveContentMarkdownByRoute` and raw route handling.
- Generated-output test for `.output/public/raw/**`, `/:route/index.md`,
  `llms.txt`, and `llms-full.txt`.
- Browser smoke only for alternate discovery if implemented in HTML.

### Add `playground/ginko-static-i18n`

Purpose:

- Sitemap/static output/SEO/i18n route correctness without the weight of the
  downstream app.

Should include:

- Two locales.
- Translated slugs.
- Missing translation.
- Data collection excluded from sitemap/search.
- Draft excluded from sitemap/search.
- Explicit production site URL.

Tests:

- Generated sitemap contains expected routes.
- Generated sitemap excludes wrong routes.
- Alternates point at translated paths.
- No repeated locale prefix.
- No local-origin leak in sitemap or HTML.

### Add Browser Test Against A Production Fixture

Preferred first spec:

- `test/e2e/browser-locale-search.test.ts`

Flow:

1. Start production-built fixture server.
2. Open German translated docs route.
3. Assert German heading.
4. Click English switch link.
5. Assert English translated route and heading.
6. Use search UI.
7. Click a result.
8. Assert final route and heading.
9. Fail on Ginko-related console errors and failed content API responses.

Tooling options:

- Use `@nuxt/test-utils/e2e` browser support inside Vitest, or add
  `@playwright/test` as a dedicated release/browser command.
- Since the repo already uses Vitest projects and `startFixtureServer`,
  the simplest initial path is a Vitest e2e test that imports Playwright or
  Nuxt test utils and targets the already-built fixture server.

### Add Packed Consumer Test

Purpose:

- Prove the published package artifact works outside the monorepo.

Script:

- `scripts/test-packed-consumer.mjs`

Flow:

1. Build package.
2. Pack tarball.
3. Create temp Nuxt app outside repo.
4. Install tarball and peers.
5. Add minimal `content.config.ts`, one Markdown page, and one route.
6. Run `nuxi prepare`.
7. Run typecheck.
8. Build.
9. Start server.
10. Fetch `/` and one Ginko API route.
11. Import all public subpaths from built package.
12. Assert no `workspace:*` ranges in packed output.

This should become part of `release:verify` once stable.

## Current Ginko Coverage Compared To The Spec

Already good:

- Vitest project separation.
- Architecture and package-export contracts.
- Provider fixture/conformance infrastructure.
- Runtime/API boundary tests.
- Typecheck fixture.
- Docs drift tests.
- Production server fetch smoke for `ginko-basic` and `ginko-i18n`.
- Static output route helper tests.
- Agent markdown unit tests.
- Sitemap assertion contracts.

Not yet good enough:

- No real browser production e2e.
- No packed fresh Nuxt consumer test.
- No internal generated-output test as strong as the downstream app.
- No compact internal agent-output fixture matching the downstream serializer
  use case.
- No internal fixture that proves sitemap/local-origin behavior at the same
  level as the consumer.
- Pagefind/static search behavior needs stronger production-output coverage.
- SSR/hybrid markdown negotiation is not separately proven after the static
  limitation was documented.

## Recommended Roadmap

### Step 1: Adopt Consumer Generated-Output Pattern

Create a library-owned generated-output e2e test that copies the consumer's
style:

- path-normalize sitemap entries;
- assert includes/excludes;
- assert alternates;
- assert no local origins;
- assert raw markdown and `index.md`;
- assert `llms.txt` and `llms-full.txt`;
- assert custom serializer output.

This gives the fastest confidence gain.

### Step 2: Add The Agent Output Fixture

This directly addresses the "agentic/LLM stuff" risk.

Keep it small and purpose-built. The consumer proves the pattern, but the
library fixture should use fake business content so failures remain easy to
understand.

### Step 3: Add One Browser E2E Spec

Do not start with a large browser matrix.

First browser test should prove only:

- hydration;
- translated route switching;
- search result navigation;
- no Ginko-related console/API failures.

### Step 4: Add Packed Consumer Script

This is a production-readiness gate, not just a confidence check.

The current `pack:check` proves a tarball exists. It does not prove a fresh
Nuxt app can install, typecheck, build, start, and import every public subpath.

### Step 5: Add SSR/Hybrid Markdown Negotiation Fixture

This separates the static limitation from real server-runtime support.

Test:

- normal route returns HTML;
- same route with `Accept: text/markdown` returns markdown;
- `Link` header appears where alternate exists;
- prerendered static version uses explicit markdown URLs instead.

## What Not To Do

- Do not copy the whole downstream app into the library.
- Do not make browser e2e the place where query/provider/serializer logic is
  tested.
- Do not add a broad dependency/version matrix before the core fixture gaps are
  closed.
- Do not assert giant HTML/XML snapshots.
- Do not promise static same-URL markdown negotiation.
- Do not add a second source of truth for site URL just to make tests pass.
- Do not introduce new public APIs only for testing.

## Final Recommendation

Use the proposed testing spec as the long-term standard, but implement it in a
smaller root-cause order:

1. Internal generated-output smoke modeled after the consumer.
2. Internal agent-output fixture.
3. One browser production e2e for locale switching and search.
4. Packed fresh Nuxt consumer test.
5. SSR/hybrid markdown negotiation fixture.
6. Sitemap/search/Pagefind edge-case expansion.
7. Provider/CMS/cache conformance hardening.
8. Nightly matrix, performance, and mutation testing.

This path gives real confidence quickly and keeps the suite maintainable.
