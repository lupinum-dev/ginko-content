# vNext Confirmation Evidence

Status: confirmation complete with follow-ups
Started: 2026-06-03
Updated: 2026-06-03

This document records the confirmation sprint evidence before the full vNext
refactor. A pass here means the proposed API and DX direction works across
Ginko Content, Ginko CMS, and the real Nuxt consumers without hidden
workarounds.

## Rules

- Use the packed `@lupinum/ginko-content` tarball for consumer QA.
- Treat consumer workaround code as a failed experiment unless it is purely
  app-specific UI.
- Do not add compatibility shims or dual paths.
- Record exact command results and browser evidence.
- Failed experiments become defects or design revisions.

## Experiment Status

| Experiment | Status | Evidence |
| --- | --- | --- |
| String collection API | Pass | `pnpm verify` and quickstart typecheck/build passed with string-name API coverage. Real consumers install and build from the packed tarball without app-local collection-handle changes. |
| Schema-driven backlinks | Pass | `pnpm verify` passed; consumer author pages removed explicit `fields: ['authors']`; generated browser QA confirmed related posts render in `saas-template` and `saas-i18n`. |
| Provider harmony | Pass for behavior; normal release gate blocked by release order | `ginko-cms` check, package-consumer, and package e2e passed with local `GINKO_CONTENT_PACKAGE_ROOT`. Normal `pnpm run release:verify` fails because registry `@lupinum/ginko-content@0.1.2` is not published yet. |
| I18n route identity | Pass with monitoring follow-up | Generated/browser QA passed for English/German routes, locale switcher, fallback page marker, localized blog/author/search, and sitemap paths. One payload 404 was observed in an earlier static-server log but did not reproduce on a clean fallback-route pass. |
| Sitemap mode | Pass | Fixed lazy Nuxt Sitemap mode discovery; all consumers generate without sitemap ignore workarounds; exact sitemap assertions passed for required and forbidden paths. |
| Agent misuse diagnostics | Partial | Existing focused diagnostics are covered by `pnpm verify`; the full intentionally-wrong mini-fixture matrix is not complete and remains a vNext task. |
| Golden demo | Partial | Existing quickstart, CMS package consumer, and three real consumers prove most of the dream. A single small one-command golden demo was not added and remains a vNext task. |

## Ginko Content Evidence

- `corepack enable`: failed because `corepack` is not available in this shell (`zsh:1: command not found: corepack`). Continued with the available `pnpm` binary.
- `pnpm install --frozen-lockfile`: pass.
- `pnpm verify`: pass.
  - Included `dev:prepare`, `lint`, package build, docs build, examples build, unit/provider/runtime/client/Nuxt tests, e2e tests, typecheck, and quickstart prepare/typecheck/build.
  - Unit/provider/runtime/client/Nuxt tests: 54 files, 373 tests passed.
  - E2E tests: 1 file, 2 tests passed.
  - Quickstart typecheck and build passed.
- `pnpm pack:check`: pass. Dry-run package metadata reported `@lupinum/ginko-content@0.1.2`, package size 201838 bytes, unpacked size 839027 bytes, and a valid temporary tarball.
- Focused contract regression after the sitemap fix:
  - `pnpm test test/contracts/integration-hooks-contracts.test.ts test/contracts/module-contracts.test.ts`: pass, 7 tests.
- `pnpm run release:pack`: pass.
  - Wrote `/Users/matthias/Git/workspace/ginko-content/.pack/lupinum-ginko-content-0.1.2.tgz`.
  - Tarball timestamp: `Jun 3 10:56 2026`; size: 204181 bytes.
  - No files under `packages/content/src` or `test` are newer than the generated tarball.
- Confirmation change made:
  - `sitemapPrerenderRoutes` is now resolved lazily during `prerender:routes` instead of being snapshotted before Nuxt Sitemap normalizes its mode. This keeps `@nuxtjs/sitemap` as the sitemap XML authority and avoids consumer `nitro.prerender.ignore` patches.
- Non-blocking warnings observed:
  - pnpm no longer reads the `pnpm.packageExtensions` field from `package.json`.
  - Nuxt/Vite sourcemap warnings from module preload and Tailwind plugins.
  - `module.register()` deprecation warning during Nuxt builds.
  - npm reported unknown pnpm/project config keys during `npm pack --dry-run`.

## Ginko CMS Evidence

- `pnpm install --frozen-lockfile`: initial failure after repacking
  `@lupinum/ginko-content@0.1.2` because
  `../ginko-content/.pack/lupinum-ginko-content-0.1.2.tgz` had a new tarball
  integrity with the same version. Refreshed the single lockfile integrity entry
  in `ginko-cms/pnpm-lock.yaml`; rerun passed.
