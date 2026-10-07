# Step 11: Docs, examples and claims

**Why:** The docs and the shipped agent skill teach wrong things (old install
version, wrong payload shapes, a 404 guarded by `import.meta.server`). Only 4
examples exist; search, navigation, i18n and agent output have none. 53 claims
have no demo. Two claims are unproven ("edge runtime", "~2,000 documents").
1.0 must say only what a deployed demo proves.

**Closes:** G-02, G-04, G-05 (decision 9), G-06, C-01, C-04, C-06, and the claim status of C-18, C-26, C-31, C-36.
Criteria 6 and 7.

**Branch:** `step/11-docs-and-claims`. **Estimate:** ~8 h + Opus copy review.

Follow `docs/WRITING.md` for every docs page. Code blocks in docs must be
typechecked where the repo already does that (`pnpm docs-drift`).

## Tasks

### 11.1 Fix what the docs and skill teach wrong (G-02, G-03 leftovers) (~90 min)

Work through `.audit/claims/gaps.md` (in the `ginko-content-1.0` worktree),
"top 10" and the 7 documentation conflicts. For each: fix the page or the
skill file under `skills/`, then tick it in `log.md`. Known items:

- Install commands use the 1.0 package version, never `0.3.0` or the stable
  channel before 1.0 exists. Use one variable source if `docs-drift` supports
  it; otherwise `1.0.0-rc.1` and step 12 updates it.
- Navigation and search payload shapes in the skill match the real types
  (copy from the generated API docs).
- No `import.meta.server` guard around the 404 (step 8.4 made the 404 default).
- Route guide separates content paths from mounted URLs with one table.
- Sitemap guide covers single-sitemap mode and the index mode correctly.
- Module reference shows the V2 component policy only.

**Done when:** every gap item is fixed or marked "obsolete after step N" in
`log.md`; `pnpm docs:build && pnpm docs:smoke && pnpm docs-drift` pass.

### 11.2 Claims (decision 9, G-04, G-05, G-06) (~60 min)

- Remove the "edge runtime" claim everywhere (`rg -n -i "edge" docs/content meta README.md packages/content/README.md`); deployment docs say Node.js (serverless or server) and static.
- `meta/VISION.md` and README: "~2,000 documents" stays only with the numbers
  measured in step 6 (static and SSR, search) written next to it, with a link
  to the scale demo. If step 6 did not reach the target, write the measured
  limit instead.
- `ginko-content-demos/checks/claims-map.json`: every one of the 365 claims
  has exactly one status: `demo:<check id>`, `test:<test file>` (for claims a
  browser cannot show, e.g. type-level), `dropped:<reason>` or
  `out-of-scope-1.0:<reason>`. The 53 claims without a demo (G-06: 14 field
  types, navigation tree helpers, agent path helpers, portability API,
  runtime ranges) get a demo check or a `test:` mapping. `pnpm check:map` must
  report zero unmapped claims.

**Done when:** `corepack pnpm check:map` in the demos repo reports 0 unmapped
and 0 `fail`.

### 11.3 Examples (C-01) (~90 min)

Add 4 minimal examples next to the existing 4 (follow
`examples/essentials/hello-world` structure, package naming and README
format):

- `examples/search/minisearch` (search box with `useContentSearch` or the
  current search composable, 5 pages)
- `examples/navigation/sidebar` (navigation tree + surround)
- `examples/i18n/two-locales` (en/de, translated slugs, language switch per step 8.5)
- `examples/agent/markdown-output` (agent output on, one custom serializer per step 8.1)

Start from commit `c3fbd4c` in the tag `archive/feat-dx-polish` (it added
navigation, search, i18n and agent-output examples in August):
`git show c3fbd4c --stat`, then copy what still fits the 1.0 API and rewrite
the rest. The tag also holds `260803400` (errors reference and a
type-errors guide); reuse its text for the troubleshooting page where it
still matches.

Each builds in `pnpm examples:build` and is listed in
`docs/content/docs/7.resources/1.examples.md`. The untracked `examples/{agent,i18n,navigation,search}` folders in
Matthias's checkout hold only build output; ignore them.

**Done when:** `pnpm examples:build` passes with 8 examples.

### 11.4 Migration guide from the betas (criterion 7) (~45 min)

`docs/content/docs/6.migration/4.ginko-version-upgrades.md`: one section
"From 1.0.0-beta.x to 1.0" built from the `## Unreleased` CHANGELOG Breaking
entries. Each entry: what changed, why (one line), before/after code. Order by
how many apps it touches: collection names in app code, page 404 default,
heading ids, `source`/`sources`, removed entry points, peer dependencies,
agent serializers.

**Done when:** every Breaking entry in `CHANGELOG.md` has a section; `pnpm docs-drift` passes.

### 11.5 Docs site quality (C-04, C-06) (~60 min)

Use the PR's Vercel preview of the docs app (`vercel-preview.yml` deploys
it; do not deploy production).

- Search: run the docs query set (create `docs/search-queries.json` with 10
  queries and expected first results, e.g. `defineCollection` → the content
  config reference, `quickstart` → the quickstart; include `xyz-no-match` →
  no results). All must pass on the preview.
- Lighthouse mobile on `/` and `/docs/get-started/quickstart` ≥ 90 each: give
  the logo explicit `width`/`height`, remove render-blocking CSS that is not
  needed above the fold, check unused JS with the step 4 script.

**Done when:** query set passes and both Lighthouse scores ≥ 90 on the preview (log the numbers and URL).

### 11.6 Quickstart from zero (criterion 7) (~30 min)

On a clean temp directory with only Node and Corepack: follow
`docs/content/docs/1.get-started/1.quickstart.md` literally, using the packed
tarball instead of the npm version (the only allowed deviation; write it
down). Time from first command to a working page in the browser. Target ≤ 10
min. Every place you had to guess or the docs were wrong is a docs fix in this
step.

**Done when:** time ≤ 10 min logged; zero guesses left.

### 11.7 Copy review (gate G6) (~0 min for Codex)

User-facing text needs a taste pass by Opus. Write into `questions.md`:
"Step 11 docs ready for copy review: <PR URL>". Continue with step 12.1 and
12.2 while waiting; do not merge the step 11 PR before the review comments are
addressed.

## Step verification

```bash
pnpm verify
```

Demos: `pnpm check:map` clean.
