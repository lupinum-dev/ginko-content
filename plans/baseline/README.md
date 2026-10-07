# Ginko baseline: one released, matching set of all Ginko libraries

Started 2026-10-07. Orchestrated by Opus; lanes run by Codex and Opus agents.
Approved by Matthias: phase 0 and phase 1 ("ok please start").

## Goal

Every Ginko library has all work worth keeping on `main`, is published on npm,
installs the other Ginko libraries from npm (no snapshots), and uses one shared
toolchain. No branch, worktree or half-finished work is left.

## Definition of done (checked in every repo)

1. **No open work:** `git branch -a` shows only `main`; `git worktree list` shows one entry; empty stash; clean `git status`; no open PRs (Dependabot merged or closed). Agent worktrees under `~/.codex/worktrees/ginko-*` removed.
2. **No snapshots:** no `file:`, `link:`, `vendor/*.tgz`, `.pack/`, `internals/candidates/` or `pkg.pr.new` for `@lupinum/*` in any `package.json`, `pnpm-workspace.yaml` or lockfile.
3. **One published set:** each library is on npm under a version that no other build ever used (see "Release set").
4. **One copy each:** `pnpm why` shows one version of each `@lupinum/ginko-*` package and one `comark` line in every consumer.
5. **Green CI:** the repo's full gate passes in CI on `main`.
6. **One toolchain:** identical pnpm, Node range, Nuxt, Vue, TypeScript and ESLint base; Changesets; same CI job names; AGENTS.md; same license.
7. **Real use:** `ginko-content-demos` and the kit gastro staging run on the published set.

## Rules for every lane

- Finished work lands on `main` through a PR with green CI, as a **merge commit** (keep the commits) unless the repo only allows squash.
- A branch lives at most ~2 days: one PR, then merged or deleted. Its worktree goes with it.
- **Delete only what is provably on `main`:** a branch whose tip is an ancestor of `origin/main`, or whose `git merge-tree --write-tree origin/main <branch>` equals `origin/main^{tree}`. Everything else goes into the lane report as "drop candidate" with a one-line reason; Matthias approves that list.
- Never publish to npm. Release preparation (version PR, changelog) is fine; the publish is Matthias's click.
- Never touch the i18n lane, and never touch uncommitted files you did not create.
- One writer per repo. Lanes do not edit another lane's repo.

## Phase 0: secure (done 2026-10-07)

All local-only branches of docs, editor, kit and cms pushed to their origins
as backups. `lupinum-dev/ginko-i18n` created (private) and its `main` pushed.

## Phase 1: land, one lane per repo, in parallel

| Lane | Lands on `main` | Owner |
|---|---|---|
| content | #90 → #89 → `feat/unicode-heading-anchors` (6) + `feat/kit-v2` (4) → `plans/1.0` + this file → dependency cleanup (`plans/1.0/step-00` §0.4, §0.6) → release prep `1.0.0-beta.11` | Codex live |
| editor | `fix/component-syntax-origin` (11: host migration → lean release → component origin) → `feat/kit-v2` (5) → Dependabot | Codex live |
| kit | `chore/better-convex-main` (2) | Codex |
| docs | 4 commits from `fix/component-kit-compatibility` → `feat/editorial-layouts` residue check → `feat/one-shell-01-public-seams` (rebased, 7 prose conflicts) → Dependabot | Opus agent |
| cms | PR `codex/cms-overnight-integration` → `main` (37), reviewed; merges in wave C | Opus agent + Codex review |
| i18n | walking skeleton + 6 design decisions, in its own thread | its own thread |

Release names: `1.0.0-beta.10` is burnt (three different builds carry it).

## Phase 2: release waves (dependency order; 24 h npm quarantine between waves)

| Wave | Publish | Needs |
|---|---|---|
| A | ginko-content `1.0.0-beta.11`; better-convex next rc; nuxt-pdf, nuxt-email (versions not yet used) | — |
| B | ginko-editor `0.1.0` on content beta.11; ginko-docs `0.4.0-rc.12` on content beta.11 | A |
| C | ginko-cms on content beta.11 + editor 0.1.0; ginko-kit `1.0.0-rc.0` with `vendor/` deleted; editor and kit docs on docs rc.12 | B |
| Check | demos, kit gastro staging, ginko-write on the set; done checks 1–7 | C |

Open decision: exclude `@lupinum/*` from `minimumReleaseAge` (3 days → 1).

## Phase 3: toolchain alignment (one pass, after phase 1 merges)

One target table (pnpm, Node range, Nuxt, Vue, TS, ESLint base, Changesets,
CI job names, AGENTS.md incl. the branch rule above), applied to all repos.

## Stage 2: fit (after the done check)

1. Content 1.0 plan (`plans/1.0/`), with step PRs into `main` (no `release/1.0`); step 12 consumer bases are each repo's `main`.
2. One owner per concept: heading/slug and URL/render safety → content; comark one line (`^0.6`); locale prefix and routing → ginko-i18n (replaces `@nuxtjs/i18n`).
3. Renovate group `@lupinum/ginko-*` in every repo.

## Machine budget

Load hit ~98 with five lanes plus other sessions; tests timed out. Rule from
2026-10-07: **one heavy lane at a time** (install/build/test), in dependency
order: content → kit → editor → docs → cms. A lane may wait on GitHub CI while
the next one starts.

## Status

| Lane | State | Where it stopped | Drop candidates |
|---|---|---|---|
| content | running (Codex) | dependency cleanup on #90's branch | |
| kit | running (Codex), light | `pnpm verify` passed (536 tests); build running; no PR yet | |
| editor | paused | checkout on `land/kit-v2` (clean); kit-v2 tests timed out under load, rerun needed | |
| docs | paused | `land/component-kit-fixes` has 2 cherry-picks (c774700, 78dfce2) + uncommitted `layer/package.json`, `pnpm-lock.yaml` | |
| cms | paused | nothing opened; worktree `1_apps/ginko-cms-next-rollout` has uncommitted `packages/cms/src/cli/migrate.ts`, `test/module/ginko-cli-migrate.test.ts` (origin unclear) | |
