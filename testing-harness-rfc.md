# RFC: Release-Confidence Harness for `@lupinum/ginko-content`

> **Status:** Adopted direction; implementation in progress.
> **Owner:** Ginko Content maintainers.
> **Last revised:** 2026-07-09.
> **Scope:** The CMS-neutral content engine in this repository. Studio, CMS
> workflow, MCP, Convex, and host-specific release logic remain out of scope.

---

## 0. Decision

Ginko Content will use a layered release-confidence system built around real
consumer artifacts and real Nuxt production behavior.

A release is trustworthy only when the exact commit and exact npm tarball have
demonstrated all of the following:

1. The public TypeScript and provider contracts still hold.
2. Real Nuxt applications build and boot in production mode.
3. Real `nuxi generate` applications emit complete static output.
4. Routes, localized routes, sitemaps, search indexes, agent artifacts, and
   internal links match reviewed expectations.
5. Browser hydration and client navigation complete without hidden errors.
6. The packed npm artifact installs and builds outside the workspace.
7. The minimum maintained Node version and current LTS both work.
8. Supported dependency ranges remain truthful as Nuxt, Nitro, Nuxt I18n,
   Nuxt Sitemap, Comark, Pagefind, and the build toolchain move.

The harness must provide this confidence without making every local edit run a
30-minute gate. The solution is focused iteration, one complete PR gate, one
exact-SHA release gate, and narrow scheduled compatibility canaries.

This RFC replaces the earlier phase plan. Completed generate-lane work remains
valid; superseded tasks and rulings are intentionally deleted rather than kept
as competing instructions.

---

## 1. Threat model

The harness exists to catch regressions that unit tests alone cannot see.

### 1.1 Product regressions

- Query, provider, locale, navigation, search, sitemap, and agent-output
  behavior changes unintentionally.
- Draft, private, or internal content becomes publicly reachable or appears in
  search, sitemap, raw Markdown, or LLM output.
- A public export, declaration, or package subpath disappears from the packed
  package.
- Serialized provider behavior differs from same-process behavior.

### 1.2 Nuxt/Nitro integration regressions

- A Nuxt or Nitro hook changes ordering or payload shape.
- `nuxi build` succeeds but misses expected prerendered files.
- `nuxi generate` takes a different code path and silently omits routes or
  artifacts.
- Nuxt I18n changes translated route or fallback behavior.
- Nuxt Sitemap changes sitemap names, hooks, alternates, or output timing.
- Pagefind output is no longer emitted or served correctly.
- A production server starts but returns loading shells, redirects, 404s, or
  malformed APIs.

### 1.3 Dependency-drift regressions

- A fresh consumer resolves a newer allowed dependency than the lockfile and
  breaks.
- The code starts using an API newer than the declared peer minimum.
- Individually compatible dependency updates fail when combined.
- An unbounded peer range accidentally claims support for a future major.

### 1.4 Harness regressions

- A test passes without executing the intended project or fixture.
- A build cache returns output from another environment or deployment mode.
- The same expensive test runs twice under different script names.
- A negative leak sweep passes because its fixture bait disappeared.
- A golden normalizer hides a new public artifact.
- A release is tagged from a commit other than the commit that passed CI.
- A packed-consumer test validates a tarball different from the one inspected
  and released.

---

## 2. Operating principles

1. **Test the consumer-visible artifact.** Prefer emitted files, booted
   production servers, browsers, and installed tarballs over mocked framework
   internals.
2. **One source of truth.** A public expectation has one canonical definition.
   Derived manifests must be deterministic and rebuildable.
3. **One execution per expensive check.** Release may contain the PR checks,
   but the same e2e file must not be run again in a fresh process under a
   second script name.
4. **Fail closed.** Unknown stable public output, zero matched tests, missing
   fixtures, missing logs, and harness crashes are failures.
5. **Supported and experimental are different.** Supported-range failures are
   release problems. Future-major failures are advisory signals.
6. **Focused locally, complete in CI.** Humans and agents iterate on the
   narrowest relevant check. CI runs the complete tier without changed-path
   shortcuts.
7. **No retry-based confidence.** Blocking checks do not retry automatically.
   A retry-pass is a flake defect, not a green result.
8. **Negative checks need controls.** A forbidden-value sweep must prove the
   detector works and that the forbidden fixture data still exists.
