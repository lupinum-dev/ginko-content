# Ginko Content Reliability Test Plan

Goal: build real confidence that `@lupinum/ginko-content` works reliably as a
library and in the real downstream app, not only that isolated unit tests pass.

This plan focuses on what an agent can verify with source inspection, contract
tests, package builds, downstream installs, generated artifact checks, live
server fetches, and browser smoke tests.

## Confidence Model

Target confidence: high enough to ship a pre-release library version with known
limitations documented.

A feature is considered reliable only when all of these are true:

- The source has one clear owner and no hidden second source of truth.
- The public API, generated assets, and docs describe the same behavior.
- Tests cover the intended contract and at least one negative/failure case.
- The packed package works in a real downstream app.
- Generated output is inspected directly when the feature affects static files.
- Browser checks cover user-facing behavior when the feature affects navigation,
  search, locale switching, or rendered pages.

Known limitation that must remain explicit:

- Static prerendered HTML cannot reliably support same-URL
  `Accept: text/markdown` negotiation or middleware-created `Link` headers on
  generic static hosts. Static deployments should use generated markdown routes:
  `/raw/**.md`, `/:route/index.md`, `/llms.txt`, and `/llms-full.txt`.

## Phase 1: Library Contract Gate

Purpose: prove the library-owned contracts still hold after any refactor.

Run from `/Users/matthias/Git/workspace/ginko-content`:

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
```

What this proves:

- Public exports are intentional and documented.
- Provider query results stay canonical.
- Runtime asset contracts are still generated as expected.
- Runtime config uses the content-owned namespace.
- Agent markdown middleware behavior is covered.
- Static output helper behavior is tested without Nuxt/Nitro.
- Pagefind helper behavior still matches its intended contract.

Evidence to record:

- Command result.
- Failing test names, if any.
- Whether failures indicate a product bug, stale test, or docs drift.

## Phase 2: Type And Build Gate

Purpose: prove the source, package build, docs build, examples, and type fixture
still work together.

Run:

```bash
pnpm typecheck:source
pnpm build:packages
pnpm docs:build
pnpm examples:build
pnpm --filter @lupinum/ginko-content-test-typecheck typecheck
pnpm test:quickstart
pnpm pack:check
git diff --check
```

Optional full gate when time allows:

```bash
pnpm verify
```

What this proves:

- Source types compile.
- Package entry points build.
- Docs build against the current public API.
- Examples still compile.
- The dedicated typecheck fixture catches public API typing regressions.
- The quickstart app works against the package.
- The package tarball contains a valid installable artifact.
- No whitespace or patch formatting problems were introduced.

Evidence to record:

- Exact commands.
- Any warnings that are unrelated but recurring.
- Whether `pnpm verify` was run or intentionally skipped.

## Phase 3: Downstream Install Gate

Purpose: prove the packed package works in the real downstream consumer
`/Users/matthias/Git/workspace/shadcn-starter-i18n`.

Run from the library:

```bash
mkdir -p /Users/matthias/Git/workspace/.local-tarballs
pnpm pack --pack-destination /Users/matthias/Git/workspace/.local-tarballs
```

Install the tarball in the downstream app:

```bash
cd /Users/matthias/Git/workspace/shadcn-starter-i18n
pnpm add -w /Users/matthias/Git/workspace/.local-tarballs/lupinum-ginko-content-*.tgz
pnpm build
pnpm test app/generated-output.test.ts
pnpm check
git diff --check
```

What this proves:

- The package is usable after packing, not only through workspace source links.
- The downstream app still builds and prerenders.
- Generated-output regressions remain covered.
- Downstream typecheck and lint still pass.

Evidence to record:

- Tarball path.
- Downstream package version/source after install.
- Build route count.
- Test and check results.
- Any unrelated downstream warnings.

## Phase 4: Generated Artifact Inspection

Purpose: prove static output contains the expected files and does not leak local
development origins.

Run from downstream after `pnpm build`:

```bash
rg "127\\.0\\.0\\.1|localhost|\\[::1\\]" \
  .output/public/__sitemap__ \
  .output/public/sitemap_index.xml

rg -l "http://127\\.0\\.0\\.1|http://localhost|http://\\[::1\\]" \
  .output/public \
  -g '*.html'

find .output/public -path '*llms*.txt' -o -path '*.md' | sort | sed -n '1,120p'

