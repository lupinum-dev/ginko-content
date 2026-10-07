# Step 6: Derive once (static scale, search, agent, sitemap)

**Why:** Derived data is recomputed where it is used. During `nuxt generate`,
every prerendered request re-reads and re-hashes every source file and
rebuilds the graph, so 2,000 documents run out of memory and 1,000 take 25
minutes. Runtime search loads at most 100 pages per collection and locale
(default query limit), then rebuilds MiniSearch on every request, so search on
a real site returns wrong pages with no sign they are wrong. The agent
middleware renders a whole Markdown page on every request only to decide one
`Link` header. Sitemap opt-outs leak on static sites.

**Closes:** P-04, E-A003, C-35, E-A015, C-25, P-03, C-23, C-24, C-14, C-20,
C-09, A-12 (sitemap default, decision 6), E-X1 (decision 10).

**Branch:** `step/06-derive-once`. **Estimate:** ~10 h.

## Target design

```
build:  sources ─► snapshot.json (frozen) ─► derived artifacts, computed once:
                                              routes · navigation · search-records.json
                                              · agent-routes.json · sitemap facts
prerender + runtime: read snapshot + artifacts once per process (keyed by integrity)
dev:    per-request rebuild stays (HMR needs fresh data)
```

## Facts (checked 2026-10-05)

- `src/storage/graph.ts` `getContentGraph`: when `usesProcessSnapshot` is
  false (dev **and** prerender), the graph is memoized per **request**
  (`memoizeRuntimeValue(event, 'graph', …)`) and rebuilt from
  `getContentsList(event)`, which loads and hashes every source file
  (`storage/contents.ts`, `ohash(body)` per file) and validates
  (`shouldValidateAtRuntime = import.meta.dev || import.meta.prerender`).
- The cache route (`src/runtime/server/api/cache.ts`) is put first in the
  prerender queue, builds the full result once, and publishes `snapshot.json`
  and `validation.json` before page routes are rendered.
- Each documented page prerenders 4 routes (HTML, payload, agent `.md`, raw).
  2,000 pages × 4 routes × full re-ingest = quadratic work.

## Tasks

### 6.1 Prerender reads the published snapshot once (P-04) (~90 min)

1. In `src/storage/graph.ts` and `src/storage/contents.ts`: when
   `import.meta.prerender` is true **and** the cache route has published
   `snapshot.json` with the current `cacheIntegrity`, use the process snapshot
   path (`getProcessGraph` / `getProcessDocuments` in
   `src/storage/snapshot-runtime.ts`) exactly like production. Read
   `snapshot.json` once per process; key the cached graph by integrity.
