# Ginko Content Open-Source Release Plan

Status: pre-release hardening plan

Audience: maintainers, release owners, and coding agents

Purpose: decide what should still change before the first open-source release,
based on the current codebase, `testing-10-10-roadmap.md`, and
`testing-10-10-progress.md`.

This is intentionally narrower than the 10/10 testing roadmap. The roadmap
created the confidence system. This plan says what I would still change before
opening the repository and publishing the package.

## Executive Decision

Do not add more public API before open source.

The highest-value work now is to make the release path deterministic and make
known limitations impossible to miss. The library has much stronger confidence
than before, but it should not be called ready until `release:verify` actually
runs the gates that now prove package-consumer, browser, search, sitemap, and
agent output behavior.

The remaining concerns are not mostly product-code hacks. They are release
discipline and operational proof:

- `release:verify` still does not run every high-confidence gate created by the
  testing roadmap.
- Browser e2e depends on a locally discoverable Chromium unless CI installs one
  predictably.
- Static same-URL markdown negotiation has a real deployment limitation and
  must remain documented as such.
- The test suite is broad enough that release commands must be clear about what
  runs locally, in PR, and before publish.
- Examples and fixtures now prove a lot, but failures can be noisy without a
  short triage guide.

## What I Would Not Change Now

- Do not add another locale-switching API. Keep `useContentSwitchLocalePath` as
  the compatibility API already proven by the downstream app.
- Do not reintroduce compatibility support for raw provider query return
  shapes. Keep canonical query envelopes as the provider contract.
- Do not add CMS runtime, Studio, MCP, admin, workflow, or bridge behavior to
  this package.
- Do not try to make pure static hosts honor same-URL `Accept: text/markdown`
  negotiation. Use explicit generated markdown routes for static deployments.
- Do not add new adapters, state machines, feature flags, or shims unless a
  real consumer demonstrates the need.

## Phase 0: Release Gate Hardening

Priority: required before open source

Problem:

The roadmap added strong commands, but the root `release:verify` script still
runs only:

```bash
pnpm verify
pnpm run audit:prod
pnpm run release:pack
```

That excludes the explicit package-consumer, production browser, search matrix,
and static sitemap gates that now carry the most user-facing confidence.

Todos:

- [ ] Change `release:verify` so it runs:
  - `pnpm verify`
  - `pnpm test:package-consumer`
  - `pnpm test:e2e:browser`
  - `pnpm test:search:matrix`
  - `pnpm test:sitemap:static`
  - `pnpm run audit:prod`
  - `pnpm run release:pack`
- [ ] Decide whether `test:package-consumer` should run before or after
      `release:pack`. Prefer after `release:pack` if the script can consume the
      inspected `.pack` tarball directly; otherwise keep its own isolated pack.
- [ ] Update `MAINTAINING.md` so the release gate description matches the real
      command.
- [ ] Update `docs/release-checklist.md` with the expanded gate.
- [ ] Keep `release:publish` disabled.

Acceptance criteria:

- `pnpm run release:verify` runs the package-consumer, browser, search matrix,
  and static sitemap checks without relying on a separate manual checklist.
- The command leaves no committed artifacts in `dist`, `.nuxt`, `.output`,
  `.pack`, or tarballs.
- Maintainer docs name the same gates as `package.json`.

Verification:

```bash
pnpm run release:verify
git status --short
git diff --check
```

## Phase 1: Deterministic Browser Runtime

Priority: required before open source CI

Problem:

The browser e2e harness can use an explicit Chromium executable or find a local
browser. That is pragmatic locally, but a public project needs deterministic CI
setup so contributors do not see false failures.

Todos:

- [ ] Add a documented browser install/setup step for CI.
- [ ] Prefer a pinned Playwright browser install in CI instead of relying on a
      developer-machine browser.
- [ ] Document `PLAYWRIGHT_CHROMIUM_EXECUTABLE` as a local override.
- [ ] Make browser e2e failure messages mention the install command or env var.
- [ ] Ensure browser e2e fails on console errors, hydration warnings, uncaught
      exceptions, and failed content API requests.

Acceptance criteria:

