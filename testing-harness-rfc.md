# RFC: Testing Harness — Current State → Full-Confidence Release Gate

> **Status:** Draft for adoption. **Owner:** maintainers. **Created:** 2026-07-09.
>
> **This file is an executable spec** in the style of
> `release-hardening-playbook.md`: every judgment call has a ruling (§4),
> every task has an ID, explicit acceptance criteria, and a gate (§6), and
> progress is recorded append-only in the Status Log (§9). Work phases
> top-to-bottom. Process conventions (both-directions proof, one task = one
> commit, never weaken a test to pass a gate) inherit from
> `release-hardening-playbook.md` §2 verbatim.

---

## 0. Mission

Make releases of `@lupinum/ginko-content` boring: a green run of the release
gate means **no route, sitemap, search index, i18n variant, agent-output
artifact, or packaging regression** shipped — for both server-rendered and
fully static deployments — without turning every PR into an hour-long wait.

The strategy is **tiers, not one giant suite** (§2): each tier buys a defined
slice of confidence at a defined wall-time budget, and every check lives in
exactly one tier.

---

## 1. Current state (verified 2026-07-09)

The harness is already ~80% of the vision. Do **not** rebuild anything below;
the phases in §5 only fill the enumerated gaps.

### 1.1 What exists and works

| Layer | What | Where |
|---|---|---|
| Unit/contract | 7 vitest projects (`unit`, `provider`, `contracts-node`, `runtime`, `client`, `nuxt`, plus e2e/browser-e2e); 37 contract files pin the public API, query wire format, exports map, locale manifest | `vitest.config.ts`, `test/contracts/` |
| Golden demo | Hand-authored end-to-end contract over one fixture provider (pages, fallback, navigation, search, routeMeta, sitemapEntries) | `test/contracts/vnext-golden-demo.test.ts`, `pnpm test:golden` |
| Real builds | `nuxi build` of 7 playgrounds with per-fixture+env build cache; prod server boot with readiness probe | `test/helpers/production-fixture.ts` |
| Static output on disk | Prerendered HTML/sitemaps/search-index/`llms*.txt`/`raw/*.md` read from `.output/public` and asserted; full-artifact sweeps for local origins, `/de/de/` doubled prefixes, private-content leaks | `test/e2e/generated-output-smoke.test.ts`, `test/e2e/sitemap-static.test.ts`, `test/helpers/generated-artifacts.ts`, `test/helpers/sitemap-artifacts.ts` |
| Live routes | HTTP smoke over content pages, navigation/search APIs, i18n fallback; agent markdown negotiation incl. headers, 404s, path-traversal rejection | `test/e2e/prod-smoke.test.ts`, `test/e2e/agent-markdown-negotiation.test.ts`, `test/e2e/agent-output-smoke.test.ts` |
| Search matrix | 4 engines/modes: minisearch, pagefind (static asset emission), provider-owned, disabled | `test/e2e/search-matrix.test.ts` |
| Real browser | Playwright chromium: locale switch, search UI, back/forward; asserts **zero console errors, zero failed `/api/_content` requests, zero hydration errors** | `test/browser-e2e/locale-search.test.ts` |
| Packaging | Packed tarball → throwaway consumer app → typecheck, build, boot, output assertions incl. custom-serializer sentinel; tarball hygiene (no `workspace:*`, forbidden files, exports+d.ts completeness) | `scripts/test-packed-consumer.mjs`, `scripts/release-pack.mjs` |
| Docs | docs app builds; every generated HTML greps clean of `undefined` hrefs; docs-drift with positive controls | `scripts/docs-build-smoke.mjs`, `scripts/docs-drift.mjs` |
| CI tiers | PR: `pr-e2e-smoke` (<3 min) + `verify` (≤45 min). Main/dispatch: `release:verify` (≤90 min, incl. browser + packaging) | `.github/workflows/ci.yml` |

### 1.2 The gaps (ranked by regression-escape likelihood)

1. **`nuxt generate` is never executed.** All output checks run against
   `nuxi build` + `nitro.prerender`. The sitemap module's dedicated
   `mode: 'generate'` hook selection is only unit-tested against synthetic
   temp dirs (`test/contracts/sitemap-assert-contracts.test.ts`). The fully
   static deployment story ships unverified.
2. **No dependency-drift canary.** Deps are pinned; Renovate opens PRs, but
   nothing runs the suite against latest upstream (nuxt, `@nuxtjs/i18n`,
   vitest) on a schedule. Breakage is discovered during release week.
3. **No route-inventory golden file.** Output assertions sample hand-picked
   routes. A change that silently drops half the prerendered pages passes as
   long as the sampled routes survive.
4. **No internal-link integrity check.** `docs-build-smoke.mjs` only greps
   for `undefined`; nothing asserts that every internal `href` in prerendered
   HTML resolves to an emitted file or valid route.
5. **CI matrix is Node 22 / ubuntu only** while `engines` promises `>=20`.
   No Windows leg despite path handling being a classic content-library
   failure mode.
6. **`robots.txt` unverified.** No fixture emits or asserts it.
7. **Browser coverage is one fixture, one flow.** Hydration/console checks
   don't sweep the broader page set.
8. **Process:** `release-hardening-playbook.md` §13 DoD is unchecked — no
   recorded green end-to-end `release:verify` for v0.2.x.

---

## 2. Target architecture: four confidence tiers

Every check belongs to exactly one tier. Adding a check means naming its tier
and staying inside that tier's budget — this is the anti-"endless useless
work" mechanism.