9. **Mutation proof is proportional.** New failure-detection mechanisms need a
   focused automated control or one recorded break-red-fix-green proof. Script
   wiring and documentation changes do not require ceremonial mutation runs.
10. **The tag SHA is the release identity.** A local run on a dirty tree or a
    run before release metadata is committed cannot authorize a tag.

---

## 3. Current state

### 3.1 Strong foundations already present

- Unit, provider, runtime, client, Nuxt, and public-contract Vitest projects.
- Provider conformance and a golden end-to-end domain scenario.
- Real production fixture builds with environment-aware caching.
- Production-server route and API smoke tests.
- Generated HTML, sitemap, search, Markdown, and LLM artifact assertions.
- I18n fallback, translated slug, hreflang, and repeated-prefix checks.
- Search-engine matrix including Pagefind static output.
- Playwright locale/search navigation with console and hydration checks.
- Packed-consumer installation, typecheck, build, boot, declaration, and export
  checks.
- Release tarball hygiene and manual publishing safeguards.
- A real `nuxi generate` lane for `ginko-basic` and `ginko-i18n`.

### 3.2 Completed work retained from the first RFC

- **H0 — Baseline and release documentation:** completed in commits
  `51118f7`, `ee366dc`, and `f1959cf`.
- **H1 — Generate lane:** completed in commits `c84b37c`, `fc57895`,
  `85c00f6`, `c271892`, and reviewer fix `f32d84e`.
- The generate lane is isolated in its own Vitest project, so it does not run
  inside the PR e2e project.
- The generate work found and fixed a real defect: the i18n fixture's sitemap
  assertion used invalid keys and was disabled, so its real hook had never run.

The recorded local baseline was approximately:

| Segment | Local M1 baseline |
|---|---:|
| `pr-e2e-smoke` | 34s |
| `verify` | 20m 1s |
| `release:verify` before generate lane | 25m 3s |
| `examples:build` inside `verify` | 9m 44s |
| `test:e2e` inside `verify` | 5m 29s |

These are performance baselines, not durable release authorization: the run
did not record the exact commit SHA and runtime version in a CI artifact.

### 3.3 Defects in the current harness topology

These are correction work, not future enhancements:

1. `verify` already runs the full e2e project, including the search matrix and
   sitemap-static files. `release:verify` runs both files again in new Vitest
   processes.
2. On pushes to `main`, GitHub runs the PR `verify` and `pr-e2e-smoke` jobs next
   to `release-verify`, even though `release-verify` contains `verify`.
3. The release runbook permits a local run before release metadata is committed;
   that run does not prove the eventual tag SHA.
4. The packed-consumer script creates and tests its own tarball, while
   `release:pack` later creates the tarball a human inspects. The exact release
   artifact is therefore not the artifact the consumer test installed.
5. The package currently declares Node `>=20`, although Node 20 is end-of-life.
6. Nuxt and optional Vitest peer ranges are open-ended across future majors.
7. CI comments describe search and sitemap suites as release-only even though
   they already run in PR verification.

---

## 4. Target execution model

The tiers describe confidence, not duplicate commands. A more expensive tier
may contain a cheaper tier once, but no expensive file is invoked twice.

| Lane | Trigger | Target | Hard timeout | Purpose |
|---|---|---:|---:|---|
| Focused | local, every edit | usually <5m | none | Narrow feedback for the touched subsystem |
| PR smoke | every PR, parallel | <3m | 15m | Early proof that one production fixture path builds and boots |
| PR gate | every PR | <=30m | 45m | Full logic, docs/examples, type, build, and server-e2e confidence |
| Release gate | push to `main`, manual dispatch, exact tag SHA | <=40m | initially 90m | Exact artifact, generate, browser, package, audit, and release confidence |
| Minimum runtime | release workflow | <=15m | 30m | Minimum maintained Node and peer boundary |
| Supported canary | weekly | <=15m/leg | 30m/leg | Fresh latest versions inside supported ranges |
| Future canary | monthly, advisory | <=15m/leg | 30m/leg | Upcoming majors/current Node; never a support claim |

Rules:

- PR-only jobs run only for `pull_request` events.
- Pushes to `main` and manual dispatch run the release workflow, not the PR jobs
  beside it.
- The PR smoke remains a separate parallel job because it gives a useful fast
  failure while the full PR gate is still building examples.
- CI uses the complete lane. Changed-path selection is never used to skip
  blocking CI checks.