- `pnpm run check`: pass.
  - Included formatting, lint/policy guards, typecheck, package builds, studio
    build, and the full Vitest suite.
  - Test summary: 90 files passed, 1 skipped; 710 tests passed, 1 skipped.
- `pnpm run test:package-consumer`: initial failure in the temporary consumer
  because the harness combines `minimumReleaseAge: 1440` with the workspace Nuxt
  version. Updated the temp fixture `minimumReleaseAgeExclude` to include
  `@nuxt/*` and `nuxt`; this is a harness fix because the fixture intentionally
  installs the workspace Nuxt range.
- `pnpm run test:package-consumer`: second failure was a real configuration
  signal. With `content.config.ts` provider `cms`, the app must not use the
  default MiniSearch engine because the CMS provider intentionally does not
  expose filesystem-only `searchSections`. Updated the temp fixture to set
  `content.search.engine = 'cms'`; rerun passed.
- `pnpm run package:e2e`: initial failure from the same temporary-consumer Nuxt
  `minimumReleaseAge` setting. Updated the package e2e fixture exclude list for
  `@nuxt/*` and `nuxt`.
- `pnpm run package:e2e`: second failure attempted to resolve registry
  `@lupinum/ginko-content@0.1.2`, which is not published in the registry used by
  the package e2e script. Reran with
  `GINKO_CONTENT_PACKAGE_ROOT=/Users/matthias/Git/workspace/ginko-content/packages/content`;
  pass.
  - Package e2e packed local `@lupinum/ginko-content`, installed the temporary
    consumer, ran `ginko-cms init`, generated bridge files, completed doctor
    diagnostics with 26 passed and 1 non-blocking missing Convex URL warning, ran
    Nuxt prepare, and verified package imports.
- Provider harmony proof from existing tests:
  - `test/refactor/provider-contract.test.ts` advertises only tested provider
    capabilities and covers page payloads, fallback metadata, query pagination,
    indexed sort, path-prefix filters, unsupported query/sort errors, navigation,
    sitemap, search, site data, route metadata, and cache metadata.
  - `test/shared/nuxt-provider.test.ts` covers source provider behavior for
    page, list, navigation, surroundings, search, siteData, routeMeta, and
    sitemapEntries, including localized route identity and typed provider
    failures such as `unsupported_query_shape`, `unsupported_query_operator`,
    `provider_body_ast_missing`, and `provider_config_missing`.
  - `test/shared/nuxt-provider-package-conformance.test.ts` verifies the built
    package `dist/nuxt-provider.mjs` maps page and list reads into the final
    provider contract shape.
  - `test/module/e2e-package-consumer.test.ts` verifies the published module
    entrypoint registers `content.provider = 'cms'` and maps provider `cms` to
    `@lupinum/ginko-cms/nuxt-provider`.
- Non-blocking warnings observed:
  - pnpm no longer reads the `pnpm.onlyBuiltDependencies` field from
    `package.json`.
  - Package build declaration/pkg warnings from module-builder.
  - Rollup pure-annotation warnings and studio chunk-size warnings.
  - Node localStorage experimental warnings during tests.
  - Package e2e doctor warning for missing Convex URL in the temporary app.
- Final `pnpm run release:verify`: blocked.
  - `check` portion passed again.
  - `package:e2e` repacked CMS packages, then failed during temporary consumer install because registry `@lupinum/ginko-content@0.1.2` is not published; registry latest is `0.1.1`.
  - `pnpm run audit:prod` run separately: pass, with 1 low vulnerability reported and ignored by current audit policy.

## Consumer Static And Generate Evidence

- Packed tarball used:
  `/Users/matthias/Git/workspace/ginko-content/.pack/lupinum-ginko-content-0.1.2.tgz`.
- `saas-template`
  - `pnpm install --frozen-lockfile`: pass.
  - `pnpm lint`: pass.
  - `pnpm typecheck`: pass.
  - `pnpm build`: pass.
  - `pnpm exec nuxi generate`: pass.
  - Changed author page to remove explicit backlink `fields`.
- `saas-i18n`
  - `pnpm install --frozen-lockfile`: pass.
  - `pnpm lint`: pass.
  - `pnpm typecheck`: pass.
  - `pnpm build`: pass.
  - `pnpm exec nuxi generate`: pass.
  - Removed the sitemap `nitro.prerender.ignore` workaround.
  - Changed author page to remove explicit backlink `fields`.
- `shadcn-starter`
  - `pnpm install --frozen-lockfile`: pass.
  - `pnpm check`: pass.
  - `pnpm build`: pass.
  - `pnpm generate`: pass.