| Tier | Trigger | Budget | Contents | Question it answers |
|---|---|---|---|---|
| **T-fast** | every commit locally (`pnpm typecheck && pnpm test`) | ≤ 5 min | unit, provider, contracts-node, runtime, client, nuxt projects | "Is the logic and public contract intact?" |
| **T-pr** | every PR (`verify` + `pr-e2e-smoke` jobs) | ≤ 45 min / ≤ 3 min | T-fast + lint + package/docs/examples builds + full e2e project + quickstart + **one i18n output check (T6-1)** | "Does it build, prerender, and serve correctly?" |
| **T-release** | push to main, `workflow_dispatch`, and manually before every tag (`release:verify`) | ≤ 90 min | T-pr + browser-e2e + packed consumer + search matrix + sitemap static + **generate lane** + **route manifests** + **link integrity** + audit + release-pack | "Can this exact artifact be published for every supported deployment mode?" |
| **T-canary** | weekly cron, **non-blocking** | ≤ 90 min/leg | `release:verify` on an attribution matrix: each high-risk dep@latest alone, all@latest, declared peer minimums; plus a Windows unit leg | "Which upcoming dep breaks us — and do our peer ranges still tell the truth?" |

**Explicit non-goals** (rejected as poor confidence-per-hour for a content
library at this stage — revisit only with a concrete escaped-regression that
one of these would have caught):

- Visual/screenshot regression testing (brittle, fixture UIs are not the product).
- Mutation testing (contract suite already pins behavior; cost ≫ benefit).
- Coverage-percentage gates (invites gaming; contracts + golden outputs are the real gate; keep `test:coverage` for humans).
- Load/performance testing (no perf promises in the public contract yet).
- Exhaustive OS matrix on PRs (Windows leg lives in T-canary/T-release only, see R-6).
- Auto-generated `toMatchSnapshot` blobs (see R-2).
- A bespoke test framework or custom vitest reporter plugins. The harness
  runner (Phase T7) is a thin process orchestrator over the existing pnpm
  scripts — if it ever needs to parse vitest internals, it has gone too far
  (R-13, C-16).

---

## 3. Principles

1. **Verify artifacts, not implementations.** The highest-value checks read
   `.output/public` off disk or hit a booted prod server. Prefer extending
   those over adding mocked unit tests.
2. **Every negative check needs a positive control.** A sweep that asserts a
   forbidden pattern is *absent* is silently useless the day the pattern or
   the fixture drifts. Each sweep must have a companion test proving the
   pattern *would* be caught (docs-drift already does this; §5 extends the
   discipline to leak sweeps — T2-4).
3. **Golden files over hand-picked samples** for enumerable output (route
   lists, sitemap URL sets). A committed manifest turns "did the site shape
   change?" into a reviewable diff instead of a hope.
4. **Both-directions proof** for every new check: break the thing, watch the
   check fail; fix it, watch it pass. Record in §9. A check never proven to
   fail is decoration.
5. **Determinism or delete.** Any flaky test is fixed within one week or
   moved out of blocking tiers (R-7). A gate people retry is a gate people
   ignore.
6. **One tier per check.** Never run the same expensive check in two tiers.

---

## 4. Rulings (pre-made decisions — do not re-litigate)

- **R-1 — `generate` lane scope.** Real `nuxi generate` runs for exactly two
  fixtures: `playground/ginko-basic` (plain) and `playground/ginko-i18n`
  (i18n). Not for search/agent playgrounds — their static artifacts are
  already covered by the build-prerender lane; duplicating them buys minutes,
  not confidence.
- **R-2 — Golden format.** Route manifests are **committed, sorted,
  newline-delimited text files** (one relative path per line) under
  `test/golden/`, compared with plain string equality and regenerated via an
  explicit `pnpm golden:update` script. No vitest `toMatchSnapshot` — blob
  snapshots get rubber-stamped; a sorted text diff gets reviewed.
- **R-3 — Manifest churn.** Hash-named assets (`_nuxt/*`, `_payload.json`
  content hashes) are excluded from manifests via a normalization step;
  manifests capture **routes and named artifacts** (HTML pages, sitemaps,
  `llms*.txt`, `raw/**.md`, `search/index.json`, `robots.txt`, `pagefind/`
  presence), not bundler output.
- **R-4 — Canary failures never block.** The weekly canary opens/updates a
  single GitHub issue (labeled `deps-canary`) on failure. It does not fail
  the default branch, does not page anyone.
- **R-5 — Sweet spot for PRs.** T-pr may grow by at most **one** e2e output
  check (T6-1). Everything else new lands in T-release. If `verify` exceeds
  45 min in CI twice in a row, remove the newest addition first.
- **R-6 — Matrix.** T-release adds Node 20 alongside 22 (matrix on the
  `release-verify` job only). A Windows leg runs **only** `pnpm test`
  (T-fast projects) + `test:quickstart`, in T-canary — full e2e on Windows CI
  is a time sink with low marginal signal for a Nitro-server library.
- **R-7 — Flake policy.** A blocking-tier test that fails then passes on
  retry gets an issue within 24h and is fixed or demoted to T-canary within
  one week. No `retry:` config in blocking tiers — retries hide the bugs this
  harness exists to catch (e.g. the server-readiness race, C-2).
- **R-8 — No new fixture apps.** Every phase below reuses the 7 existing
  playgrounds plus `test/fixtures/quickstart`. A new playground requires a
  capability that no existing fixture can express (record justification in §9).
- **R-9 — robots.txt.** Covered by asserting the artifact in the `generate`
  lane for `ginko-i18n` only (where sitemap linkage matters); no dedicated
  fixture, no dedicated test file.
- **R-10 — Link integrity scope.** Internal `href`/`src` only (same-origin,
  root-relative). External URLs are never fetched (network flake, CI time).
  Anchors (`#fragment`) are checked for file existence only, not fragment
  presence, in the first iteration.
- **R-11 — Canary must attribute, not just detect.** A red canary that says
  "something in the latest ecosystem broke us" still costs a human bisect.
  The canary is a matrix: one leg per high-risk dep bumped **alone** to
  latest, one all-latest leg (catches version interactions), one
  **min-peers** leg installing the declared peer minimums (`nuxt@4.4.7`,
  `vue@3.5.0`, lowest satisfying `pagefind`/`vitest`). The min-peers leg is
  mandatory because the nuxt peer range is open-ended (`>=4.4.7`): without
  it, nothing stops the library from silently starting to require APIs newer
  than the range promises. One issue per failing dep.