- Budgets are reviewed from CI timings, not only local timings. Two consecutive
  target breaches require a performance issue or scope decision.

---

## 5. Output contract

### 5.1 Real build and generate lanes

The release gate covers both deployment paths:

- `nuxi build` plus real Nitro production server.
- `nuxi generate` plus direct inspection of `.output/public`.

Generate remains limited to `ginko-basic` and `ginko-i18n`. Search and agent
variants keep their existing build/server coverage; duplicating every fixture
under generate would add cost without a distinct contract.

The fixture cache key includes:

- Resolved fixture directory.
- Sorted explicit environment overrides.
- Deployment mode (`build` or `generate`).

Two requests for the same fixture may not build concurrently into the same
`.output` directory. If concurrency is ever introduced, output directories or
locking must be redesigned first.

### 5.2 Golden route and named-artifact manifests

Commit two semantic goldens:

- `test/golden/routes/ginko-basic.txt`
- `test/golden/routes/ginko-i18n.txt`

Both build and generate output for a fixture compare against the same semantic
golden. A difference between build and generate is allowed only through an
explicit, reviewed exception; separate goldens are not the default.

The manifest contains:

- HTML route files.
- Sitemap indexes and child sitemaps.
- `llms*.txt`.
- Raw Markdown output.
- Search index.
- Other intentionally public, stable named artifacts.
- A single presence marker for a volatile bundle such as `pagefind/`.

The classifier has three outcomes:

1. **Stable public output:** include literally.
2. **Known volatile output:** ignore or collapse through an explicit rule.
3. **Unknown output:** fail and require a classification decision.

It must not silently drop every unfamiliar file. That would hide new public
output and create false confidence.

Golden rules:

- Normalize path separators.
- Use deterministic code-unit `.sort()`, not locale-sensitive ordering.
- Use newline-delimited text with a trailing newline.
- Regeneration is explicit through `pnpm golden:update`.
- The update command prints the files changed and tells the caller to inspect
  the diff.
- A missing content route must produce a small diff naming that route.

### 5.3 Internal-link integrity

For generated static output, every same-origin link or resource reference must
resolve to emitted output. A sitemap entry is not a substitute for an emitted
file; accepting it could hide a missing-prerender defect.

The checker covers:

- Root-relative and document-relative `href` and `src` values.
- Query and fragment removal for file resolution.
- `/x`, `/x/`, `/x.html`, and `/x/index.html` normalization.
- Percent-encoded paths.
- HTML fragments when the target is emitted HTML: the target `id` must exist.
- Source filename, original reference, and normalized target in failures.

It does not fetch external URLs. External links receive syntax validation only.
Protocol-relative URLs, unsupported schemes, and intentionally runtime-only
paths require exact documented exceptions, never broad prefix allowlists.

The link check runs against:

- `ginko-basic` generate output.
- `ginko-i18n` generate output.
- Docs generated output.

Build/server links are corroborated by the browser/HTTP crawl rather than
pretending every server-capable route must be a static file.

### 5.4 Leak sweeps and positive controls

Keep the existing sweeps for:

- Local origins.
- Repeated locale prefixes.
- Private/draft content.

Add pure unit controls that feed a known-bad artifact to every detector and
assert that it fails. Add fixture controls that assert the draft/private source
documents and forbidden sentinel text still exist.

The fixture-side sentinel is canonical. Do not duplicate long forbidden-term
lists across multiple e2e files; export them from one test helper.

### 5.5 Sitemap semantics

Existing sitemap checks remain load-bearing:

- Required content routes.
- Private-route exclusions.
- Production origins.
- Locale child sitemaps.
- Hreflang pairs.
- Provider-owned entries.
- No doubled locale prefixes.

The real generate hook proof remains, but a logger message is corroborating
evidence rather than a public product contract. If upstream logging makes that
assertion unstable, replace it with a narrow hook-level probe; do not weaken
the generated sitemap assertions.

`robots.txt` is not a Ginko-owned output. A literal fixture file copied by Nuxt
does not count as product confidence and should be removed unless Ginko later
owns robots generation.

---

## 6. Browser confidence

Keep the existing locale/search interaction test. Add one hydration crawl over
the `ginko-i18n` production fixture.

Route source:

- Derive navigable routes from emitted HTML files after manifest validation.
- Do not depend on `ginko-basic` having a sitemap; it does not install the
  sitemap module.
