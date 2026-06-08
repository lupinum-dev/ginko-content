# Confidence Verification

Goal: close the remaining confidence gaps after the root-cause refactor by
checking route switching, sitemap/static output, and agent/LLM surfaces with
source inspection, tests, builds, generated artifacts, and live downstream
endpoint checks.

## Scope

- Library: `/Users/matthias/Git/workspace/ginko-content`
- Downstream consumer: `/Users/matthias/Git/workspace/shadcn-starter-i18n`
- Installed local tarball:
  `/Users/matthias/Git/workspace/.local-tarballs/lupinum-ginko-content-0.1.4.tgz`

## Executive Status

Status: checked, with one documented static-prerender limitation.

The high-risk route switching, sitemap, static generated assets, LLM indexes,
raw markdown files, custom agent serializers, and explicit markdown routes were
verified against the real downstream app. The checks found real origin bugs in
the generated sitemap/HTML output. Those were fixed and regression-tested.

The only remaining caveat is deployment-mode behavior: `Accept:
text/markdown` negotiation and agent `Link` headers do not apply to prerendered
HTML files because static files are served before Nitro middleware runs. The
explicit `/:route/index.md` and `/raw/**.md` routes work and are the reliable
static output path.

Overall confidence:

- Route switching: high.
- Sitemap/static output: high after fixes.
- LLM/raw markdown/agent serializer output: high.
- Markdown negotiation and Link headers on prerendered HTML: intentionally not
  claimed as fully working; treat as SSR/Nitro-only unless static hosting adds
  equivalent headers.

## Checked Matrix

### Route Switching

Status: checked

Evidence:

- Downstream app uses `useContentSwitchLocalePath`, not the removed
  `useContentLocaleSwitch`.
- Previous downstream checks passed after the refactor:
  `pnpm check`, full `pnpm test`, and `pnpm build`.
- Browser smoke earlier verified German docs quickstart switches to English
  docs quickstart.
- Browser smoke earlier verified English blog detail page renders after
  tarball install.

Residual risk:

- Low. The verified route-switch path matches current downstream usage.

### Core Query And Provider Boundary

Status: checked

Evidence:

- `pnpm typecheck:source` passed after the final runtime URL fix.
- Focused runtime/provider-adjacent checks passed:
  `pnpm vitest run test/unit/agent-markdown.test.ts test/contracts/runtime-config-contracts.test.ts test/contracts/sitemap-assert-contracts.test.ts test/contracts/content-head-contracts.test.ts`
- Result: 4 files passed, 42 tests passed.
- Earlier full library verification passed during the refactor audit: full test
  matrix and e2e were green at that point.

Residual risk:

- Low for the filesystem provider and library-owned provider contract.
- Medium for unknown external providers because no real external custom
  provider was available in this workspace.

### Sitemap And Static Output

Status: checked after fixes

Evidence:

- Source inspection confirmed sitemap runtime integration is registered through
  `packages/content/src/module/nitro-config.ts` and
  `packages/content/src/runtime/server/plugins/sitemap.ts`.
- Source inspection confirmed static search and agent output generation is
  centralized in `packages/content/src/module/static-output.ts`.
- Focused library checks passed:
  `test/contracts/sitemap-assert-contracts.test.ts` and
  `test/contracts/runtime-config-contracts.test.ts`.
- Downstream `pnpm build` passed and prerendered 364 routes.
- Downstream generated sitemap artifact check passed:
  `rg "127\\.0\\.0\\.1|localhost|\\[::1\\]" .output/public/__sitemap__ .output/public/sitemap_index.xml || true`
  returned no matches.
- Downstream generated HTML artifact check passed:
  `rg -l "http://127\\.0\\.0\\.1|http://localhost|http://\\[::1\\]" .output/public -g '*.html' || true`
  returned no matches.
- Downstream generated-output regression passed:
  `pnpm test app/generated-output.test.ts`, 1 file, 8 tests.
- Live built server checks returned 200 without local-origin leaks for:
  `/sitemap_index.xml`, `/__sitemap__/de-DE.xml`,
  `/__sitemap__/en-US.xml`, and `/api/_content/sitemap`.

Issues found and fixed:

- Final sitemap XML originally leaked `http://127.0.0.1:3000` alternate URLs.
  Root cause was final Nuxt Sitemap/i18n output composition. Fixed in the
  downstream app with `server/plugins/sitemap-origin.ts`, which normalizes
  resolved and serialized sitemap output to `siteConfig.site.url`.
- Generated static HTML originally leaked local origins in serialized public
  runtime config. Root cause was a global public site runtime key, not
  canonical head/schema output. Fixed by:
  - moving Ginko's canonical runtime URL to `runtimeConfig.public.content.siteUrl`;
  - removing unused downstream `runtimeConfig.public.site.url`;
  - keeping downstream app SEO/canonical code on `siteConfig.site.url`;
  - adding generated-output regression tests for sitemap and HTML origins.