- **R-12 — Renovate PRs are the first line of defense.** Each Renovate PR
  already runs the full T-pr `verify` — that is per-dep compatibility
  testing for free. High-risk deps (`nuxt`, `@nuxtjs/i18n`, `comark`,
  `pagefind`, `@nuxt/test-utils`, `vitest`, `@nuxt/module-builder`) must
  never be grouped into shared Renovate PRs; one dep per PR keeps
  attribution intact. The scheduled canary exists for what Renovate cannot
  see: consumers install through the open peer ranges, not our pinned
  lockfile.
- **R-13 — The harness runner is a thin orchestrator, never a layer of
  truth.** It wraps the existing pnpm scripts; it never replaces them. Exit
  codes pass through unmodified. Raw logs are written to disk untouched.
  Its JSON/markdown outputs are additive reporting. The pnpm scripts remain
  directly runnable and remain what CI's correctness depends on — if the
  runner breaks, the fallback is "run the pnpm script", not "fix the
  framework first".
- **R-14 — Scope reduction is a local-only privilege.** The escalation
  ladder and any changed-path selection exist to make iteration cheap for
  agents and humans. Blocking CI tiers always execute their full tier —
  path-based selection cannot see transitive impact (a `core/query` change
  can break sitemap output three layers away).

---

## 5. Phases and tasks

### Phase T0 — Close the process loop (zero code, do first)

- **T0-1** Run `pnpm run release:verify` locally end-to-end; record result,
  wall time, and per-step timings in §9 and in
  `release-hardening-playbook.md` §14. *Gate:* green run recorded.
- **T0-2** Add a "Release gate" section to `MAINTAINING.md`: a tag may only
  be cut from a commit whose `release-verify` CI job (or a recorded local
  run) is green; link this RFC. *Gate:* `pnpm docs-drift` passes.
- **T0-3** Record baseline wall-time budget per tier in §8 from the T0-1
  timings (these numbers are the regression baseline for R-5).

### Phase T1 — The `generate` lane (closes gap #1, the biggest blind spot)

- **T1-1** Extend `test/helpers/production-fixture.ts` with
  `generateStaticFixture(rootDir, env)`: runs `pnpm exec nuxi generate`
  (instead of `nuxi build`), returns `{ rootDir, publicDir: '.output/public' }`.
  Must reuse the same env-keyed cache map but with a distinct key component
  (`::generate`) so a `generate` result is never served for a `build` request
  or vice versa (see cornerstone C-1). *Gate:* new helper unit-covered for
  cache-key separation.
- **T1-2** New `test/e2e/generate-output.test.ts`: run the generate lane for
  `ginko-basic` and `ginko-i18n` (R-1); reuse the existing
  `generated-artifacts.ts` assertions (HTML presence + content, sitemaps with
  hreflang, `llms*.txt`, raw markdown, search index) and the three sweeps
  (local origins, doubled locale prefixes, private leaks). Additionally
  assert `robots.txt` exists and references the sitemap for `ginko-i18n`
  (R-9). *Gate:* both-directions proof — temporarily mark a private doc
  public in the fixture, watch the leak sweep fail on the generate output.
- **T1-3** Verify the sitemap-assert module's `mode: 'generate'` hook
  actually fires during T1-2 (it must run `shouldRunSitemapAssertionOnPrerenderedSitemaps`,
  not the `build` path). Assert via its log line or an env-var-driven marker.
  This converts `test/contracts/sitemap-assert-contracts.test.ts` from
  synthetic-only into corroborated-by-real-run. *Gate:* proof recorded in §9.
- **T1-4** Wire `test:generate:static` script into `release:verify` (after
  `test:sitemap:static`). *Gate:* T-release budget check (§8) still ≤ 90 min.

### Phase T2 — Route manifests + link integrity (closes gaps #3, #4, #6)

- **T2-1** `test/helpers/route-manifest.ts`: build a normalized manifest from
  `.output/public` — sorted relative paths, with hash-named assets collapsed
  per R-3 (e.g. `_nuxt/<hash>.js` → excluded; `pagefind/` → single presence
  marker). Pure function over a file list; unit-test the normalization with
  synthetic lists including tricky cases (`_payload.json`, nested locale
  dirs, `200.html`/`404.html`).
- **T2-2** Commit golden manifests under `test/golden/routes/<fixture>.txt`
  for: `ginko-basic` (build), `ginko-i18n` (build), `ginko-basic` (generate),
  `ginko-i18n` (generate), `ginko-search-i18n` (build). Assert equality in
  the corresponding e2e tests. Add `pnpm golden:update` to regenerate (script
  must print a loud "review this diff" banner). *Gate:* both directions —
  delete one content file in a fixture, watch the manifest test fail with a
  readable diff naming the missing route.
- **T2-3** `test/helpers/link-integrity.ts`: for every generated `.html`,
  extract root-relative `href`/`src` values (R-10) and assert each resolves
  to an emitted file (`x.html`, `x/index.html`, or exact asset path) or a
  route present in the sitemap. Run it inside `generated-output-smoke.test.ts`,
  `generate-output.test.ts`, and replace the `undefined`-grep core of
  `scripts/docs-build-smoke.mjs` with it (keep the `undefined` grep too — it
  catches template bugs before links form). *Gate:* both directions — inject
  a dead link into a fixture page, watch it fail with file + href in the
  message.
- **T2-4** Positive controls for the three leak sweeps (principle P-2): a
  test that feeds `assertNoLocalOrigins` / `assertNoRepeatedLocalePrefixes` /
  `assertNoPrivateContentLeaks` a synthetic artifact containing each
  forbidden pattern and asserts they throw — plus a fixture-side control
  asserting the private docs ("Draft Roadmap", "Internal Note") **still
  exist in the fixture content sources**, so the sweep can't silently pass
  because someone renamed the fixture files (cornerstone C-4). *Gate:* green,
  plus intentional-rename experiment recorded in §9.

### Phase T3 — Broader browser confidence (closes gap #7)