2. Before the snapshot is published (the cache route's own request), keep the
   current ingest path.
3. Dev keeps per-request memoization.
4. Do not change what production reads.

**Measure** with the demos scale harness (`checks/scale-builds.mjs`, read it
first): static generate at 200, 1,000, 2,000 documents, 1 run each, record
time and peak RSS in `log.md` next to the old numbers (200: 48 s / 2.3 GB;
1,000: 1,501 s / 3.3 GB; 2,000: heap exhaustion).

**Regression test:** a runtime/contracts test with a counting spy on the
source loader: prerendering N page routes after the cache route loads each
source file at most once (count = number of files, not N × files). Fails
before.

**Done when:** test passes; 2,000-document static generate finishes; time at
2,000 ≤ 2.5 × time at 1,000. If not, profile with
`node --cpu-prof` on the prerender process, write the top 10 self-time
functions into `log.md`, fix the next cause if it is in Ginko code, else stop
with S6.

### 6.2 Search records are derived from the whole corpus (E-A003, C-35) (~90 min)

1. New pure module `src/features/search/derive.ts`:
   `deriveSearchRecords(graph, config): SearchIndexRecord[]` builds records for
   every document of every searchable collection in every locale, straight from
   the graph. No query API, no limit. Reuse `createSearchSections` and
   `toSearchIndexRecord`.
2. Filesystem source: compute the records once at build in `buildContentResult`
   (`src/integrations/nitro/build.ts`) and publish `search-records.json` next to
   `snapshot.json` (same integrity). The prerender and runtime paths read it
   once per process.
3. External source with `search.engine: 'minisearch'`: load documents with full
   pagination (follow `total`/`skip` until exhausted, page size =
   source `maxPageSize`), memoized per process until the next authenticated
   revalidation (`/api/_content/revalidate`) clears it. Provider-engine search
   (`engine: 'provider'`) is unchanged.
4. `src/runtime/server/search.ts` `loadSearchDocuments` and
   `buildSearchIndex` call the derived records; delete the query-based loader.

**Regression test:** contracts: a fixture with 250 pages in one collection and
2 locales yields 500 owning pages in the records (fails before: 200).

**Done when:** test passes; demos X401 (scale: 20/20 unique tokens find their
owning page first in each locale) passes.

### 6.3 One MiniSearch per process; empty query does nothing (E-A015) (~30 min)

`src/runtime/server/api/search.ts` builds a MiniSearch index on every request.
Build it once per process per `(integrity, locale)` key, from the records of
6.2. A term that is empty after trimming returns `[]` without touching the
index.

**Regression test:** runtime test with a spy on `createMiniSearchIndex`: two
search requests build one index; `q=` returns `[]` and builds none. Fails before.

**Done when:** test passes; scale demo: search request p95 ≤ 150 ms server time
(measure with `checks/scale-latency.mjs` or 50 requests with `curl -w
'%{time_starttransfer}'` against the deployment, log both).

### 6.4 Search text keeps word boundaries (C-25, X006) (~20 min)

`src/features/search/sections.ts` joins text of adjacent block nodes without a
space (`placeRecord`, `notebookSave`). Insert one space between block-level
nodes (`p`, `li`, `h1`–`h6`, `td`, `th`, `blockquote`, `pre`, `div`) when
extracting text; collapse whitespace runs to one space.

**Regression test:** unit: `- place\n- record` extracts `place record`. Fails before.

**Done when:** test passes; demos X006 passes.

### 6.5 Agent index instead of per-request rendering (decision 6, P-03, C-23, C-24) (~90 min)

1. Derive `agent-routes.json` at build: the set of public route paths whose
   document has agent Markdown enabled (`agent.markdown` not `false` for the
   collection and the document). Visibility in navigation or sitemap does
   **not** matter (C-23). Drafts are excluded.
2. `src/runtime/server/middleware/agent-link-headers.ts`: replace
   `resolveMarkdownForPublicRoute(...)` with a set lookup in the agent routes
   (read once per process). No Markdown rendering in the middleware.
3. The raw `.md` route serves every page in the agent routes, including pages
   hidden from navigation or sitemap (C-23, C202).
4. A request for a `.md` route that is not in the set returns status 404 with
   `content-type: text/markdown; charset=utf-8` and the documented recovery
   body (read `4.guides/12.agent-readable-output.md` around line 114; render it
   with the existing recovery function if one exists:
   `rg -n "recovery" packages/content/src/runtime/server`). This works with
   runtime delivery. For static delivery, document that unknown `.md` routes
   get the host's normal 404 (C-24 static half).

**Regression tests:** runtime test: middleware adds the page `Link` for a route
in the set and does not call the Markdown renderer (spy); `.md` for a page
with `navigation: false` returns 200; unknown `.md` returns 404 Markdown. The
first and second fail before.

**Done when:** tests pass; demos C202 (docs-site), C213 (blog, runtime) pass.

### 6.6 Sitemap default and opt-outs (decision 6, C-09, C-14, C-20) (~90 min)

1. **Default:** sitemap integration is on only when `@nuxtjs/sitemap` is in
   `nuxt.options.modules` (by name, at module setup). Without it: no warning,
   no sitemap routes. `content.sitemap: true` without the module throws
   `content.sitemap needs @nuxtjs/sitemap. Install it or remove the option.`
   `content.sitemap: false` turns it off even when the module is installed.
2. **Opt-outs on static sites (C-14):** `@nuxtjs/sitemap` also discovers
   prerendered routes, so a page with `sitemap: false` or a collection with
   `sitemap: false` still appears. Fix in `src/runtime/server/plugins/sitemap.ts`
   / `src/module/sitemap-assert.ts`: pass every opted-out content route to the
   sitemap module's exclusion (find the supported option in the installed
   `@nuxtjs/sitemap` version: `exclude` in module config or the `sitemap:resolved`
   / `sitemap:input` Nitro hook; prefer the hook so the list comes from the
   build result, not from a second computation).
3. **Duplicates (C-20):** a URL appears once. Dedupe by absolute `loc` after
   discovery and Ginko's source merge (via the same hook).

**Regression tests:** e2e `test/e2e/sitemap-static.test.ts` (extend): a page
with `sitemap: false` and a collection with `sitemap: false` are absent from
the generated `sitemap.xml`; no duplicate `loc`. A module test: no warning and
no sitemap route without `@nuxtjs/sitemap`. Fail before.

**Done when:** tests pass; demos C190, C199 pass on docs-site; quickstart build
log has no sitemap warning (C-09).

### 6.7 Singleton hreflang: change the doc (decision 10, E-X1) (~15 min)

Decided: a page that exists in one language needs no hreflang alternates.
Update `meta/ARCHITECTURE.md` (the "full reciprocal set incl. `x-default`"
promise) and `4.guides/9.sitemap-and-prerender.md` to say so. In
`ginko-content-demos`, change K102/X102 to assert: a single-variant page has no
`xhtml:link` alternates. Keep the code.

**Done when:** docs updated; K102/X102 pass.

## Step verification

```bash
pnpm verify
pnpm test:search:matrix && pnpm test:sitemap:static
```

Demos: all six rebuilt. Must pass: X401, X006, X003, X004, X005, X103, C202,
C213, C190, C199, K102/X102, scale static generate at 2,000. Record in
`log.md`: static generate 200/1,000/2,000 (time, RSS), search p50/p95, SSR
p50/p95 on scale. Deploy all six. Re-measure P-03 (agent on/off) on scale and
log it.

**Docs:** `4.guides/8.search-engines.md` (full corpus, memoization, external
sources paginate), `4.guides/9.sitemap-and-prerender.md` (default, opt-outs),
`4.guides/12.agent-readable-output.md` (agent routes independent of nav and
sitemap; 404 behavior per delivery), `5.reference/3.module-options.md`
(sitemap default). `meta/VISION.md`: keep "~2,000 documents" only if 6.1 and
6.2 pass at 2,000; otherwise write the measured limit.
