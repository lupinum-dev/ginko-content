# Contributing To Ginko Content

Ginko Content is maintained as a CMS-neutral Nuxt content engine. Keep changes
small, explicit, and tied to one source of truth.

## Local Setup

```bash
corepack enable
pnpm install
pnpm dev:prepare
```

Useful commands:

```bash
pnpm lint
pnpm test
pnpm typecheck
pnpm verify
```

Use `pnpm verify` before opening a pull request that changes runtime behavior,
package exports, docs examples, provider behavior, generated output, or Nuxt
module wiring.

## Release-Sensitive Checks

Run the full release gate before publishing or when a change affects public
behavior:

```bash
pnpm run release:verify
```

This command runs the workspace verification, packed fresh Nuxt consumer test,
production browser e2e, search matrix, static sitemap checks, production audit,
and release tarball packing/inspection. The packed consumer also verifies a
fresh installed app can emit sitemap XML and agent markdown output from the
packed package.

For browser e2e locally, either install a Chromium-compatible browser or point
the test at one:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome pnpm test:e2e:browser
```

CI installs Chrome explicitly. A missing local browser should be fixed by
installing one or setting `PLAYWRIGHT_CHROMIUM_EXECUTABLE`, not by weakening the
browser test.

## Change Guidelines

- Public API changes belong in `packages/content/src/public/*`,
  `packages/content/package.json`, `meta/public-surface.json`, docs, and tests
  together.
- Provider behavior changes must update provider capabilities, public query
  types, provider conformance tests, and docs together.
- Generated assets are product artifacts. If search, sitemap, agent markdown,
  web types, or package exports change, add a test that inspects generated
  output or the packed package.
- Do not add CMS Studio, MCP, admin, workflow, or bridge runtime behavior to
  this repository.
- Do not claim pure static same-URL markdown negotiation works. Static hosts
  should use explicit generated markdown routes.

## Production Fixture Tests

Use `test/helpers/production-fixture.ts` when a test needs a built fixture. It
is the shared build/start harness for generated-output, sitemap, search, agent,
and browser e2e coverage.

Use `test/helpers/generated-artifacts.ts` and
`test/helpers/sitemap-artifacts.ts` for static output assertions instead of
re-reading sitemap XML or generated search/markdown files differently in each
test. Keep e2e tests small: artifact-only checks should inspect `.output`
directly, and browser tests should cover hydration, navigation, and runtime
request behavior.

## Failure Triage

Browser e2e failures usually point at route resolution, locale switching,
hydration, client composables, or failed content API requests. Inspect
`test/browser-e2e/locale-search.test.ts` and `playground/ginko-i18n` first.

Generated-output smoke failures usually point at Nuxt module output, static
prerender routes, sitemap integration, search payloads, or agent markdown
generation. Inspect `test/e2e/generated-output-smoke.test.ts` and the fixture
named in the failure.

Packed consumer failures mean the built package does not work as an installed
dependency. Inspect `scripts/test-packed-consumer.mjs`, package exports,
declaration files, and `packages/content/package.json`.

Search matrix failures usually point at MiniSearch, Pagefind, provider-owned
search, or disabled-search behavior. Inspect `test/e2e/search-matrix.test.ts`
and the search fixtures it runs.

Static sitemap failures usually point at content sitemap entries, Nuxt Sitemap
integration, localized alternates, generated XML shape, or local-origin leaks.
Inspect `test/e2e/sitemap-static.test.ts` and
`test/helpers/sitemap-artifacts.ts`.

Docs drift failures are intentional guardrails. Update docs, examples,
public-surface metadata, and package exports together instead of weakening the
drift test.

Known Nuxt/Vite sourcemap and chunk-size warnings are not automatically Ginko
product failures. Treat new content API errors, hydration errors, local-origin
leaks, missing generated files, package export failures, and provider contract
failures as product issues until proven otherwise.