- **T3-1** `test/browser-e2e/hydration-crawl.test.ts`: reuse the existing
  Playwright plumbing from `locale-search.test.ts`; for `ginko-basic` and
  `ginko-i18n`, visit every route listed in the fixture's sitemap (cap: 40
  pages/fixture, deterministic order), asserting per page: zero console
  errors, zero failed same-origin requests, no Vue hydration-mismatch
  warnings. Keep the existing locale-search interaction test untouched.
  *Gate:* both directions — introduce a deliberate hydration mismatch in a
  fixture component, watch the crawl fail naming the route.
- **T3-2** Stays in T-release (chromium already provisioned there). Confirm
  budget in §8.

### Phase T4 — Dependency canary with attribution (closes gap #2)

Design goal per R-11: a red canary names the dep that broke us, without a
human (or agent) bisecting after the fact.

- **T4-1** `scripts/deps-canary-bump.mjs`: takes one mode — `--dep <name>`
  (bump exactly one high-risk dep to latest), `--all-latest`, or
  `--min-peers` (install declared peer minimums, see R-11) — edits the
  workspace manifests accordingly and prints the resulting version diff as
  JSON to stdout. High-risk allowlist lives in this script (R-12 list).
  *Gate:* unit test against a fixture package.json; diff output stable.
- **T4-2** `.github/workflows/deps-canary.yml`: weekly `schedule` +
  `workflow_dispatch`; ubuntu, Node 22; matrix legs = one `--dep <name>` per
  high-risk dep + `--all-latest` + `--min-peers`, each running
  `pnpm install --no-frozen-lockfile` → `pnpm run release:verify`.
  Attribution reading: single-dep leg red → that dep; only all-latest red →
  version interaction; min-peers red → we outgrew our own peer range.
  *Gate:* green dispatch run recorded in §9.
- **T4-3** On failure: create-or-update **one issue per failing dep**
  labeled `deps-canary`, containing the version diff (from→to), the failing
  `release:verify` step, the last ~100 log lines, and a link to the dep's
  release notes (R-4: never blocks anything). *Gate:* intentionally-broken
  bump in a branch produces an issue containing all four elements.
- **T4-4** Feed green canary runs into the compatibility story: extend
  `scripts/generate-compatibility.mjs` so the `meta/` compatibility data can
  record "verified against `<dep>@<version>` on `<date>`" from canary
  results, and `check:compatibility-matrix` rejects claims no green run ever
  demonstrated. Claims become evidence-backed instead of aspirational.
  *Gate:* `compatibility:check` + `docs-drift` green.
- **T4-5** Renovate config (R-12): add `packageRules` to `renovate.json`
  giving each high-risk dep its own ungrouped PR (the inherited
  `nuxt/renovate-config-nuxt` preset groups some of them). *Gate:* rules in
  place; next Renovate cycle produces individual PRs for high-risk deps.
- **T4-6** Windows leg (R-6): same workflow, `windows-latest`, **pinned**
  deps (no bump), running only `pnpm test` + `pnpm test:quickstart`. *Gate:*
  green dispatch run.

### Phase T5 — Matrix widening on the release gate (closes gap #5)

- **T5-1** `release-verify` job: `strategy.matrix.node-version: [20, 22]`.
  Chromium/browser steps run on 22 only (guard with `if:`) to keep budget.
  *Gate:* both legs green on a dispatch run; wall time recorded.
- **T5-2** Document the supported matrix (Node 20/22, ubuntu; Windows =
  canary-only, best-effort) in `README.md` + `MAINTAINING.md`. *Gate:*
  docs-drift green.

### Phase T6 — PR-tier rebalance + budget guardrails (the sweet spot)

- **T6-1** Promote exactly one output check into T-pr (R-5):
  `test:sitemap:static` for `ginko-i18n` only (the build is already cached by
  the e2e project inside `verify`, so marginal cost ≈ assertion time). *Gate:*
  `verify` CI wall time delta < 3 min vs T0-3 baseline.
- **T6-2** Emit per-step timing from `release:verify` (simple `time -p` style
  wrapper or a `scripts/timed-run.mjs`) and append to the CI job summary, so
  budget regressions (§8) are visible without archaeology. *Gate:* summary
  visible on a dispatch run.
- **T6-3** Add the flake ledger: `meta/flake-log.md`, append-only, one line
  per blocking-tier retry-passed failure (date, test, issue link) per R-7.
  *Gate:* file exists, referenced from MAINTAINING.md.

### Phase T7 — Harness runner + agentic experience

Motivation: `pnpm verify` runs 15+ minutes and prints thousands of lines.
Agents and humans both need (a) cheap targeted iteration, (b) small
structured stdout with full logs on disk, (c) failure output that makes the
next action obvious. Per R-13 this is a thin orchestrator, not a framework.

- **T7-1** `scripts/harness.mjs` (single file, target ≤ ~400 lines, zero new
  dependencies): `node scripts/harness.mjs <tier|step ...>` where tiers map
  to §2 (`fast`, `pr`, `release`) and steps are existing pnpm script names.
  Behavior: runs steps sequentially; stdout is **one line per step**
  (`✓ test:e2e 6m12s` / `✗ docs:smoke 0m41s → .test-results/<run>/docs-smoke.log`);
  full raw stdout+stderr streamed byte-for-byte to
  `.test-results/<run-id>/<step>.log`; writes `summary.json` entries
  `{ step, tier, status, durationMs, logFile, failureReport? }`; process
  exit code = first failing step's exit code, unmodified (R-13, C-16).
  `.test-results/` is gitignored. *Gate:* both directions — a forced red
  step yields the right exit code, the one-line stdout, and the full log on
  disk.
