# Maintaining Ginko Content

Ginko Content is the CMS-neutral content engine and provider contract. It owns
content parsing, querying, route/navigation/search/sitemap helpers, and the
runtime-neutral CMS contract/import boundaries.

## Package Surface

Publishable package:

1. `@lupinum/ginko-content` from `packages/content`.

The package must remain CMS-neutral. It may expose runtime-neutral CMS contract
and import helpers, but runtime content code must not import Ginko CMS.

## Daily Maintenance

Use these commands while working:

```bash
pnpm verify
pnpm run release:verify
```

`verify` is the broad workspace gate. It prepares fixtures, runs repo policies,
builds packages, builds docs and examples, runs unit/provider/runtime/client/Nuxt
tests, runs e2e, and typechecks.

`release:verify` runs `verify` once, production browser e2e, real static
generation, production audit, two byte-identical release packs, and pnpm/npm
consumers against the exact verified tarball left in `.pack/`. Search and
sitemap checks already belong to the e2e project inside `verify`; they are not
run a second time.

## Release gate

A tag may only be cut from the exact commit SHA whose CI release workflow,
including `release-verify`, minimum-runtime, and Windows portability contracts,
is green. The Windows packed Nuxt consumer remains a visible non-blocking
canary while the Nuxt 4.4.7–4.4.8 drive-letter prerender issue documented in
the 0.2-to-0.3 migration guide is open. Release metadata must be committed
before that workflow runs. A local
`pnpm run release:verify` is a useful pre-check, but it does not authorize a tag
unless it ran from a clean tree at the exact tagged SHA and its environment and
artifact evidence were retained durably. See `testing-harness-rfc.md` for the
release-confidence model and acceptance gates.

## Release Runbook

Publishing is intentionally manual. The `release:publish` script exits with a
failure message so nobody, human or agent, can accidentally push packages to
npm.

Set the release version once and reuse it in the commands below:

```bash
VERSION=0.3.0-rc.1
case "$VERSION" in
  *-*) NPM_TAG=next; GH_RELEASE_FLAG=--prerelease ;;
  *)   NPM_TAG=latest; GH_RELEASE_FLAG= ;;
esac
```

Prereleases must use npm's `next` channel and a GitHub prerelease. Stable
versions use npm's `latest` channel and a normal GitHub release. Do not override
these values independently: both registries must describe the same release kind.

1. Start from a clean working tree on the release branch:

```bash
git status --short --branch
```

2. Confirm the version has not already been published:

```bash
npm view @lupinum/ginko-content@$VERSION version --registry=https://registry.npmjs.org/
```

An `E404` is expected for a new version. If npm returns a version, bump
`packages/content/package.json` and update the changelog before continuing.

3. Update release metadata intentionally:

- `packages/content/package.json`
- `packages/content/compatibility.json` — GENERATED: run `node scripts/generate-compatibility.mjs` (never hand-edit; `release:verify` runs it with `--check`)
- `CHANGELOG.md`
- `README.md`
- public docs and examples when public behavior changed

Generate changelog notes if needed, then review the result by hand:

```bash
pnpm run release:notes
git diff -- CHANGELOG.md
```

`changelogen` is a draft generator, not the source of truth. If there is no
reachable release tag yet, it can generate an unusable `## ...main` heading;
delete that output and keep the curated version section.

4. Commit the release metadata, push `main`, and record the commit SHA:

```bash
git add packages/content/package.json packages/content/compatibility.json CHANGELOG.md README.md MAINTAINING.md docs/release-checklist.md
git commit -m "chore: release ginko-content v$VERSION"
git push origin main
RELEASE_SHA=$(git rev-parse HEAD)
```

Do not tag yet. The authoritative gate must run against `$RELEASE_SHA`.

5. Wait for the `release-verify` job for `$RELEASE_SHA`, then download its exact
release artifact:

```bash
RUN_ID=$(gh run list --workflow CI --commit "$RELEASE_SHA" --json databaseId,conclusion --jq 'map(select(.conclusion == "success"))[0].databaseId')
test -n "$RUN_ID"
gh run view "$RUN_ID" --exit-status
rm -rf .pack
gh run download "$RUN_ID" --name ginko-content-release --dir .pack
```

The downloaded artifact must contain exactly one `.tgz` and
`release-artifact.json`. The metadata commit must equal `$RELEASE_SHA`,
`worktreeDirty` must be `false`, `releaseEligible` must be `true`, and
`reproduciblePacks` must be `2`.

6. Inspect the exact CI-tested tarball before tagging or publishing:

```bash
ls -lh .pack/
tar -tzf .pack/lupinum-ginko-content-$VERSION.tgz | less
tar -xOf .pack/lupinum-ginko-content-$VERSION.tgz package/package.json
tar -xOf .pack/lupinum-ginko-content-$VERSION.tgz package/package.json | rg 'workspace:' && exit 1
shasum -a 256 .pack/lupinum-ginko-content-$VERSION.tgz
cat .pack/release-artifact.json
```