- Crawl all fixture routes while the set is at most 40. If it grows beyond 40,
  introduce an explicit deterministic sampling rule that includes root,
  default locale, non-default locale, fallback, nested, and 404 behavior.

Reuse one built fixture, one server, and one browser instance for the crawl.
For every route assert:

- HTTP status below 400.
- No `pageerror`.
- No console error.
- No hydration mismatch warning.
- No failed same-origin request.
- No same-origin response with status >=400.
- The Nuxt loading shell has been replaced with rendered content.

Use `domcontentloaded` plus a concrete rendered-app readiness condition.
`networkidle` is not the general crawl readiness contract because persistent
connections and future integrations can make it hang.

The interaction test continues to cover locale switching, search result
navigation, and browser back/forward state. The crawl covers breadth; the
interaction test covers behavior.

---

## 7. Exact package-artifact confidence

The release gate must pack once and test that exact tarball.

Target flow:

1. Build the workspace package.
2. Run the canonical release packer once into `.pack/`.
3. Validate tarball contents, exports, declarations, metadata, forbidden files,
   and absence of `workspace:*` ranges.
4. Pass that tarball path to the packed-consumer test.
5. Install it in a fresh pnpm consumer, import public subpaths, prepare,
   typecheck, build, boot, and assert output.
6. Install the same tarball in a fresh npm consumer and at minimum prepare,
   typecheck, and build.
7. Leave that same tarball for human inspection and publication.

The consumer script must not silently repack when a tarball path is supplied.
PR verification may keep cheaper workspace checks; exact-artifact consumers are
release-only.

Why npm is included: the public installation docs explicitly support npm. Yarn
does not get a release lane until a Yarn-specific failure escapes or the project
commits to PnP support.

The release record includes:

- Commit SHA.
- Node and pnpm/npm versions.
- Tarball filename and SHA-256.
- Gate summary and CI run URL.

---

## 8. Dependency compatibility

### 8.1 Supported ranges are policy

Before adding canaries, make the support claim finite and testable:

- Raise Node support from `>=20` to `>=22` in a release with changelog and docs.
- Bound Nuxt to the supported major, for example `>=4.4.7 <5`.
- Bound optional Vitest compatibility to the supported major, for example
  `>=4.1.6 <5`.
- Keep Vue and Pagefind on their already bounded major ranges.
- Document supported major lines for optional Nuxt I18n and Nuxt Sitemap
  integrations.

Narrowing an already published range is user-facing. Handle it through the
normal pre-1.0 semver/changelog process rather than hiding it in test work.

`packages/content/compatibility.json` remains the source of support policy. It
must not become a historical database of weekly CI observations.

### 8.2 Renovate provides attribution

Renovate PRs are the primary per-stack compatibility mechanism because they
produce reviewable lockfile/manifests and run the PR gate.

Group only dependencies that are versioned or consumed as one compatibility
unit:

- Nuxt runtime stack: Nuxt plus directly coupled Nuxt runtime packages.
- Comark stack: `comark` and `@comark/vue` when their releases are coupled.
- Sitemap stack: `@nuxtjs/sitemap` and `nuxt-site-config` when required.
- Nuxt I18n independently.
- Pagefind independently.
- Test/build tooling independently unless an upstream compatibility constraint
  requires a group.

Do not create one giant ecosystem-update PR. Do not force tightly coupled
packages into artificial one-package states merely for attribution.

### 8.3 Scheduled canaries

The weekly canary has two focused legs:

1. **minimum-supported:** exact minimum maintained Node and declared dependency
   boundaries.
2. **latest-supported:** fresh latest versions inside every supported major
   range, including their combined interaction.

Each leg runs a compatibility slice, not `release:verify`:

- Fresh install without the committed lockfile controlling consumer versions.
- Package build/pack.
- Public type/import checks.
- Basic production build and boot.
- I18n production generate.
- Sitemap, localized route, search index, and Pagefind assertions relevant to
  the changed stack.

The monthly advisory canary may test upcoming major/current releases, such as
the next Nuxt major or current non-LTS Node. It never changes the support claim
and never blocks a release.

Canary reporting:

- Supported-range failure: workflow is red and creates or updates one
  `deps-canary` issue with a table of failing legs and resolved versions.
- Future failure: workflow summary and the same advisory issue; no paging and
  no release block.
- Recovery: close the issue automatically only after all supported legs are
  green; keep future warnings clearly separated.
