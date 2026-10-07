# Step 7: Runtime and static delivery on Vercel

**Why:** The documented "render at runtime" setup still serves 32 prerendered
HTML pages on Vercel, so runtime-only features (Markdown negotiation, live
data, per-request headers) cannot be shown by following the docs. On
prerendered pages, Vercel serves HTML from the CDN and never calls Nitro, so
`Accept: text/markdown` gets HTML and agent headers are missing. Most sites
prerender (the quickstart does by default). The first page load of
`useContentPage` refetches instead of reusing the SSR payload. A failed
prerender still exits 0.

**Closes:** C-32, C-22 (decision 13), C-05, C-33, P-02.

**Branch:** `step/07-delivery`. **Estimate:** ~5 h.

## Facts (checked 2026-10-05)

- `content.agent.delivery: 'runtime'` today means: crawl and prerender pages,
  then delete prerendered HTML in a `prerender:done` hook
  (`src/module/integration-hooks.ts`, `removePrerenderedHtml`). On Vercel the
  HTML survives (demos K203, C200, C208).
- Content routes enter the prerender queue through the cache route, which
  returns an HTML page of links during prerender
  (`src/runtime/server/api/cache.ts`, `renderContentRouteLinks`).

## Tasks

### 7.1 Runtime delivery does not prerender content pages (C-32) (~90 min)

Decided: with `agent.delivery: 'runtime'` the build does **not** queue content
page routes for prerender at all. Prerendering-then-deleting is removed.

Build on `2b7daa5` (landed in step 0.2b): content routes are seeded through
the `x-nitro-prerender` header, and the module option `prerender: false` seeds
nothing. Read `git show 2b7daa5` first.

1. `agent.delivery: 'runtime'` implies `prerender: false` for content routes
   (an explicit `prerender: true` together with runtime delivery fails setup:
   `agent.delivery "runtime" serves pages per request; remove prerender: true.`).
   The snapshot is still built and published; `/llms.txt`, `/llms-full.txt`
   and search artifacts still prerender.
2. Delete the `removePrerenderedHtml` option and its hook branch in
   `src/module/integration-hooks.ts` (keep the stale cache-route artifact
   removal; it is a separate concern).
3. If a test or fixture shows that some page data dependency is only produced
   by the crawl (the docs say "to retain their generated data dependencies"),
   stop with S3 and name the dependency.

**Regression tests:** e2e (extend the nearest runtime-delivery fixture test):
after `nuxt build` with runtime delivery, `.output/public` contains no
`index.html` for content routes, and a content route served by
`node .output/server/index.mjs` answers `Accept: text/markdown` with Markdown.
Fails before (HTML file present on the Vercel preset; check the preset with
`NITRO_PRESET=vercel nuxt build` and inspect `.vercel/output/static`).

**Done when:** tests pass; demos K203, C200, C208 pass on the blog demo in
production, and C212/C335 (negotiation and `Link` header) pass there.

### 7.2 Static delivery: what works, said plainly (decision 13, C-22, C-05) (~45 min)

Decided for prerendered pages:

- Site-wide agent headers work statically: add one Nitro route rule
  `'/**': { headers: { link: '</llms.txt>; rel="llms"; type="text/markdown", </sitemap.xml>; rel="sitemap"; type="application/xml"', 'content-signal': '<configured value>' } }`
  when agent output is on and delivery is `static` (only add `content-signal`
  when `agent.site.contentSignals` is set; add the sitemap link only when the
  sitemap integration is on). Locale-prefixed `llms.txt` links for other
  locales: one rule per locale prefix (`'/de/**'`).
- Per-page discovery works statically through HTML: `useContentPage` adds
  `<link rel="alternate" type="text/markdown" href="<agent raw path>">` to the
  head when agent Markdown is on for that page (expose the needed flag in
  public runtime config; reuse `agentRawPathForRoute`).
- `Accept: text/markdown` negotiation needs runtime delivery. Static sites
  serve `.md` routes and `llms.txt`.

**Regression tests:** static e2e (`test/e2e/generate-output.test.ts` or
`agent-output-smoke.test.ts`): generated output has the route rule headers in
the Vercel preset config (`.vercel/output/config.json`) or the Node preset
header handling; prerendered HTML contains the `rel="alternate"
type="text/markdown"` link.

**Done when:** tests pass; on the quickstart demo (static) `curl -I` shows the
site-wide `link` header and the HTML has the alternate link; C212/C335 move
from quickstart to the blog demo (runtime) in `checks/claims-map.json`, with
the reason "negotiation needs runtime delivery (decision 13)".

### 7.3 First load reuses the SSR payload (C-33, C153, C157, C156) (~90 min)

Reproduce in the blog demo locally (`node .output/server/index.mjs`) with
Playwright: open a content page directly and record requests to
`/api/_content/` after hydration. Expected: zero. Find why the client
refetches. Check in this order: (a) the `useAsyncData` key differs between
server and client (log `pageKey.value` in both; `stableKey` input includes
`route.path` normalization and locale), (b) `watch: [resolvedPageOptions]`
fires on hydration because the computed returns a new object, (c) `await`
ordering of the two `useAsyncData` calls.

Fix in `src/runtime/app/composables/use-content-page.ts`. Also: `refresh()`
must refresh surround (C156; today it does when `surroundAsync` exists; verify
the demo's failing case and fix the condition it hits).

**Regression tests:** browser e2e: direct load of a content page makes no
content API request after hydration (fails before); client-side navigation to
a second page never shows the first page's title under the second URL
(stale suppression, run 5 times in the test loop); `refresh()` issues one page
and one surround request.

**Done when:** tests pass 5/5 consecutive runs; demos C153, C156, C157 pass at
both viewports, 3 consecutive runs.

### 7.4 A failed prerender fails the build (P-02) (~20 min)

When the app does not set `nitro.prerender.failOnError`, Ginko sets it to
`true` in `src/module/nitro-config.ts`. An app that sets it explicitly keeps
its value.

**Regression test:** generate e2e: a fixture page that throws during prerender
makes `nuxt generate` exit non-zero. Fails before.

**Done when:** test passes.

## Step verification

```bash
pnpm verify
pnpm test:e2e
pnpm test:e2e:browser
```

Demos: blog (runtime; K203, C200, C208, C212, C213, C335, C153, C156, C157),
quickstart (static headers + alternate link). Deploy blog and quickstart.

**Docs:** `7.resources/2.deployment.md` (delivery table: static vs runtime,
what each supports on Vercel, Netlify, Node), `4.guides/12.agent-readable-output.md`
(decision 13 wording; remove the claim that runtime delivery prerenders and
deletes), `5.reference/3.module-options.md` (`agent.delivery`).