- Generated output exact assertions:
  - `saas-template`: 9/9 required files present, 4/4 required sitemap URLs present, 34 sitemap URLs checked.
  - `saas-i18n`: 11/11 required files present, 10/10 required sitemap URLs present, 65 sitemap URLs checked.
  - `shadcn-starter`: 9/9 required files present, 4/4 required sitemap URLs present, 26 sitemap URLs checked.
  - Forbidden sitemap patterns were absent in all three generated outputs: `_payload`, `_nuxt`, `_og`, API, auth-only, admin, data-only/internal, and duplicate malformed URLs.

## Browser QA Evidence

- Evidence directory:
  `/Users/matthias/Git/workspace/ginko-content/qa-evidence/vnext-confirmation`.
- Screenshots:
  - `/Users/matthias/Git/workspace/ginko-content/qa-evidence/vnext-confirmation/saas-template-docs.png`
  - `/Users/matthias/Git/workspace/ginko-content/qa-evidence/vnext-confirmation/saas-template-search-result.png`
  - `/Users/matthias/Git/workspace/ginko-content/qa-evidence/vnext-confirmation/saas-template-sitemap.png`
  - `/Users/matthias/Git/workspace/ginko-content/qa-evidence/vnext-confirmation/saas-i18n-localized.png`
  - `/Users/matthias/Git/workspace/ginko-content/qa-evidence/vnext-confirmation/saas-i18n-search-result.png`
  - `/Users/matthias/Git/workspace/ginko-content/qa-evidence/vnext-confirmation/shadcn-docs.png`
  - `/Users/matthias/Git/workspace/ginko-content/qa-evidence/vnext-confirmation/shadcn-search-result.png`
  - `/Users/matthias/Git/workspace/ginko-content/qa-evidence/vnext-confirmation/shadcn-sitemap.png`
- `saas-template` generated preview on `http://127.0.0.1:4101`: pass.
  - `/docs` lands on `/docs/getting-started`.
  - Docs pages render body, sidebar, TOC/anchors, and surrounding links without raw renderer JSON.
  - Search for `installation` navigates to `/docs/getting-started/installation`.
  - `/authors/alexia` renders related posts after removing explicit backlink fields.
  - `/sitemap.xml` includes required public paths and excludes forbidden internal paths.
  - Relevant browser console errors: none.
- `saas-i18n` generated preview on `http://127.0.0.1:4102`: pass with one monitoring follow-up.
  - `/docs/getting-started` and `/de/dokumentation/erste-schritte` resolve with localized content.
  - The existing locale popup switches English docs to German translated route and back.
  - `/de/dokumentation/essentials/fallback-lab` is visibly marked `Fallback: en`.
  - Localized blog and author pages render, including author related posts without explicit backlink fields.
  - Localized command search for `verwendung` navigates to `/de/dokumentation/erste-schritte/verwendung`.
  - `/sitemap.xml` includes English and German docs, pricing, authors, changelog, and blog paths.
  - Relevant browser console errors: none.
  - A single malformed generated payload 404 was observed in an earlier static-server log during i18n navigation. A clean reproduction pass through `/de/dokumentation/erste-schritte`, `/de/dokumentation/essentials/fallback-lab`, and `/docs/essentials/fallback-lab` did not reproduce it. Keep this as a monitoring follow-up, not a confirmed blocker.
- `shadcn-starter` generated preview on `http://127.0.0.1:4103`: pass.
  - `/docs`, `/docs/getting-started`, `/docs/getting-started/reference/api-keys`, and `/docs/essentials/content-rendering/component-tags` render body, nested sidebar state, TOC, and MDC content without raw renderer JSON.
  - `/blog` and `/blog/static-docs-pipeline` render article and author data.
  - Command center search for `api keys` navigates to `/docs/getting-started/reference/api-keys`.
  - `/sitemap.xml` includes required docs/blog routes and excludes author/data collection routes.
  - Relevant browser console errors: none.

## Defects And Follow-Ups

- `ginko-cms` normal `release:verify` is blocked until `@lupinum/ginko-content@0.1.2` is published or the release verification script consumes the local tarball/package root for this confirmation workflow.
- Complete the full agent-misuse fixture matrix:
  - unknown collection name;
  - backlinks without schema relation metadata;
  - populate target mismatch;
  - CMS provider with non-CMS search engine;
  - placeholder `site.url` in production-like sitemap builds;
  - route-less localized server query without explicit locale;
  - data-only collection used as route/page/sitemap source.
- Add a single small golden demo only if the team wants one command to prove the dream in isolation. Current confirmation uses quickstart, CMS package consumer, and the three real consumers instead.
- Keep watching the non-reproduced i18n generated payload 404. If it appears again, promote it to a blocking defect with the exact requested URL and route that triggered it.