- **T7-2** Failure elevation for LLMs: on step failure the runner writes
  `.test-results/<run-id>/<step>.failure.md` containing exactly five
  elements: (1) the exact command and exit code, (2) the last ~80 lines of
  output, (3) every vitest `FAIL` block and assertion diff found in the log
  (grep-level extraction, never format parsing — C-16), (4) paths to the
  artifacts under test when derivable from the step name (e.g. the
  fixture's `.output/public`), and (5) the **narrowest rerun command**
  (e.g. `pnpm vitest run --project e2e test/e2e/sitemap-static.test.ts`).
  An agent reading only this file can reproduce cheaply and inspect the real
  artifact. *Gate:* a real forced failure produces a report with all five
  elements.
- **T7-3** Escalation ladder, documented in `AGENTS.md`: a decision table
  mapping change location → cheapest sufficient check, e.g.
  `core/query/**` → `pnpm vitest run --project unit --project
  contracts-node`; `runtime/server/**` → that plus one targeted e2e file;
  `playground/**` or fixture content → only the affected fixture's e2e
  file; `docs/**` → `docs:build` + `docs:smoke`; packaging/exports →
  `test:package-consumer`. Ladder rule: iterate on the cheapest red check
  until green, escalate one rung, and run the full T-pr tier **exactly
  once** before handing off or opening a PR (R-14 — never skip in CI).
  *Gate:* table exists; every row's command verified runnable.
- **T7-4** Per-fixture e2e filtering: add convenience scripts
  (`test:e2e:i18n`, `test:e2e:basic`, `test:e2e:search`, `test:e2e:agent`)
  that run a single e2e file via vitest path filter, leaning on the fixture
  build cache (C-1) so warm reruns of assertion-only changes take seconds,
  not a rebuild. *Gate:* filtered cold/warm wall times recorded in §9
  (expect 2–5 min cold, seconds warm).
- **T7-5** CI integration, reporting only (supersedes T6-2's ad-hoc timing
  wrapper): the `release-verify` job may run through the runner to publish
  `summary.json` as a per-step table in the GitHub job summary — but every
  step remains an ordinary pnpm script, and a runner bug must fail the job,
  never mask a red step (R-13). *Gate:* per-step table visible on a
  dispatch run.

### Phase T8 — Explicitly deferred (do NOT do now)

Visual regression, mutation testing, coverage gates, perf testing, exhaustive
OS matrix, fuzzing the markdown parser (revisit if a parser CVE-class bug
ever escapes), multi-nuxt-version compatibility matrix beyond what
`check:compatibility-matrix` already pins. Each requires a concrete escaped
regression as its admission ticket; record the trigger in §9 if one occurs.

---

## 6. Gates

| Gate | Command | When |
|---|---|---|
| G-fast | `pnpm typecheck && pnpm test` | after every task |
| G-lint | `pnpm lint` | before every commit |
| G-e2e | `pnpm test:e2e` | after any change under `test/e2e/`, `test/helpers/`, `playground/` |
| G-release | `pnpm run release:verify` | end of every phase T1–T6 |
| G-budget | compare wall time vs §8 baseline | end of every phase T1–T6 |

Both-directions proof (break → red, fix → green) is mandatory for every new
check and recorded in §9. One task = one commit,
`test|chore|ci(scope): summary [TH-<task-id>]`.

---

## 7. Cornerstones — code that is easy to get wrong

These are the load-bearing pieces. When touching them (or reviewing an
agent's change to them), check the listed failure mode explicitly.

- **C-1 — Fixture build cache keying** —
  `test/helpers/production-fixture.ts` (`fixtureBuildKey`,
  `currentBuildKeyByFixture`). The cache key is `rootDir + sorted env`. Two
  traps: (a) a test that forgets to pass a distinguishing env var silently
  reuses another test's build (e.g. search-matrix scenarios differ **only**
  by `CONTENT_SEARCH_ENGINE` — drop the var, get the wrong artifact and a
  green-but-meaningless test); (b) the T1 generate lane MUST extend the key
  (`::generate`) or generate/build results will cross-contaminate. Also note
  `currentBuildKeyByFixture` means the same fixture dir is rebuilt when env
  changes back and forth — order tests by fixture+env to avoid rebuild
  thrash, and never run two env-variants of one fixture interleaved.
- **C-2 — Server readiness probe** — `production-fixture.ts:169-187`. Boot
  is detected by polling `/` until the response no longer contains
  `__NUXT_LOADING__`. If Nuxt renames that marker, or a fixture's `/` route
  becomes a redirect (probe uses `redirect: 'manual'` and only accepts
  `ok || 404`), every e2e test times out at 200×100 ms with a misleading
  "timed out" error. When boot behavior changes upstream, look here first.
- **C-3 — `maxWorkers: 1` + `fileParallelism: false`** on the `e2e` and
  `browser-e2e` projects (`vitest.config.ts`). This serialization is what
  makes C-1's module-level cache maps safe. Parallelizing e2e for speed
  without moving the cache to per-worker or on-disk keying will produce
  port collisions and cross-test build reuse. Do not flip these flags casually.
- **C-4 — Leak sweeps are only as good as the fixture bait** —
  `test/helpers/generated-artifacts.ts` (`assertNoPrivateContentLeaks`,
  `assertNoLocalOrigins`, `assertNoRepeatedLocalePrefixes`). These greps pass
  vacuously if: the private fixture docs get renamed/deleted (nothing left to
  leak), the forbidden-term strings drift from the fixture content, or the
  locale list passed to the prefix check doesn't match the fixture's actual
  locales. T2-4 adds the positive controls; keep them in lockstep with any
  fixture content edit.
- **C-5 — Text-artifact pattern** — `generated-artifacts.ts`
  (`textArtifactPattern = /\.(?:html|xml|json|txt|md)$/`). A new artifact
  type (e.g. `.rss`, `.webmanifest`, `.yaml` exports) is silently **excluded
  from every sweep** until this pattern grows. When the module starts
  emitting a new artifact kind, extend the pattern in the same PR.
- **C-6 — sitemap-assert mode selection** — sitemap-assert module +
  `test/contracts/sitemap-assert-contracts.test.ts`
  (`shouldRunSitemapAssertionOnPrerenderedSitemaps` for `generate` vs
  `...OnCompiled` for `build`). Two code paths, historically only the `build`
  path exercised for real. After T1-3, both are; if the hook wiring changes,
  re-prove the generate path fires (don't trust the unit test alone — it uses
  synthetic temp dirs).
- **C-7 — Query wire version + lowering** — `core/query/lower.ts`,
  `runtime/server/providers/index.ts` (`PROVIDER_QUERY_VERSION` check),
  `core/query/execute.ts` `default:` throws. The tagged
  `{ type: 'regex', source, flags }` PlanRegex, Date→ISO lowering, and the
  regex-flags whitelist (`imsu`) are the product of the 0.2.0 hardening; any
  "simplification" of the lowering walker that reintroduces raw `RegExp`/
  `Date` objects in the wire format regresses silently on same-process
  providers and only explodes on serialized ones. Guarded by
  `test/contracts/query-*` + `vnext-golden-demo.test.ts` — keep those in the
  blocking tier forever.
- **C-8 — Reserved-key stripping** — `parsers/reserved.ts`
  (`RESERVED_CONTENT_KEYS`, `stripReservedContentKeys`) wired into all three
  parsers. Adding a new document-level computed field without adding it to
  the reserved list lets user frontmatter shadow module internals; the `_dir`
  leak was exactly this class. Any new computed field ⇒ same-PR reserved-list
  entry + contract test.
- **C-9 — Package exports map ↔ declarations ↔ packed reality** —
  `package.json` exports, `module/runtime-assets.ts`,
  `test/contracts/package-exports-contracts.test.ts`,
  `scripts/{release-pack,test-packed-consumer}.mjs`. Three sources of truth
  that must agree; the contract test checks the map, but only the **packed
  consumer** proves resolution from outside the workspace (workspace root
  `node_modules` hides missing-file bugs). Never mark a subpath "done"
  without a green `test:package-consumer`.
- **C-10 — `workspace:*` leakage** — both packaging scripts assert the
  tarball has no `workspace:` ranges. This check lives in two scripts; if
  packaging is ever refactored, keep exactly one canonical implementation and
  call it from both (drift here = published broken manifest).
- **C-11 — Pagefind static asset emission** — search-matrix scenario 2
  asserts `pagefind/pagefind.js` exists in `.output/public` **and** is served
  with a JS content type. Pagefind is an optional peer that runs as a
  postbuild step; a nitro/hook ordering change can silently skip emission
  while the API still answers. The on-disk assertion is the real guard —
  don't replace it with an HTTP-only check.
- **C-12 — Path traversal guards** — raw-markdown routes,
  `test/e2e/agent-markdown-negotiation.test.ts` (encoded `../`, null byte →
  400, repeated-slash normalization). Security-relevant; these tests must
  never be weakened for convenience, and any new file-serving route (e.g. a
  future `/llms/<collection>.txt`) needs the same traversal cases copied over.
- **C-13 — Browser-e2e zero-error assertions** —
  `test/browser-e2e/locale-search.test.ts` asserts **zero** console errors /
  failed content requests / hydration warnings. The temptation under upstream
  noise (a nuxt devtools warning, a favicon 404) is to allowlist patterns;
  every allowlist entry is a place real hydration bugs hide. Fix the fixture
  instead; if an allowlist is unavoidable, it must be exact-match strings
  with a comment naming the upstream issue.
- **C-14 — Golden manifests vs. hashed assets (after T2)** — the R-3
  normalization is the fragile point: too aggressive and route regressions
  hide inside collapsed patterns; too literal and every dep bump churns the
  golden file until reviewers stop reading the diff (which is how golden
  files die). Normalization changes require re-running the T2-2
  both-directions proof.
- **C-15 — i18n fallback + hreflang pairing** — `prod-smoke.test.ts`
  (`/de/guide/advanced` → `"fallback": true`) and `sitemap-artifacts.ts`
  hreflang assertions. Locale fallback pages must appear in sitemaps with
  correct alternates but must NOT double-prefix (`/de/de/`) or leak the
  fallback locale's origin. These three properties are asserted in three
  different files; a locale-resolution change must be checked against all
  three, not just the one that fails first.
- **C-16 — The harness runner must be un-clever** — `scripts/harness.mjs`
  (after T7). Three invariants: exit codes pass through unmodified (one
  swallowed promise rejection or `|| true` here turns the entire gate
  green); raw `.log` files are byte-for-byte — truncation and filtering
  belong only in the `.failure.md` excerpt; failure-report extraction is
  grep-level, never a parser for vitest's output format (reporter formats
  change across vitest majors — exactly the dep-drift class this harness
  guards against). And if the runner itself crashes, the run reports
  failure — never success-by-default.
