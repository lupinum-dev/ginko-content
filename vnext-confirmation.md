# vNext Confirmation Evidence

Status: confirmation complete
Started: 2026-06-03
Updated: 2026-06-03

This document records the confirmation sprint evidence before the full vNext
refactor. A pass here means the proposed API and DX direction works across
Ginko Content, Ginko CMS, and the real Nuxt consumers without hidden
workarounds.

## Rules

- Use the packed local `@lupinum/ginko-content` tarball for consumer QA.
- Human publishing happens later; release verification must not require a
  registry publish.
- Treat consumer workaround code as a failed experiment unless it is purely
  app-specific UI.
- Do not add compatibility shims or dual paths.
- Failed experiments become defects or design revisions.

## Experiment Status

| Experiment | Status | Evidence |
| --- | --- | --- |
| String collection API | Pass | `pnpm verify` and quickstart coverage pass with literal collection names. Real consumers build from the packed tarball without importing collection handles from `content.config.ts`. |
| Schema-driven backlinks | Pass | Relation metadata drives backlink inference. Consumer author pages no longer pass explicit backlink `fields`, and browser QA confirms author post cards render. |
| Provider harmony | Pass | `ginko-cms` release verification passes with a sibling local `ginko-content` package packed into its temporary consumer. CMS search remains explicit with `content.search.engine = 'cms'`. |
| I18n route identity | Pass | Generated/browser QA confirms English/German docs, locale switching, localized blog/author/search routes, explicit fallback copy, and localized sitemap paths. |
| Sitemap mode | Pass | Nuxt Sitemap remains the XML authority. Ginko resolves sitemap mode lazily, consumers do not use sitemap ignore workarounds, and exact generated/HTTP assertions pass. |
| Agent misuse diagnostics | Pass | Focused tests cover unknown collections, missing backlink metadata, populate target mismatch, provider search mismatch, placeholder production sitemap URLs, localized query locale requirements, and data-only route/sitemap misuse. |
| Golden demo | Pass | `pnpm test:golden` proves docs, blog, authors/data, references, navigation, surroundings, search, route metadata, i18n paths, and sitemap assertions in one executable fixture. |

## Package Evidence

### Ginko Content

- `pnpm install --frozen-lockfile`: pass.
- `pnpm test test/contracts/sitemap-assert-contracts.test.ts test/ginko-unified-populate.test.ts test/contracts/vnext-golden-demo.test.ts`: pass.
- `pnpm test:golden`: pass.
- `pnpm verify`: pass.
- `pnpm pack:check`: pass.
- `pnpm run release:pack`: pass.
- Packed tarball:
  `/Users/matthias/Git/workspace/ginko-content/.pack/lupinum-ginko-content-0.1.2.tgz`.

### Ginko CMS

- `pnpm install --frozen-lockfile`: pass after refreshing the stale lockfile to
  match the existing workspace manifests.
- `pnpm run release:verify`: pass.
- The package e2e harness now packs the sibling local Ginko Content package by
  default for coordinated release QA. Registry dependency testing is still
  available through the explicit `--registry-deps` path.
- Existing provider tests cover page, query, navigation, surroundings, search,
  site data, route metadata, sitemap entries, localized route identity, and
  typed provider failures.

## Consumer Static And Generate Evidence

All consumers installed from:
`/Users/matthias/Git/workspace/ginko-content/.pack/lupinum-ginko-content-0.1.2.tgz`.

### saas-template

- `pnpm install --frozen-lockfile`: pass.
- `pnpm lint`: pass.
- `pnpm typecheck`: pass.
- `pnpm build`: pass.
- `pnpm exec nuxi generate`: pass.
- Removed populated post/author `as unknown as` casts.
- Author pages use schema-driven backlink inference without explicit
  `fields: ['authors']`.
- Generated sitemap: 34 URLs checked.

### saas-i18n

- `pnpm install --frozen-lockfile`: pass.
- `pnpm lint`: pass.
- `pnpm typecheck`: pass.
- `pnpm build`: pass.
- `pnpm exec nuxi generate`: pass.
- Removed populated post/author `as unknown as` casts.
- Author pages use schema-driven backlink inference without explicit
  `fields: ['authors']`.
- No sitemap `nitro.prerender.ignore` workaround remains.
- Generated sitemap: 65 URLs checked.