rg "Provider:|Consent:|Legal name|Privacy email|Quick Start|Schnellstart" \
  .output/public/raw \
  .output/public/llms-full.txt
```

Expected result:

- The first two `rg` commands return no matches.
- Markdown and LLM files exist for both locales.
- Custom downstream serializers appear in raw markdown and `llms-full.txt`.

What this proves:

- Static sitemap output does not leak localhost.
- Static HTML does not serialize localhost as public config.
- LLM and raw markdown assets are generated.
- Custom serializer paths are exercised in real output.

## Phase 5: Live Static Server Fetch Gate

Purpose: prove generated output behaves correctly when served by the built Nitro
server.

Start downstream server:

```bash
cd /Users/matthias/Git/workspace/shadcn-starter-i18n
PORT=4173 HOST=127.0.0.1 node .output/server/index.mjs
```

Fetch these URLs:

```txt
http://127.0.0.1:4173/sitemap_index.xml
http://127.0.0.1:4173/__sitemap__/de-DE.xml
http://127.0.0.1:4173/__sitemap__/en-US.xml
http://127.0.0.1:4173/api/_content/sitemap
http://127.0.0.1:4173/robots.txt
http://127.0.0.1:4173/llms.txt
http://127.0.0.1:4173/en/llms.txt
http://127.0.0.1:4173/llms-full.txt
http://127.0.0.1:4173/raw/en/docs/getting-started/quick-start.md
http://127.0.0.1:4173/raw/de/dokumentation/erste-schritte/schnellstart.md
http://127.0.0.1:4173/en/docs/getting-started/quick-start/index.md
http://127.0.0.1:4173/dokumentation/erste-schritte/schnellstart/index.md
http://127.0.0.1:4173/en/docs/getting-started/quick-start
http://127.0.0.1:4173/dokumentation/erste-schritte/schnellstart
```

For each URL, record:

- HTTP status.
- Content type.
- Whether the body contains `127.0.0.1`, `localhost`, or `[::1]`.
- For markdown files: whether frontmatter and expected heading are present.
- For sitemap files: whether canonical production origins are present.

Special check:

```txt
GET /en/docs/getting-started/quick-start
Accept: text/markdown
```

Expected result for prerendered static output:

- It may return HTML. That is acceptable and should remain documented.
- The explicit markdown URLs must return markdown.

## Phase 6: Browser Smoke Gate

Purpose: prove user-facing navigation, route switching, search, and generated
pages behave in a real browser.

Use Browser against the downstream server at:

```txt
http://127.0.0.1:4173
```

Checks:

1. Home page renders without hydration errors.
2. German docs quickstart page renders:
   `/dokumentation/erste-schritte/schnellstart`
3. Locale switch from German quickstart goes to:
   `/en/docs/getting-started/quick-start`
4. Locale switch back from English quickstart goes to:
   `/dokumentation/erste-schritte/schnellstart`
5. English blog detail page renders if present in current fixture content.
6. Search UI opens, accepts a query, and shows at least one relevant result.
7. Search result navigation opens the expected page.
8. Browser console has no Ginko-related runtime errors.
9. Page source or DOM contains markdown alternate discovery links if the app
   exposes them.
10. Canonical links and hreflang alternates point to production origins, not
    local origins.

What this proves:

- Real route switching works, not only route map tests.
- Search assets are loaded and usable.
- Generated static pages hydrate.
- SEO/canonical data is visible in rendered pages.

Evidence to record:

- Browser URL after each navigation.
- Screenshot paths for the main page, route switch result, and search result.
- Console error summary.
- DOM snippets for canonical/hreflang/alternate links when relevant.

## Phase 7: SSR Or Hybrid Behavior Gate

Purpose: separate static limitations from Nitro runtime behavior.

Run the downstream app in a mode where Nitro middleware handles the request for
at least one non-prerendered route, or create a focused library fixture that
does not prerender the test page.

Checks:

- `Accept: text/markdown` on a non-prerendered route returns markdown.
- Agent `Link` headers are present on HTML responses when enabled.
- The same route still returns HTML without the markdown `Accept` header.
- Invalid or missing content returns a meaningful status and body.

What this proves:

- Markdown negotiation is a server-runtime feature and works where middleware
  actually runs.
- Static documentation can honestly distinguish SSR/hybrid behavior from pure
  static behavior.

Current status:

- Not yet fully proven after the latest static-output fixes.
- This is the highest-value remaining test if same-URL negotiation is important.

## Phase 8: Sitemap Edge-Case Matrix

Purpose: prove sitemap behavior beyond the current downstream happy path.

Add or use focused fixtures for:

- Missing translation.
- Deeply nested localized route.
- Route excluded from sitemap.
- Draft or hidden content excluded from sitemap.
- Trailing-slash and no-trailing-slash variants.
- Image metadata if the downstream app emits sitemap images.
- Base URL or app base path if supported.

Checks:

- Sitemap includes expected canonical URL.
- Sitemap excludes expected hidden/draft routes.
- Alternates are present only when translations exist.
- No local origins appear.
- Route count matches expected fixture count.

What this proves:

- Sitemap logic is robust enough for production content structures.
- Locale alternates do not silently invent invalid URLs.

## Phase 9: External Provider Contract Probe

Purpose: prove provider strictness is understandable for provider authors, not
only for the filesystem provider.

Create a minimal in-memory test provider fixture that intentionally covers:

- Valid list envelope.
- Valid first envelope.
- Valid count envelope.
- Raw array rejection.
- Raw document rejection.
- Raw number rejection.
- `undefined` rejection.
- Malformed list envelope rejection.
- Malformed first envelope rejection.
- Malformed count envelope rejection.

Checks:

- Errors use `ContentProviderError` where provider authors need diagnostics.
- Error includes provider name when available.
- Error includes query mode and actual result shape.
- Cache wrapper accepts only canonical envelopes.

What this proves:

- The strict provider contract is enforceable and debuggable.
- Future providers cannot accidentally depend on removed compatibility shapes.

## Phase 10: Performance And Scale Probe

Purpose: identify whether static output, search indexing, query execution, or
LLM output generation has obvious scaling risks.

Create or generate a large fixture with:

- 1,000 content documents.
- At least two locales.
- Nested docs/blog/service route patterns.
- Mixed translated and untranslated content.

Measure:

- Package build time.
- Downstream build/prerender time.
- Sitemap generation time.
- Pagefind generation time.
- LLM output generation time.
- Size of `.output/public/llms-full.txt`.
- Size of Pagefind assets.

What this proves:

- The implementation remains usable beyond the current small downstream app.
- Large LLM/search outputs do not create surprising build-time or artifact-size
  problems.

This does not need to block a pre-release unless performance is already a stated
release requirement.

## Recommended Execution Order

Run these first for the next confidence pass:

1. Phase 1: Library Contract Gate.
2. Phase 2: Type And Build Gate.
3. Phase 3: Downstream Install Gate.
4. Phase 4: Generated Artifact Inspection.
5. Phase 5: Live Static Server Fetch Gate.
6. Phase 6: Browser Smoke Gate.

Then run these if the goal is production readiness rather than pre-release
confidence:

7. Phase 7: SSR Or Hybrid Behavior Gate.
8. Phase 8: Sitemap Edge-Case Matrix.
9. Phase 9: External Provider Contract Probe.
10. Phase 10: Performance And Scale Probe.

## Production Readiness Exit Criteria

Before calling the library production-quality, require:

- Full `pnpm verify` passes in the library.
- Packed package installs cleanly in the downstream app.
- Downstream `pnpm build`, `pnpm check`, and generated-output tests pass.
- Browser smoke confirms locale switching and search.
- Generated static artifacts contain no local-origin leaks.
- LLM/raw markdown files exist and contain expected custom serialized data.
- Static markdown limitation is documented in public docs.
- SSR/hybrid markdown negotiation is either proven or explicitly documented as
  unverified.
- Sitemap edge cases are covered by focused tests.
- Provider contract negative cases are covered.

## Evidence Log Template

Use this format when recording the next pass:

```md
## YYYY-MM-DD Confidence Pass

Scope:

- Library commit:
- Downstream commit:
- Tarball path:

Commands:

- [ ] Command:
      Result:
      Notes:

Browser checks:

- [ ] URL:
      Result:
      Screenshot:
      Console:

Generated artifact checks:

- [ ] Check:
      Result:
      Notes:

Findings:

- Serious:
- Medium:
- Minor:

Conclusion:

- Confidence score:
- Remaining unknowns:
- Required fixes:
```