- **C-17 — Scope reduction is local-only** — the escalation ladder (T7-3)
  and per-fixture filters (T7-4) exist for iteration speed. Blocking CI
  tiers always run their full tier (R-14). Path-based selection cannot see
  transitive impact; a skipped-in-CI check is a hole, not an optimization.
  Watch for this especially in agent-authored CI edits — "make CI faster by
  skipping unrelated tests" is a plausible-sounding regression.
- **C-18 — Canary bump script edits manifests, not the lockfile** —
  `scripts/deps-canary-bump.mjs` (after T4) must change package.json ranges
  and let `pnpm install --no-frozen-lockfile` do resolution. Hand-editing
  `pnpm-lock.yaml`, or running the bump against a dirty tree, produces
  resolution states no consumer can reach — a canary that tests a fiction.
  The bump runs only in the throwaway CI checkout, never lands in a commit.
---

## 8. Wall-time budgets (fill baseline in T0-3)

| Tier / job | Baseline (T0-3) | Ceiling | Action on breach |
|---|---|---|---|
| pr-e2e-smoke | 34s (2026-07-09, standalone timed run, see §9 TH-T0-3) | 3 min | trim or fix cache |
| verify (T-pr) | 20m1s (2026-07-09, sub-segment of T0-1 release:verify run, see §9 TH-T0-1) | 45 min | R-5: newest addition out first |
| release-verify (T-release) | 25m3s (2026-07-09, T0-1 full run, see §9 TH-T0-1) | 90 min | move newest check to T-canary |
| deps-canary | — (Phase T4 not implemented yet) | 90 min | reduce dep allowlist |