- A fresh CI runner can run `pnpm test:e2e:browser` without manual browser
  discovery.
- Local contributors can still run the test with either the installed browser
  cache or `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.
- A missing browser produces an actionable error, not a confusing stack trace.

Verification:

```bash
pnpm test:e2e:browser
```

## Phase 2: Release Artifact Inspection

Priority: required before first npm publish

Problem:

The package consumer test proves install/build behavior, and `release:pack`
creates the tarball. Before open source, the tarball contents themselves should
be treated as a tested product artifact, not only manually inspected.

Todos:

- [ ] Extend or add a tarball inspection script that asserts:
  - no `workspace:*` ranges
  - no `.env`, `.pack`, `.nuxt`, `.output`, fixture build output, or local
    tarballs
  - expected `dist` entry files exist for every exported subpath
  - expected declaration files exist for every exported subpath
  - package metadata has the intended `name`, `version`, `license`,
    `repository`, `exports`, `peerDependencies`, and `files`
- [ ] Run this script from `release:verify`.
- [ ] Keep human tarball inspection in `MAINTAINING.md`; automation should
      reduce mistakes, not remove the final human check.

Acceptance criteria:

- A bad tarball fails before publish.
- Package metadata and actual tarball contents cannot drift silently.

Verification:

```bash
pnpm run release:pack
# or the final command after wiring:
pnpm run release:verify
```

## Phase 3: Public Documentation Honesty Pass

Priority: required before open source

Problem:

Docs are now drift-checked, but the public reader still needs a clear,
non-marketing explanation of what is stable, what is advanced, and what is
limited by deployment mode.

Todos:

- [ ] Add or tighten a short "Production Readiness" section in the public docs:
  - supported Nuxt/Vue versions
  - package status and semver expectations
  - SSR/hybrid vs static markdown negotiation behavior
  - static markdown routes that are reliable
  - what Ginko Content owns and what belongs in a CMS/studio package
- [ ] Add a "Known Limitations" section that includes:
  - pure static same-URL markdown negotiation limitation
  - external provider maturity: filesystem provider is the proven default;
    external providers must pass conformance tests
  - Pagefind/search/static behavior depends on build/generate output
- [ ] Ensure beginner docs teach only the stable beginner path.
- [ ] Ensure advanced docs do not imply agent/cache/CMS APIs are required for
      basic usage.

Acceptance criteria:

- A new user can tell which deployment mode supports which markdown/agent
  behavior without reading source.
- A provider author can find the provider contract and conformance test path.
- Docs do not overclaim support for untested external providers.

Verification:

```bash
pnpm vitest run test/unit/docs-drift.test.ts
pnpm docs:build
```

## Phase 4: CI And Contributor Workflow

Priority: required before accepting external contributions

Problem:

The project has the commands, but open-source contributors need a predictable
workflow: fast local checks, full PR checks, and release checks. Without that,
the new test breadth can feel arbitrary.

Todos:

- [ ] Add CI workflows for:
  - fast PR gate: install, `pnpm lint`, `pnpm test`, `pnpm typecheck`
  - full PR/release-sensitive gate: `pnpm verify`
  - release gate: `pnpm run release:verify`
- [ ] Document when to run each gate in `CONTRIBUTING` or `MAINTAINING`.
- [ ] Add caching only if it does not hide dependency or generated-output
      problems.
- [ ] Ensure CI uses the committed lockfile.
- [ ] Ensure CI does not publish.

Acceptance criteria:

- A contributor can open a PR and see the same failure classes maintainers see.
- Release verification is automated but publishing remains manual.
- CI does not need secrets for normal PRs.

Verification:

```bash
pnpm lint
pnpm test
pnpm typecheck
pnpm verify
pnpm run release:verify
```

## Phase 5: Fixture And Failure Triage Cleanup

Priority: strongly recommended before open source

Problem:

The new confidence checks are useful, but build output can be noisy. A junior
or external contributor needs to know which warnings matter and which failures
point to which subsystem.

Todos:

- [ ] Add a short fixture index documenting each playground/test fixture:
  - purpose
  - command that exercises it
  - risk area it protects
- [ ] Add a failure triage section for:
  - browser e2e route/locale failures
  - generated-output smoke failures
  - package-consumer failures
  - search matrix failures
  - sitemap static failures
  - docs drift failures
- [ ] Keep the fixture index factual; do not duplicate all fixture config.

Acceptance criteria:

- A contributor can map a failing gate to the likely files to inspect.
- Known Nuxt/Vite warnings are classified without hiding real Ginko failures.

Verification:

```bash
pnpm docs:build
pnpm vitest run test/unit/docs-drift.test.ts
```

## Phase 6: Final Downstream Consumer Recheck

Priority: required before first publish

Problem:

The downstream app is the closest real user baseline. The internal tests should
not replace it until after the first open-source release has user feedback.

Todos:

- [ ] Pack the final package tarball from `packages/content`.
- [ ] Install it in `/Users/matthias/Git/workspace/shadcn-starter-i18n`.
- [ ] Run downstream:
  - `pnpm build`
  - `pnpm test app/generated-output.test.ts`
  - `pnpm check`
  - any browser smoke the downstream app owns
- [ ] Record any lockfile-only tarball integrity change separately.
- [ ] Do not commit downstream verification artifacts into this repo.

Acceptance criteria:

- The real consumer still builds and passes generated-output checks with the
  final tarball.
- Any downstream break is fixed at the root, not patched in the consumer unless
  the consumer was relying on an undocumented or intentionally removed behavior.

Verification:

```bash
mkdir -p /Users/matthias/Git/workspace/.local-tarballs
pnpm --dir packages/content pack --pack-destination /Users/matthias/Git/workspace/.local-tarballs