### shadcn-starter

- `pnpm install --frozen-lockfile`: pass.
- `pnpm check`: pass.
- `pnpm build`: pass.
- `pnpm generate`: pass with release origin exported for the local ignored
  `.env` development override.
- Replaced committed localhost URL defaults with production-style defaults and
  an explicit `GINKO_SITE_URL`/`SITE_URL` override.
- Removed stale migration plan documents.
- Generated sitemap: 26 URLs checked.

## Generated Output And Sitemap Evidence

Generated output assertions passed for all consumers:

- Required docs, blog, authors, changelog, localized, and marketing pages exist
  where expected.
- Required public sitemap URLs are present.
- Forbidden sitemap patterns are absent: `_payload`, `_nuxt`, `_og`, API,
  auth-only, admin, data-only/internal, duplicate malformed URLs, and
  placeholder/dev origins.
- No consumer uses `nitro.prerender.ignore` or `sitemap.autoI18n: false` to hide
  a sitemap mismatch.

Generated-preview HTTP sitemap fetches also passed:

- `saas-template`: 34 URLs.
- `saas-i18n`: 65 URLs.
- `shadcn-starter`: 26 URLs.

## Browser QA Evidence

Evidence directory:
`/Users/matthias/Git/workspace/ginko-content/qa-evidence/vnext-confirmation`.

Screenshots:

- `/Users/matthias/Git/workspace/ginko-content/qa-evidence/vnext-confirmation/saas-template-docs.png`
- `/Users/matthias/Git/workspace/ginko-content/qa-evidence/vnext-confirmation/saas-template-search-result.png`
- `/Users/matthias/Git/workspace/ginko-content/qa-evidence/vnext-confirmation/saas-i18n-localized.png`
- `/Users/matthias/Git/workspace/ginko-content/qa-evidence/vnext-confirmation/saas-i18n-search-result.png`
- `/Users/matthias/Git/workspace/ginko-content/qa-evidence/vnext-confirmation/shadcn-docs.png`
- `/Users/matthias/Git/workspace/ginko-content/qa-evidence/vnext-confirmation/shadcn-search-result.png`

The in-app browser blocks direct XML navigation to `sitemap.xml` with
`ERR_BLOCKED_BY_CLIENT`. Sitemap verification is therefore recorded through
generated-output assertions and real local HTTP fetches instead of browser
screenshots. This is a browser policy limitation, not a content or sitemap
failure.

### saas-template

- Generated preview: `http://127.0.0.1:4101`.
- `/docs` lands on `/docs/getting-started`.
- Nested docs pages render body, sidebar, TOC, and surrounding links without raw
  renderer JSON.
- `/blog/asian-cuisine` renders article body, author data, and head metadata.
- `/authors/alexia` renders the related post card without explicit backlink
  fields.
- Search for `installation` navigates to
  `/docs/getting-started/installation`.
- Relevant browser console errors: none.

### saas-i18n

- Generated preview: `http://127.0.0.1:4102`.
- `/docs/getting-started` and `/de/dokumentation/erste-schritte` resolve with
  localized content.
- The existing locale popup switches English docs to German translated route and
  back.
- The English fallback lab page visibly explains that it has no German
  translation; the German equivalent route is not exposed in generated output.
- `/blog/asian-cuisine`, `/de/blog/asiatische-kueche`, `/authors/alexia`, and
  `/de/autoren/alexia` render with localized content and related posts.
- German search for `installation` navigates to
  `/de/dokumentation/erste-schritte/installation`.
- Relevant browser console errors: none.

### shadcn-starter

- Generated preview: `http://127.0.0.1:4103`.
- `/docs`, `/docs/getting-started/reference/api-keys`, and
  `/docs/essentials/content-rendering/component-tags` render body, nested
  sidebar state, TOC, and MDC content without raw renderer JSON.
- `/blog` and `/blog/static-docs-pipeline` render article and author data.
- Command center search for `api keys` navigates to
  `/docs/getting-started/reference/api-keys`.
- The generated sitemap excludes author/data collection routes.
- Relevant browser console errors: none.

## Defects And Follow-Ups

- No blocking defects remain.
- Keep using a release-origin environment variable for shadcn generated release
  QA when a local ignored `.env` contains a development `NUXT_PUBLIC_SITE_URL`.