---

## 9. Status Log (append-only)

> Format: `- YYYY-MM-DD — [TH-task] summary; gates: …; proofs: …; deviations: …`

- 2026-07-09 — RFC drafted from verified repo state (see §1). No tasks executed yet.
- 2026-07-09 — [TH-process] Approved deviation recorded: full `release:verify`
  (G-release) is not run at the end of every phase T1–T6 as §6 literally
  states; it runs at consolidated checkpoints handled by dedicated checkpoint
  agents, to protect limited local compute on this machine. G-fast/G-lint/
  G-e2e still run per task. This deviation was pre-approved by the maintainer
  for the whole phased rollout, not just T0.
- 2026-07-09 — [TH-T0-1] Ran `pnpm run release:verify` end-to-end locally,
  detached with per-line-timestamped log at `/tmp/th-logs/release-verify-t0-1.log`
  (start 2026-07-09T17:49:04Z, end 2026-07-09T18:14:07Z, exit=0). **Total wall
  time: 25m 3s (1503s).** Per-step timings derived from log timestamps (script
  has no built-in per-step timer; T6-2 will add one):
  `compatibility:check` 0s, `docs-drift` 1s, `verify` total 20m1s (1201s) of
  which: `dev:prepare` 29s, `lint`(+`check:repo-policies`+
  `check:compatibility-matrix`) 8s, `build:packages` 22s, `docs:build` 117s,
  `docs:smoke` 0s, `examples:build` 584s (largest single step — 12 example
  apps built serially), `typecheck:examples` 7s, `test` 37s, `test:e2e` 329s,
  `typecheck` 30s, `test:quickstart` 38s; then (outside `verify`)
  `test:package-consumer` 76s, `test:e2e:browser` 48s, `test:search:matrix`
  80s, `test:sitemap:static` 54s, `audit:prod` 1s, `release:pack` 41s. Gates:
  the run itself *is* the gate (G-release), exit=0, all steps green, no
  retries. Proof: this is a positive (green) run; no both-directions proof
  applicable to T0-1 (it records an existing gate's baseline, does not add a
  new check). Deviations: none — adopted the in-flight run per the resume
  instructions rather than starting a second one (machine constraint: never
  run two test suites concurrently).
- 2026-07-09 — [TH-T0-2] Added "Release gate" section to `MAINTAINING.md`
  (between "Daily Maintenance" and "Release Runbook"): states a tag may only
  be cut from a green `release-verify` CI job or a recorded-green local
  `pnpm run release:verify` run, points at this RFC §9 for the record and at
  the four-tier strategy in §2. Gate: `pnpm docs-drift` green (see command
  output in task log). Proof: N/A (doc-only addition, not a new automated
  check — nothing to break/fix).