cd /Users/matthias/Git/workspace/shadcn-starter-i18n
pnpm add -w /Users/matthias/Git/workspace/.local-tarballs/lupinum-ginko-content-*.tgz
pnpm build
pnpm test app/generated-output.test.ts
pnpm check
git diff --check
```

## Phase 7: Final Release Candidate Gate

Priority: required before publish

Problem:

The last gate should be boring and repeatable. If it reveals new product bugs,
fix them and restart the gate from a clean tree.

Todos:

- [ ] Start from a clean tree.
- [ ] Run `pnpm run release:verify`.
- [ ] Inspect `.pack/*.tgz`.
- [ ] Run final downstream consumer recheck.
- [ ] Update `CHANGELOG.md` and release metadata.
- [ ] Tag only after the technical gate and downstream recheck pass.
- [ ] Publish manually according to `MAINTAINING.md`.

Acceptance criteria:

- `pnpm run release:verify` passes from a clean tree.
- The package tarball installs into a fresh Nuxt app and serves content.
- Production browser e2e, search matrix, sitemap static, generated output,
  docs drift, package exports, typecheck, and package consumer gates pass.
- The downstream app passes against the final tarball.
- No known flaky test is ignored.
- Known static markdown negotiation limitation remains documented.

Verification:

```bash
git status --short --branch
pnpm run release:verify
git status --short
```

## Current Senior-Level Assessment

What is good enough now:

- The public API is much better guarded by package export, public-surface, docs
  drift, and package-consumer tests.
- Provider boundaries are stricter and less compatibility-broad.
- Real production outputs are tested: browser behavior, generated static files,
  search, sitemap, agent markdown, and packed install.
- The known static markdown negotiation limitation is documented instead of
  being hidden.

What is not yet senior-level enough for open source:

- The strongest gates are not all wired into `release:verify`.
- CI setup is not yet described here as deterministic for browser e2e.
- Tarball content inspection should be automated further before the first npm
  publish.
- Contributor-facing triage docs should explain the now-broader test suite.

## Definition Of Ready For Open Source

The project is ready to open when all of the following are true:

- `pnpm run release:verify` includes every required release gate and passes.
- Browser e2e has deterministic CI browser setup.
- Tarball contents are automatically inspected.
- Public docs state supported versions, deployment-mode limitations, and
  package scope honestly.
- CI runs the documented PR and release gates.
- The real downstream consumer passes against the final tarball.
- The working tree is clean except for intentional release metadata changes.

