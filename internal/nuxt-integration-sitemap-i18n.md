# Nuxt Integration Notes: Sitemap, Prerender, and I18n

This note explains the current Ginko integration contract with Nitro, Nuxt I18n, and `@nuxtjs/sitemap`.

It exists because these seams are easy to break with changes that look reasonable in isolation:

- app-owned `nitro.prerender.routes` arrays
- patching Nuxt Sitemap virtual modules
- asserting sitemap output too early in Nitro's build lifecycle
- treating `localePaths` as a complete route solution without the route integration helper

## Current contract

### 1. Content page prerendering

Ginko owns content-backed prerender routes through Nitro's `prerender:routes` hook.

Implementation:

- `packages/content/src/module/integration-hooks.ts`

Why:

- content routes must come from the content graph, not from app config duplication
- locale prefixes, translated slugs, drafts, and canonical variants are already resolved there
- app-level route lists drift and are an anti-pattern for this module

Rules:

- do not add hardcoded content route arrays to app `nuxt.config.ts`
- if prerender misses a content route, fix route discovery in Ginko
- keep app-owned seed routes limited to true app pages if ever needed

### 2. Sitemap source registration

Ginko registers its sitemap JSON source through Nuxt Sitemap's official runtime hook: `sitemap:sources`.

Implementation:

- `packages/content/src/runtime/server/plugins/sitemap.ts`

Why:

- this is the upstream-supported extension seam
- it works in dev and generate
- it cleanly replaces the upstream Nuxt Content v2 source with Ginko's endpoint

Rules:

- do not patch `#sitemap-virtual/*` files
- do not mutate another module's generated sources after the fact
- if Nuxt Sitemap changes, re-check `sitemap:sources` before introducing any fallback patching

### 3. Sitemap assertion timing

Ginko validates generated sitemap XML on Nuxt Sitemap's `sitemap:prerender:done` hook.

Implementation:

- `packages/content/src/module.ts`
- `packages/content/src/module/sitemap-assert.ts`

Why:

- Nitro build hooks can fire before child sitemap XML files exist
- validating too early created false negatives and pushed the app toward bad workarounds
- `sitemap:prerender:done` is the first point where the final XML artifacts are actually complete

Rules:

- keep `content.sitemap.assert` tied to final sitemap artifacts
- do not move the main generate assertion back to Nitro `compiled` or prerender hooks
- the compiled fallback only exists for non-static build mode and should stay secondary

### 4. Nuxt I18n page sync

Localized content pages should load with `useContentPage()`, which registers route metadata through `useContentRoute(page)`.

Implementation:

- `packages/content/src/runtime/app/composables/route.ts`

Why:

- `localePaths` alone are not enough for localized custom route templates
- Nuxt I18n needs route-template-aware params, not only localized paths
- the composable reconciles `localePaths` and the current route record

Rules:

- do not reintroduce app-level overrides for alternate links or locale params
- do not make raw document queries mutate Nuxt I18n state
- if locale switching breaks, debug `useContentRoute()` and route param extraction first

## Easy mistakes

### Using the wrong path id when parsing content from disk

The prerender and sitemap helpers parse files outside the main ingest pipeline. They must still use a content-style id:

- `content:${relativePath}`

Implementation detail:

- `packages/content/src/module/integration-hooks.ts`

Why it matters:

- path meta derives `_collection`, `_path`, and locale data from that id format
- using a bare relative path breaks collection counting and route extraction

### Treating build output and generate output as the same thing

- `nuxt build` may produce a server bundle without static child sitemap XMLs in `.output/public`
- `nuxt generate` is the release-critical path for static sites and is where the main assertion runs by default

If a static site is the release target, test `generate`, not only `build`.

## Troubleshooting and dead ends we already hit

This section is intentionally blunt. These are the mistakes that wasted time during the setup, plus the correct fix for each one.

### Symptom: generated site only works when the app hardcodes `nitro.prerender.routes`

Wrong move:

- adding app-owned route arrays such as `/docs/...`, `/de/dokumentation/...`, `/__sitemap__/en-US.xml`

Why it was wrong:

- it duplicated the content graph in app config
- it hid Ginko prerender bugs instead of fixing them
- it would drift as soon as content or locales changed

Actual fix:

- make Ginko contribute content routes from the graph through `prerender:routes`
- keep the app free of content-derived route lists

What to check:

- `collectPrerenderRoutes()` in `packages/content/src/module/integration-hooks.ts`
- generated output should contain docs/blog HTML without any app route array

### Symptom: content routes were missing from prerender even though the hook existed

Wrong move:

- debugging crawl behavior first

Why it was wrong:

- the root cause was earlier: the helper parsing files from disk used the wrong id shape

Actual fix:

- parse helper files with `content:${relativePath}`, not a bare relative path

What to check:

- if `_collection` or localized `_path` values look wrong in helper output, the id format is probably wrong

### Symptom: live dev sitemap or generated locale sitemaps were empty

Wrong move:

- patching Nuxt Sitemap virtual modules
- mutating another module's sitemap sources late

Why it was wrong:

- it depended on internal file layout
- it split dev and generate behavior
- it was brittle against upstream changes

Actual fix:

- register the Ginko source through `sitemap:sources`
- replace the upstream Nuxt Content v2 source there

What to check:

- `packages/content/src/runtime/server/plugins/sitemap.ts`
- `/api/_content/sitemap` should return entries
- generated `__sitemap__/*.xml` should contain URLs and images

### Symptom: sitemap assertion fired even though generated XML was fine

Wrong move:

- asserting from Nitro hooks that ran before child sitemap XML files existed

Why it was wrong:

- Nitro's lower-level lifecycle is not the same thing as "Nuxt Sitemap finished writing final XML"

Actual fix:

- run generate assertions on `sitemap:prerender:done`

What to check:

- if the assertion complains about missing sitemap XMLs during generate, inspect the hook timing before touching app config

### Symptom: `__sitemap__/en-US.xml` was populated after generate but appeared empty in another code path

Wrong move:

- assuming every successful `build` proves static sitemap output is correct

Why it was wrong:

- `build` and `generate` have different artifact expectations
- static locale child sitemaps are a generate concern

Actual fix:

- treat `nuxi generate` as the release gate for static sites

What to check:

- `.output/public/__sitemap__/en-US.xml`
- `.output/public/__sitemap__/de-DE.xml`

### Symptom: locale switching generated broken URLs like `/docs/docs/...` or `/de/dokumentation/dokumentation/...`

Wrong move:

- treating `localePaths` as a complete route solution without the route integration helper
- patching the app with manual head/alternate overrides

Why it was wrong:

- `localePaths` alone are not route-template-aware for localized custom routes

Actual fix:

- use `useContentRoute(page)` so params are normalized against the current route record and `localePaths`

What to check:

- localized dynamic pages should call `useContentPage()` or explicitly pass their page payload to `useContentRoute(page)`

### Symptom: upstream sitemap integration broke because the server collection query entrypoint was missing

Wrong move:

- treating the old export as dead because Ginko had its own query API already

Why it was wrong:

- the sitemap module still imports a removed path-first content query helper from `#content/server`

Actual fix:

- keep that server export available so the upstream integration contract stays intact

What to check:

- if sitemap crashes with an import/export error from `#content/server`, verify the compatibility export first

### Symptom: dev or build crashed with `Cannot find package 'comark' imported from ./.nuxt/dev/index.mjs`

Wrong move:

- assuming normal dependency resolution would cover runtime parser imports automatically

Why it was wrong:

- Ginko's runtime markdown path is bundled through Nuxt/Nitro and needs explicit inline/transpile handling

Actual fix:

- keep `comark` and `@comark/vue` in the module's runtime inline/transpile configuration

What to check:

- `packages/content/src/module.ts`
- if parser imports fail from `.nuxt/dev` or server bundle output, inspect `build.transpile`, Vite SSR `noExternal`, and Nitro externals first

### Symptom: `@nuxtjs/sitemap` logs `No dynamic sources detected`

Wrong move:

- treating that log line as proof the integration is broken

Why it was wrong:

- it comes from an upstream static heuristic
- it does not reflect the working runtime hook path

Actual fix:

- ignore the message unless the actual XML output is wrong

What to check:

- real XML output
- `content.sitemap.assert` result
- source registration through `sitemap:sources`

## Required verification when these seams change

At minimum:

1. Run module contracts:
   - `test/contracts/module-contracts.test.ts`
   - `test/contracts/sitemap-assert-contracts.test.ts`
   - `test/contracts/integration-hooks-contracts.test.ts`
2. Run the target app:
   - `pnpm typecheck`
   - `pnpm exec nuxi generate --logLevel verbose`
3. Inspect output:
   - `.output/public/__sitemap__/en-US.xml`
   - `.output/public/__sitemap__/de-DE.xml`
   - expected docs/blog HTML files
4. Run one negative proof:
   - exclude a required collection from `content.sitemap.include`
   - keep it in `content.sitemap.assert.requiredCollections`
   - confirm generate fails

## Safety model

The current safety model is layered:

- `prerender:routes` prevents missing content pages in static output
- `sitemap:sources` keeps live and generated sitemap sources aligned
- `content.sitemap.assert` prevents shipping empty or incomplete generated sitemap XML

If one of these layers fails, fix the module seam. Do not patch the app.
