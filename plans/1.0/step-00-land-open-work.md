# Step 0: Land open work and set up `release/1.0`

**Why:** Finished work is spread over unpushed commits, an uncommitted
working tree and two red PRs. Every later step must start from one branch that
contains all of it, and CI must be green there, or every step PR inherits red
checks.

**Closes:** dependency advisories (`braces`, `node-forge` in the published
graph), E-X3. Prepares B-04 (closed in step 5).

**Estimate:** ~2 h.

## Facts (checked 2026-10-05)

- `origin/main` = `a3e8ef1` (`v1.0.0-beta.10`, never published to npm).
- Branch `feat/unicode-heading-anchors` = `d6c18be` (now on origin): 6 commits on top of `a3e8ef1`:
  `0110a30` structured pages without body · `4928650` watch only source mounts ·
  `2d49a2c` typed Nitro hooks · `300b640` isolate source watchers ·
  `d793a74` MDC angle syntax + multiline openings · `d6c18be` docs link.
- The main checkout also holds uncommitted heading-anchor work. Opus saved it as
  `plans/1.0/wip/heading-anchors.patch` (applies on `d6c18be`) and
  `plans/1.0/wip/heading-anchors.test.ts`. Step 2 task 2.6 uses it.
- PR #89 (`fix/content-identity-safety`) and PR #90 (`fix/fast-uri-advisory`)
  target `main`. Both are red only because of the advisories `braces`
  (GHSA-vfj7-8cjw-p6xm) and `node-forge` (GHSA-86w9-cpqp-85rv). Neither has a
  fixed version on npm.
- Root cause:
  - `braces` comes from Ginko's own `globby` dependency (`globby` → `fast-glob` → `micromatch` → `braces`). Ginko uses `globby` in 2 places only: `src/module/validation-assets.ts:21` and `src/portability-node/filesystem-export.ts:173`, both plain `'**/*'` listings.
  - `node-forge` comes from Ginko's direct `nitropack` dependency (`nitropack` → `listhen` → `node-forge`). Ginko only imports `nitropack/runtime` (Nuxt provides it at build time) and the type `NitroConfig`.
  - `h3` (exact pin `1.15.11`), `vue-router` and `unstorage` are also direct dependencies although Nuxt provides them. These are port leftovers.

## Tasks

### 0.1 Set up the branch, worktree and log (done by Opus)

Opus created `origin/release/1.0` from `origin/main` (`a3e8ef1`) plus the plan
merge, the worktree `/Users/matthias/Git/0_libs/ginko-content-r10` on
`release/1.0`, and `plans/1.0/log.md`. Nothing to do; verify with
`git -C /Users/matthias/Git/0_libs/ginko-content-r10 log --oneline -3`.

### 0.2 Land the local 6-commit stack (~20 min)

```bash
cd /Users/matthias/Git/0_libs/ginko-content-r10
git switch -c step/00-local-stack origin/feat/unicode-heading-anchors   # = d6c18be, pushed by Opus as a backup
git rebase release/1.0        # base is a3e8ef1 plus the plan; no conflicts expected
pnpm install --frozen-lockfile && pnpm test && pnpm typecheck
git push -u origin step/00-local-stack
gh pr create --base release/1.0 --title "feat: land structured pages, typed Nitro hooks, MDC angle syntax" --body-file <file>
```

The PR body lists the 6 commits with one line each. Wait for CI, merge into
`release/1.0`.

**Done when:** PR merged into `release/1.0`; CI on the PR green except the two
advisory audit checks (those turn green in 0.4).

### 0.2b Land `feat/kit-v2` (~30 min)

`origin/feat/kit-v2` (`79375f7`, 4 commits on `a3e8ef1`, written 2026-09-29 by
an earlier Opus session, pushed by Opus as a backup on 2026-10-05):

| Commit | What | Used by |
|---|---|---|
| `027d98f` | body renderer imports render policy and validation directly, not the `cms-contract` barrel (184 kB → 7 kB gzip); gzip budget + forbidden-module test (`test/unit/body-renderer-bundle-size.test.ts`, `test/helpers/browser-bundle-size.ts`) | step 4, step 9.2 |
| `2b7daa5` | content routes seeded through Nitro's `x-nitro-prerender` header instead of `<a>` links; module option `prerender: true \| false \| { crawlLinks? }`; collection option `prerender: false`; `prerender-live` e2e fixture | step 7.1 |
| `db76559` | body and policy types exported from the lean `body-renderer` entry | step 8 |
| `79375f7` | quickstart refers to collections by name in components | step 4.4 |

It merges cleanly with the 0.2 stack (Opus checked). After 0.2 is merged:

```bash
git switch -c step/00-kit-v2 origin/feat/kit-v2
git rebase release/1.0
pnpm install --frozen-lockfile && pnpm test && pnpm typecheck && pnpm test:e2e:prepared
```

PR into `release/1.0`, CI, merge. Keep the 4 commits (no squash).

**Done when:** merged into `release/1.0`; `test/unit/body-renderer-bundle-size.test.ts` passes there.

### 0.3 Save the heading-anchor WIP on its own branch (done by Opus)

`origin/wip/heading-anchors` (`cc826a1`) = `d6c18be` + the uncommitted work,
verified identical to Matthias's working tree. Do not open a PR. Task 2.6
rebuilds this work to the decided scheme.

### 0.4 Remove the dependencies Nuxt already provides (~45 min)

Work on PR #90's branch `fix/fast-uri-advisory` (add commits; do not rewrite
its history).

1. Replace `globby` with `tinyglobby` (already in the tree through Nuxt; add it
   as a direct dependency with the version range in `pnpm-lock.yaml`, today
   `^0.2.17`):

   ```ts
   // src/module/validation-assets.ts
   import { glob } from 'tinyglobby'
   const files = await glob('**/*', { cwd: directory, onlyFiles: true })

   // src/portability-node/filesystem-export.ts
   const files = await glob('**/*', { cwd: sourceRoot, onlyFiles: true, dot: true, followSymbolicLinks: false })
   ```

   Both return paths relative to `cwd` like `globby` does. Keep the existing
   sort if the caller sorts; if it does not sort, add `.sort()` so output order
   stays deterministic.
2. In `packages/content/package.json` move `nitropack`, `h3`, `vue-router`,
   `unstorage` from `dependencies` to `peerDependencies`. Use the ranges Nuxt
   `^4.5.2` itself depends on (read them with `pnpm why <name>` and from
   `node_modules/nuxt/package.json` / `@nuxt/nitro-server/package.json`). Keep
   them in the workspace `devDependencies` so local builds work. Do not add
   `peerDependenciesMeta.optional`: Nuxt always installs them.
3. `pnpm install`, then run:

   ```bash
   pnpm build:packages
   pnpm test
   pnpm typecheck
   pnpm audit:prod
   pnpm release:pack && pnpm test:package-consumer && pnpm test:package-consumer:npm
   pnpm audit:all
   ```

4. Commit as `fix(deps)!: rely on Nuxt for nitropack, h3, vue-router and unstorage`
   and `fix(deps): replace globby with tinyglobby`. CHANGELOG `## Unreleased`:
   "Breaking: `nitropack`, `h3`, `vue-router` and `unstorage` are peer
   dependencies; Nuxt installs them."