Do not commit `.pack/`, `dist/`, `.nuxt/`, `.output/`, or tarballs.

7. Create and push an annotated tag at the exact green SHA:

```bash
test "$(git rev-parse HEAD)" = "$RELEASE_SHA"
git tag -a v$VERSION "$RELEASE_SHA" -m "v$VERSION"
git push origin v$VERSION
```

Use `git push origin v$VERSION` explicitly. `git push --follow-tags` only pushes
annotated tags that are reachable from the pushed commits, and lightweight local
tags are easy to miss.

8. Log in to npm and confirm package access:

```bash
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm access list packages lupinum --registry=https://registry.npmjs.org/
```

The npm CLI may open browser authentication during login or publish. Do not add
`--otp` unless npm explicitly asks for a one-time password.

9. Publish manually from the inspected tarball:

```bash
npm publish .pack/lupinum-ginko-content-$VERSION.tgz \
  --access public \
  --tag "$NPM_TAG" \
  --registry=https://registry.npmjs.org/
```

If npm opens an authentication URL, complete it in the browser and return to the
terminal.

10. Confirm npm package state:

```bash
npm access get status @lupinum/ginko-content --registry=https://registry.npmjs.org/
npm view @lupinum/ginko-content@$VERSION version --registry=https://registry.npmjs.org/
```

For a first public publish, `npm view` can briefly return `E404` while registry
metadata propagates. If access lists the package and status is `public`, wait a
minute and retry before assuming the publish failed.

11. Create the GitHub release with the same tarball:

```bash
gh release create v$VERSION \
  .pack/lupinum-ginko-content-$VERSION.tgz \
  --title "v$VERSION" \
  $GH_RELEASE_FLAG \
  --notes "$(awk -v version="v$VERSION" '$0 == "## " version { flag=1 } flag' CHANGELOG.md)"
```

If the release already exists, update it instead:

```bash
gh release upload v$VERSION .pack/lupinum-ginko-content-$VERSION.tgz --clobber
```

12. Run a clean install smoke test outside the repository:

```bash
tmpdir=$(mktemp -d)
cd "$tmpdir"
corepack enable
pnpm init
pnpm add @lupinum/ginko-content@$VERSION
node -e "import('@lupinum/ginko-content').then(() => console.log('ok'))"
```

13. Clean local release artifacts when finished:

```bash
rm -rf .pack
git status --short --branch
```

For the first public release of a package, npm staged publishing cannot be used
because staged publishing requires the package to already exist on the registry.
Use an owner-controlled manual publish with 2FA.

For later releases, prefer npm trusted publishing plus staged publishing:

- GitHub Actions must use a protected environment with human approval.
- The release job must use Node 24 or newer and npm 11.15 or newer.
- Do not use package-manager caches in release jobs.
- Use OIDC trusted publishing instead of long-lived npm publish tokens.
- Configure npm package settings to require 2FA and disallow traditional tokens.
- Stage the tarball, download/inspect the staged package, then approve with 2FA.

## Supply-Chain Policy

- `pnpm-workspace.yaml` sets `minimumReleaseAge: 1440` so new dependency
  versions must sit on the registry for 24 hours before fresh resolution.
- Release jobs must use the committed lockfile. Do not delete and regenerate the
  lockfile as a casual fix.
- Dependency install scripts stay explicit through pnpm's approved/ignored build
  dependency lists.
- If a dependency is only stale in the lockfile, check provenance before
  changing it. Do not blindly regenerate.

## Compatibility Tuple

The supported dependency tuple is tracked in
`packages/content/compatibility.json`. Release checks use that file to reject
stale pins in examples, playgrounds, docs, and fixtures.

Intentional holds:

- `h3@1.15.11` until h3 2 is stable and Nuxt ecosystem peers accept it.
- CMS integration stays limited to contract/import subpaths; runtime content
  code must not import Ginko CMS.

## Provider Contract

Provider capabilities are runtime truth. If public types and docs expose a query
operator, the filesystem provider must either support and advertise it, or the
public surface must stop teaching it.

Before changing query operators, update these together:

- `packages/content/src/core/query/operators.ts`
- `packages/content/src/runtime/server/providers/filesystem.ts`
- `packages/content/src/types/query.ts`
- provider contract tests under `test/contracts/`
- docs under `docs/content/docs/4.querying/` and `docs/content/docs/9.api-reference/`

## Ownership Boundary

Ginko Content owns the content engine. It must not own Studio, CMS workflows,
MCP tools, Convex component code, private consumer app scripts, or host-specific
release canaries.