- Upload resolved manifests/lockfiles and concise failure logs as CI artifacts.
- Never write weekly dates or results back into compatibility policy files.

`pnpm-workspace.yaml`'s 24-hour minimum release age remains in force. The canary
tests versions old enough to clear that supply-chain policy, not registry
uploads from the last few minutes.

---

## 9. Runtime and operating-system policy

Node 20 reached end-of-life on 2026-04-30 according to the
[official Node.js release schedule](https://github.com/nodejs/release#release-schedule).
The supported runtime policy is:

- **Node 22:** minimum maintained runtime; focused boundary gate.
- **Node 24:** active LTS; full PR and release gates.
- **Node 26:** current/future canary until it becomes LTS and the ecosystem is
  ready.

The Node 22 gate runs unit/contracts, quickstart, package consumer build, and at
least one real production fixture. It does not repeat browser and every example
build.

Windows remains weekly and focused:

- Node 24.
- Unit/provider/contracts.
- Quickstart prepare/typecheck/build.
- One filesystem-sensitive production fixture if the quickstart does not cover
  emitted path normalization sufficiently.

Full Windows browser/e2e is not justified without an escaped Windows-specific
integration bug. Windows failures are support failures if the package claims
Windows support; “canary” describes frequency, not permission to ignore them.

---

## 10. Agent and maintainer workflow

### 10.1 Escalation ladder

Agents and humans use the cheapest relevant command while iterating:

| Change | First check | Escalation |
|---|---|---|
| Pure helper/unit logic | Targeted Vitest file in the owning project | `pnpm test` |
| Query/provider/public contract | Targeted unit + relevant contract file | `pnpm test` |
| Nuxt module/hook/runtime | Targeted contract + affected e2e file | `pnpm test:e2e` |
| Fixture/output assertion | Affected e2e or generate project only | `pnpm test:e2e` or `pnpm test:generate:static` |
| Browser behavior | Targeted browser file | `pnpm test:e2e:browser` |
| Docs | `pnpm docs:build && pnpm docs:smoke && pnpm docs-drift` | `pnpm verify` |
| Exports/package metadata | Package contract + pack check | exact packed consumer |
| CI/workflow only | Static validation and PR-safe dry run | real post-merge dispatch/schedule observation |

Rules:

1. Reproduce with the narrowest red command.
2. Fix and rerun that command until stable.
3. Escalate once to the owning subsystem gate.
4. Run `pnpm verify` once before handoff when code or public behavior changed.
5. Do not run `release:verify` repeatedly during implementation.
6. The authoritative release gate runs in CI on the exact final SHA.

### 10.2 Focused command ergonomics

Add only useful, stable convenience scripts for recurring expensive slices,
such as generate, i18n e2e, search e2e, and browser e2e. A convenience script
must select at least one test; use `vitest list` or an automated script-policy
test to prevent silent zero-match commands.

Do not add a 400-line harness CLI, tier map, Vitest-output parser, artifact-path
guesser, or Markdown failure-report generator now. Those would duplicate
`package.json` and create a second orchestration system.

GitHub step summaries should expose:

- Step name.
- Duration.
- Exit status.
- Exact narrow rerun command when it is static and known.
- Uploaded log/artifact paths.

Admit a custom runner only after at least three real failures show that normal
CI step logs and focused commands are materially blocking diagnosis. If added,
it must be a generic process/timing wrapper with no test semantics.

### 10.3 Long-running process safety

The full gate belongs in CI whenever possible. A local agent that must run a
long gate keeps the process attached or polls a durable process/status file; it
must not end its task while the gate is still running.

This is an orchestration rule, not a test-framework feature. A prettier CLI
does not fix abandoned background processes.

---

## 11. Flake and failure policy

- Blocking lanes have zero automatic retries.
- A failure followed by a pass is recorded as a flake issue within 24 hours.
- Fix the root cause within one week or remove the unreliable check from the
  blocking lane until repaired.
- Do not maintain a second append-only flake ledger in the repository; the issue
  tracker is canonical.
- Allowlist browser warnings only by exact message with an upstream issue and
  expiry/review condition.
- Missing optional infrastructure may skip only an explicitly optional advisory
  lane. Missing Chromium, missing fixtures, zero selected tests, and missing
  release artifacts fail blocking lanes.

---

## 12. Implementation plan

### Phase H2 — Correct the topology first

- **H2-1:** Remove standalone search-matrix and sitemap-static invocations from
  `release:verify` because `verify -> test:e2e` already runs those files.
- **H2-2:** Restrict `verify` and `pr-e2e-smoke` CI jobs to pull requests.
- **H2-3:** Keep `release-verify` for pushes to `main` and manual dispatch; fix
  stale CI comments.
- **H2-4:** Add pnpm dependency-store caching to CI if the setup is supported by
  the pinned Corepack/pnpm flow; do not cache `.output` between unrelated jobs.
- **H2-5:** Change the release rule so only the exact committed SHA can authorize
  a tag. Local runs are pre-checks unless they record a clean SHA and durable
  environment evidence.

Acceptance:

- `vitest list --project e2e` proves search and sitemap each have one blocking
  execution path.
- A PR runs only PR jobs.
- A main push/dispatch runs the release job without duplicate PR jobs.
- Release documentation commits metadata before the authoritative gate/tag.

### Phase H3 — Finish the output contract

- **H3-1:** Finish the route-manifest classifier with stable/volatile/unknown
  outcomes and deterministic sorting.
- **H3-2:** Commit one golden each for basic and i18n; compare both build and
  generate to the relevant golden.
- **H3-3:** Add emitted-file link integrity for basic generate, i18n generate,
  and docs.
- **H3-4:** Add leak-sweep unit controls and canonical fixture sentinels.
- **H3-5:** Remove the decorative static `robots.txt` requirement unless product
  ownership changes.

Acceptance:

- Deleting one fixture page yields a readable missing-route diff.
- Adding an unclassified stable public file fails until classified.
- A dead relative/root-relative link reports source and normalized target.
- A missing fragment reports the target HTML and fragment.
- Every negative sweep fails on its positive control.
- Build and generate route contracts agree or show an explicit reviewed
  exception.

### Phase H4 — Browser breadth

- **H4-1:** Add the i18n emitted-route hydration crawl using one server/browser.
- **H4-2:** Capture page errors, console errors, hydration warnings, failed
  requests, and >=400 same-origin responses.
- **H4-3:** Replace generic crawl `networkidle` waits with rendered-app readiness.

Acceptance:

- A deliberate hydration mismatch fails and names the route.
- A deliberate missing same-origin asset fails and names the request.
- Existing locale/search/back-forward behavior remains green.

**Checkpoint A:** Run one complete `release:verify` after H2-H4, record SHA,
runtime versions, duration, and failures/retries. Do not run a full release gate
after every subtask.

### Phase H5 — Test the exact package

- **H5-1:** Make `release:pack` the single canonical tarball producer.
- **H5-2:** Make the packed-consumer script accept and require that tarball in
  release mode.
- **H5-3:** Run the existing pnpm consumer against it.
- **H5-4:** Add a minimal npm consumer prepare/typecheck/build against the same
  tarball.
- **H5-5:** Record tarball SHA-256 in the CI summary/artifact.

Acceptance:

- Corrupting/removing an export in the tarball fails both hygiene and consumer
  resolution where applicable.
- The consumer log names the exact tarball path and checksum.
- Exactly one release tarball exists after the gate.

### Phase H6 — Make support ranges truthful

- **H6-1:** Raise Node to `>=22` with changelog/docs and release-version decision.
- **H6-2:** Bound Nuxt and optional Vitest peer ranges to supported majors.
- **H6-3:** Document supported I18n/Sitemap major lines.
- **H6-4:** Configure Renovate by compatibility stack, not one giant group or
  blindly one package per PR.

Acceptance:

- Package manifest, compatibility policy, docs, examples, and tests agree.
- `compatibility:check`, docs drift, package contracts, and exact consumer pass.
- Renovate configuration produces attributable, installable update states.

### Phase H7 — Runtime and dependency workflows

- **H7-1:** Full release on Node 24; focused minimum-runtime job on Node 22.
- **H7-2:** Weekly minimum-supported and latest-supported compatibility slices.
- **H7-3:** Weekly focused Windows job.
- **H7-4:** Optional monthly Node 26/upcoming-major advisory lane.
- **H7-5:** One issue/reporting path with resolved-version artifacts; no
  compatibility-policy writeback.

Acceptance:

- Node 22 and 24 jobs are green on a real workflow run.
- A deliberately incompatible supported-range test makes the correct leg red
  and produces a useful issue body/version artifact.
- Future/advisory failure is visible but cannot block main or a release.
- Windows quickstart/build is green.

### Phase H8 — Agent ergonomics and timing

- **H8-1:** Add the escalation ladder to `AGENTS.md`/maintainer guidance.
- **H8-2:** Add only recurring focused scripts and zero-match guards.
- **H8-3:** Publish CI step durations and rerun commands through job summaries.
- **H8-4:** Rebaseline PR/release/canary budgets after duplicate deletion and new
  checks.

Acceptance:

- Every documented command is executed once and selects the expected tests.
- An agent can reproduce each lane's failure without rerunning a broader lane.
- No new tier map, report parser, or second source of test truth exists.

**Checkpoint B:** Run the final release workflow on the exact intended SHA.
Only a green Checkpoint B may authorize the tag.

---

## 13. Cornerstones

Review these whenever related code changes:

1. **Fixture cache identity:** root + sorted environment + build/generate mode.
2. **Fixture output exclusivity:** never concurrently write two variants into
   one `.output` directory.
3. **Vitest selection:** exclusions and dedicated projects must not produce
   zero-match false greens.
4. **Manifest classification:** stable, volatile, or failure; unknown output is
   never silently discarded.
5. **Golden determinism:** normalized separators, code-unit sorting, stable
   newline format.
6. **Link resolution:** source-relative URL semantics, encoding, query,
   fragments, and exact exceptions.
7. **Leak sentinels:** detector controls and source fixture bait remain coupled.
8. **I18n contract:** fallback, translated slugs, sitemap alternates, and
   repeated-prefix checks move together.
9. **Browser lifecycle:** one failing route must not leak server/browser state
   into later routes; cleanup runs in `finally`.
10. **Exact tarball identity:** pack once, test once, inspect/publish the same
    checksum.
11. **Supported versus future:** supported-range red blocks; future red informs.
12. **Release SHA:** metadata is committed before the authoritative gate and
    the tag points at that exact green SHA.
13. **No duplicate expensive execution:** inspect project globs before adding a
    standalone script.
14. **Public support policy:** engine and peer ranges are finite claims backed
    by boundary tests.
15. **Package-manager reality:** workspace success never substitutes for a
    clean external install.

---

## 14. Explicit non-goals

Do not add these now:

- Screenshot/visual regression for fixture styling.
- Coverage-percentage gates.
- Mutation testing across the whole suite.
- Load testing without a published performance contract.
- Full browser matrices across every OS and Node version.
- External-link network crawling in blocking CI.
- Yarn/PnP compatibility without an explicit support commitment.
- A bespoke harness framework or Vitest-output parser.
- Per-dependency full `release:verify` canary legs.
- CI-generated compatibility dates committed back to the repository.

Admission rule: add a deferred category only when a concrete support promise or
escaped regression demonstrates that it would catch something the existing
system cannot catch more simply.

Security regression cases are not deferred by this list. Path traversal,
malformed serialized input, private-content leakage, and unsafe file access
remain blocking contracts. Add focused corpus/property tests when those public
boundaries grow; do not wait for a CVE to justify a cheap security invariant.

---

## 15. Definition of done

- [x] Real `nuxi generate` for basic and i18n is isolated and green.
- [x] Generate-mode sitemap assertion path is exercised in a real run.
- [ ] Duplicate e2e and main-branch CI execution is removed.
- [ ] Release authorization is tied to the exact green commit SHA.
- [ ] Two reviewed semantic output goldens cover build and generate.
- [ ] Static output and docs have emitted-file/fragment link integrity.
- [ ] Negative leak checks have detector and fixture controls.
- [ ] I18n hydration crawl is green with zero browser/runtime failures.
- [ ] One exact tarball passes hygiene, pnpm consumer, and npm consumer.
- [ ] Node support is maintained and tested on Node 22/24.
- [ ] Peer/integration ranges are finite and documented.
- [ ] Renovate updates are attributable by compatibility stack.
- [ ] Minimum/latest-supported canaries and focused Windows CI are observed
      green in GitHub.
- [ ] Agent guidance uses focused iteration and no second harness framework.
- [ ] Final exact-SHA release workflow is green, durable, and linked from the
      release record.

When every box is checked, a green release job means what it should mean: the
code, the Nuxt/Nitro integrations, the generated site, the browser behavior,
the dependency boundaries, and the exact package a human is about to publish
have all been tested at the appropriate layer.