**Done when:** `pnpm audit:prod` exits 0, both packed-consumer tests pass, and
`pnpm audit:all` is either clean or lists only `node-forge` with a path that
starts at `nuxt` or `@nuxt/cli` (not at `@lupinum/ginko-content`).

**If `node-forge` remains through Nuxt:** this is gate **G1**. Write it into
`questions.md` with the exact `pnpm why node-forge` output. Do not add an
exception. Continue: the PR stays red on `audit:all` only; merge into
`release/1.0` is still allowed for this one known cause, and the log says so.

### 0.5 Retarget and merge PRs #89 and #90 (~20 min)

```bash
gh pr edit 89 --base release/1.0
gh pr edit 90 --base release/1.0
```

Merge #90 first, then rebase #89 on `release/1.0` if needed (`git rebase`,
push with `--force-with-lease`; Opus pushed #89 and allows this one rebase),
wait for CI, merge.

**Done when:** both PRs are merged into `release/1.0`; CI on `release/1.0`
head is green except gate G1 if it applies.

### 0.6 Clean package build warnings (E-X3) (~20 min)

`pnpm build:packages` warns about an empty `cli` chunk and a missing
`dist/agent/AGENTS.md` unless a separate docs packaging step runs.

- Find why the `cli` chunk is empty (check `build.config.ts` entries and
  `src/cli.ts`). If `cli.ts` re-exports nothing at runtime, make the entry the
  real CLI file. The package `bin` must keep working: `node packages/content/dist/cli.mjs --help` prints usage.
- Make `pnpm build` produce `dist/agent/AGENTS.md` itself (run the existing
  `scripts/package-agent-docs.mjs` from the package build), so a plain build is
  complete.

**Done when:** `pnpm build:packages 2>&1 | grep -iE "warn|empty"` prints
nothing, `ls packages/content/dist/agent/AGENTS.md` succeeds, and
`pnpm test:package-consumer` passes.

## Step verification

- `pnpm verify` on `release/1.0` head passes.
- CI on `release/1.0` is green (or only G1).
- No demo run needed for step 0.