- 2026-07-09 — [TH-T0-3] Filled §8 baseline wall-time table from the T0-1
  run. `release-verify` baseline 25m3s taken directly from the T0-1 log
  (well under the 90 min ceiling). `verify (T-pr)` baseline 20m1s taken from
  the `verify` sub-segment inside the same T0-1 run (release:verify's script
  body is `compatibility:check && docs-drift && verify && ...`, so the
  `verify` step is byte-identical to what CI's `verify` job runs — no
  redundant rerun needed). `pr-e2e-smoke` is a separate, deliberately slim
  script (`scripts/pr-e2e-smoke.mjs`) not invoked anywhere inside
  `release:verify`, so it was run standalone (cheap, targeted, matches its
  own <3 min design budget) with a timestamped log at
  `/tmp/th-logs/pr-e2e-smoke-t0-3.log`: start 18:14:56Z, end 18:15:30Z,
  **34.2s wall time** (`real 0m34.229s` per the script's own `time` wrapper),
  exit=0, all three route assertions passed. `deps-canary` baseline left as
  `—` (Phase T4 not implemented yet; no runnable job exists to time). Gates:
  G-fast + G-lint green (no code changed, doc-only table fill). Proof: N/A
  (baseline recording, not a new check).
- 2026-07-09 — [TH-T1-1] Extended `test/helpers/production-fixture.ts` with
  `generateStaticFixture(rootDir, env)`: runs `pnpm exec nuxi generate`,
  reuses the same env-keyed `buildPromises`/`currentBuildKeyByFixture` maps as
  `buildProductionFixture` (C-1) via a shared internal `runFixtureBuildCommand`,
  but the cache key now carries an explicit `mode` component — exported
  `fixtureBuildKey(rootDir, env, mode = 'build')` appends `::generate` only
  for the generate mode, so `generate` and `build` requests for the same
  rootDir+env never collide. Also captures raw command stdout on the build
  result (`stdout` field) to support T1-3's log-line corroboration. New
  `test/unit/production-fixture-cache-key.test.ts` (5 cases) covers: build
  vs. generate keys differ; default mode is `build`; generate key changes
  with env; no cross-fixture collision; env key ordering is normalized.
  Gates: G-fast green (`pnpm typecheck && pnpm test`: 81 files / 630 tests
  passed), G-lint green (`pnpm lint`: repo-policies + compatibility-matrix +
  eslint all passed). G-e2e deferred to run once, together with T1-2's new
  e2e file, per the "generate runs are expensive, run once per fixture"
  instruction. Proof: both-directions is implicit in the unit test itself
  (assertions would fail red if the `::generate` component were removed —
  verified manually by temporarily reverting the mode component and
  observing `production fixture cache key (C-1) > build and generate keys
  differ for identical rootDir + env` fail, then restoring it and observing
  green); the fixture-level both-directions proof for T1-2 covers the
  higher-value end-to-end case. Deviations: none.
- 2026-07-09 — [TH-T1-2][TH-T1-3] Added `test/e2e/generate-output.test.ts`:
  runs `generateStaticFixture` (real `nuxi generate`) for `playground/ginko-basic`
  and `playground/ginko-i18n` (R-1), reusing `generated-artifacts.ts`
  assertions (HTML presence/content, sitemap hreflang, `llms*.txt`, raw
  markdown, search index) and the leak sweeps (`assertNoLocalOrigins`,
  `assertNoRepeatedLocalePrefixes` for i18n only — ginko-basic has no
  locales to double, see C-4 — `assertNoPrivateContentLeaks`). Added
  `playground/ginko-i18n/public/robots.txt` (static asset, copied verbatim
  by both `nuxi build`/`nuxi generate`) and asserted it references
  `sitemap_index.xml` (R-9; no dedicated fixture/test file). Discovered and
  fixed a real bug while wiring T1-3's corroboration: `playground/ginko-i18n/nuxt.config.ts`'s
  `content.sitemap.assert` block used non-existent `routes`/`forbidden` keys
  with `enabled` left at its `false` default, so the sitemap-assert hook had
  **never** actually run for this fixture despite looking configured —
  exactly the RFC gap #1 blind spot. Renamed to the real
  `requiredPaths`/`forbiddenPathPrefixes` keys and set `enabled: true`.
  generate-output.test.ts now asserts the captured `nuxi generate` stdout
  contains the sitemap-assert pass log line
  (`Content sitemap assertion passed for 2 sitemaps.`), corroborating that
  `shouldRunSitemapAssertionOnPrerenderedSitemaps` (the `generate` path, C-6)
  fired for real, not `shouldRunSitemapAssertionOnCompiled` (the `build`
  path) — converting `sitemap-assert-contracts.test.ts` from synthetic-only
  into corroborated-by-a-real-run. Getting that corroboration working
  surfaced a second bug: Vitest sets `TEST`/`VITEST`/`VITEST_WORKER_ID` on its
  own process env; `production-fixture.ts` was forwarding that whole env to
  the spawned `nuxi build`/`nuxi generate` child, so std-env's `isTest`
  became true *inside the child*, silencing its logger's info-level output
  (the very log line being asserted on) even though the build itself
  completed and wrote correct output to disk. Fixed by stripping those
  markers before spawning (`buildFixtureChildEnv`). Gates: G-fast green
  (`pnpm typecheck && pnpm test`: 81 files / 630 tests), G-lint green
  (fixed one `@typescript-eslint/no-dynamic-delete` finding along the way),
  G-e2e green (`pnpm test:e2e`: 7 files / 16 tests, 365.75s, includes the new
  file plus every existing e2e file that touches `playground/ginko-i18n` or
  `test/helpers/production-fixture.ts`). Proof (both directions, T1-2): with
  `sitemap.assert.enabled` temporarily left at the fixed `true`, renamed
  `content/en/1.guide/3.draft-roadmap.draft.md` → `.md` **and**
  `content/de/1.leitfaden/3.entwurf.draft.md` → `.md` (both locales
  together — renaming only one broke the build earlier via a translated-slug
  pairing error, an unrelated failure mode, not the leak sweep) → watched
  the run go red via the sitemap-assert build-time check itself
  (`Content sitemap assertion failed: - Forbidden sitemap paths found:
  /guide/draft-roadmap, /de/leitfaden/entwurf`). To isolate proof of the
  `test/e2e/generate-output.test.ts`-level leak sweep specifically (as
  distinct from the sitemap-assert hook), additionally set
  `sitemap.assert.enabled: false` with the same public content and reran:
  watched `expect(JSON.stringify(searchIndex)).not.toContain('Draft Roadmap')`
  fail with the leaked title inline in the received search-index JSON.
  Reverted both files (`git mv` back to `.draft.md`) and `enabled: true`;
  reran `test:generate:static` for both fixtures — green
  (`/tmp/th-logs/t1-2-final-green.log`, 42.73s, 2/2 passed). Deviations:
  none beyond the two bugfixes described above, which were necessary to make
  the corroboration meaningful rather than a workaround.
- 2026-07-09 — [TH-T1-4] Added `test:generate:static` script
  (`pnpm vitest run --config vitest.config.ts --project e2e test/e2e/generate-output.test.ts`)
  and chained it into `release:verify` immediately after `test:sitemap:static`.
  Per the checkpoint-agent deviation (recorded above), did not run the full
  `release:verify`; ran `pnpm test:generate:static` standalone instead —
  green, exit=0, 2/2 tests passed, 45.54s wall time
  (`/tmp/th-logs/t1-4-test-generate-static.log`). That addition is well
  inside the 90 min T-release ceiling (§8) even added on top of the 25m3s
  T0-1 baseline; full-run budget confirmation deferred to the next
  checkpoint agent's `release:verify` run. Gates: G-fast, G-lint green
  (script-only change; `pnpm run check:repo-policies` — which validates
  `package.json` script wiring — passed as part of `pnpm lint`). Proof: N/A
  (wiring an already-proven-green script into an aggregate command is not
  itself a new check).

---

## 10. Definition of Done

- [x] T0: green `release:verify` recorded; MAINTAINING.md gate documented; budgets baselined
- [x] T1: generate lane green for ginko-basic + ginko-i18n; `mode: 'generate'` sitemap hook proven live; robots.txt asserted
- [ ] T2: golden route manifests committed + both-directions proven; link integrity in fixtures + docs; leak-sweep positive controls in place
- [ ] T3: hydration crawl over sitemap routes green for basic + i18n
- [ ] T4: canary attribution matrix (per-dep, all-latest, min-peers) dispatched green; failure path files per-dep issues with version diff + release-notes link; compatibility matrix fed from canary results; high-risk Renovate PRs ungrouped; Windows leg green
- [ ] T5: release-verify green on Node 20 and 22; supported matrix documented
- [ ] T6: sitemap-static promoted to T-pr within budget; step timings in CI summary; flake ledger exists
- [ ] T7: harness runner proven both directions (exit codes, logs, summary.json); failure reports contain the five elements incl. narrowest rerun command; escalation ladder in AGENTS.md with verified commands; per-fixture e2e cold/warm timings recorded
- [ ] All new checks have recorded both-directions proofs in §9
- [ ] §8 budgets hold on the final full run