Residual risk:

- Low for the verified downstream static output.
- Medium if another app depends on top-level `runtimeConfig.public.siteUrl` as
  a Ginko-owned output. Ginko now treats that as legacy input only and writes
  `runtimeConfig.public.content.siteUrl`.

### Agent, LLM, Raw Markdown

Status: checked

Evidence:

- Source inspection confirmed downstream enables:
  `agent.routes`, `agent.linkHeaders`, `agent.markdownNegotiation`, and
  `agent.prerender`.
- Source inspection confirmed downstream `content.config.ts` defines real
  agent site metadata, sections, collection markdown, localized app pages, and
  custom serializers.
- Library agent markdown tests passed:
  `test/unit/agent-markdown.test.ts`.
- Downstream generated output contains LLM files and raw markdown files for
  German and English content/app pages.
- Live built server checks returned 200, `text/markdown`, and no local-origin
  leaks for:
  `/llms.txt`, `/en/llms.txt`, `/llms-full.txt`,
  `/raw/en/docs/getting-started/quick-start.md`, `/raw/en/contact.md`, and
  `/en/docs/getting-started/quick-start/index.md`.
- Custom serializers were verified in generated output by matching legal,
  privacy, contact, provider, and consent fields in `.output/public/raw/**`
  and `.output/public/llms-full.txt`.

Residual risk:

- Low for generated/static LLM and raw markdown routes.
- Medium for non-prerendered SSR deployments until exercised separately, but
  the underlying Nitro handlers and library tests pass.

### Markdown Negotiation And Link Headers

Status: checked, not fully supported for prerendered HTML

Evidence:

- Live built server with `Accept: text/markdown` for
  `/en/docs/getting-started/quick-start` returned static HTML:
  status 200, `text/html;charset=utf-8`, no local-origin leak.
- Live built server for normal HTML routes `/en/docs/getting-started/quick-start`
  and `/en/contact` returned no `Link` header.
- Explicit markdown route `/en/docs/getting-started/quick-start/index.md`
  returned status 200, `text/markdown`, frontmatter, heading, and no
  local-origin leak.

Conclusion:

- `content.agent.markdownNegotiation` and `content.agent.linkHeaders` are not
  reliable for prerendered static HTML because static files bypass Nitro
  middleware.
- For static deployments, the reliable contract is explicit generated markdown
  files: `/raw/**.md` and `/:route/index.md`.
- If production requires alternate headers for every prerendered HTML page,
  that should be implemented as static host headers, route rules that generate
  headers, or generated HTML `<link rel="alternate">` metadata. It should not
  be claimed as middleware behavior.

## Final Commands Run

Library:

- `pnpm vitest run test/unit/agent-markdown.test.ts test/contracts/runtime-config-contracts.test.ts test/contracts/sitemap-assert-contracts.test.ts test/contracts/content-head-contracts.test.ts`
- `pnpm typecheck:source`
- `git diff --check`
- `pnpm pack --pack-destination /Users/matthias/Git/workspace/.local-tarballs`

Downstream:

- `pnpm add -w /Users/matthias/Git/workspace/.local-tarballs/lupinum-ginko-content-0.1.4.tgz`
- `pnpm build`
- `pnpm test app/generated-output.test.ts`
- `git diff --check`
- Generated sitemap local-origin grep.
- Generated HTML local-origin grep.
- Live endpoint fetch pass against `PORT=4173 HOST=127.0.0.1 node .output/server/index.mjs`.

Known non-blocking warnings:

- `nuxt-schema-org` emits an `IMPORT_IS_UNDEFINED` warning for
  `UnheadSchemaOrg`. This existed during downstream verification and is not
  caused by the Ginko Content changes.
- pnpm prints a warning that the `pnpm` field in `package.json` is no longer
  read for package extensions.

## Final Assessment

What is properly working:

- Route switching used by the downstream app.
- Canonical sitemap route inclusion and localized alternates.
- Generated sitemap XML without local-origin leaks.
- Generated HTML without local-origin leaks.
- Agent LLM indexes.
- Raw markdown routes.
- Explicit generated `index.md` markdown routes.
- Downstream custom agent serializers for legal/contact/privacy/service data.

What is not safe to claim:

- `Accept: text/markdown` negotiation for prerendered static HTML.
- Agent `Link` headers for prerendered static HTML.

Production-quality blocker:

- Document the prerender behavior clearly before claiming full static support
  for markdown negotiation/link headers. The working static contract is the
  generated markdown files, not runtime middleware on already-prerendered HTML.
