# Maintaining Ginko Content

Ginko Content is the CMS-neutral content engine and provider contract. It owns
content parsing, querying, route, navigation, search, sitemap helpers, and the
runtime-neutral CMS contract.

## Package surface

The repository publishes `@lupinum/ginko-content` from `packages/content`.
The package must remain CMS-neutral. Runtime content code must not import Ginko
CMS.

## Daily work

Run the broad workspace gate before you open a pull request:

```bash
pnpm verify
```

This command builds the package, prepares fixtures, checks repository policy,
builds the docs and maintained examples, runs the test suites, and typechecks
the workspace.

Use `pnpm audit:prod` after dependency changes. Do not accept a production
advisory without an explicit maintainer decision.

## Prepare a release

1. Update `packages/content/package.json` with the intended version.
2. Generate a changelog draft:

   ```bash
   pnpm run release:notes
   ```

3. Review and edit the matching `CHANGELOG.md` section. Changelogen creates a
   draft; the committed changelog is the source of truth.
4. Update the README, public docs, and examples when public behavior changed.
5. Open a release pull request and merge it only after all required checks pass.

Do not create a release tag or publish from a workstation. Do not run
`npm publish`. The protected workflow owns npm publication, the release tag,
and the GitHub release.

## Publish a release

Publishing is intentionally maintainer-triggered:

1. Wait for the `Release authorization` job on the merged `main` commit.
2. Open **Actions → Publish → Run workflow** on `main`.
3. Enter the successful CI run ID and the exact package version.
4. Approve the protected `npm` environment when GitHub requests review.

The workflow proves that the CI run belongs to the current `main` commit and
downloads its certified tarball. The OIDC-capable publication job does not
check out the repository, install dependencies, or execute repository scripts.
It publishes the tarball with `next` for prereleases or `latest` for stable
versions. A separate job creates the matching GitHub release from the committed
changelog section.

The npm trusted publisher must use this exact identity:

- package: `@lupinum/ginko-content`
- repository: `lupinum-dev/ginko-content`
- workflow: `publish.yml`
- environment: `npm`
- allowed action: `npm publish`

Do not add an `NPM_TOKEN`. If the protected workflow is unavailable, repair the
workflow. Do not create a second publication path.

## Release gate

A release may use only the exact commit whose CI `Release authorization` job is
green. The gate requires static quality, core contracts, docs and examples,
server e2e, browser behavior, static generation, the exact artifact, the
minimum runtime, Node 26, and Windows portability evidence.

The Windows packed Nuxt consumer remains a visible non-blocking canary while
the Nuxt 4.4.7-4.4.8 drive-letter prerender issue documented in the migration
guide remains open.

Local `pnpm run release:verify` is a diagnostic pre-check. It does not replace
the authoritative CI gate on the exact final SHA.

## Supply-chain policy

- `pnpm-workspace.yaml` sets `minimumReleaseAge: 1440`. New dependency versions
  must remain on the registry for 24 hours before fresh resolution.
- Release jobs use the committed lockfile. Do not regenerate it as a casual
  repair.
- Dependency install scripts stay explicit through pnpm's approved and ignored
  build-dependency lists.
- Check provenance before you change a dependency that is only stale in the
  lockfile.
- Never add a long-lived npm publication token.

## Compatibility holds

Package manifests declare compatibility. Minimum-runtime, portability,
fixture, and packed-consumer lanes enforce it.

Current intentional holds:

- Keep `h3@1.15.11` until h3 2 is stable and Nuxt ecosystem peers accept it.
- Limit CMS integration to contract and import subpaths. Runtime content code
  must not import Ginko CMS.

## Provider contract

Provider capabilities are runtime truth. If public types and docs expose a
query operator, the filesystem provider must support and advertise it, or the
public surface must stop teaching it.

Update these surfaces together when query operators change:

- `packages/content/src/core/query/operators.ts`
- `packages/content/src/runtime/server/providers/filesystem.ts`
- `packages/content/src/types/query.ts`
- provider contract tests under `test/contracts/`
- public reference pages under `docs/content/docs/5.reference/`

## Ownership boundary

Ginko Content owns the content engine. It does not own Studio, CMS workflows,
MCP tools, Convex component code, private consumer scripts, or host-specific
release canaries.

## Audit external settings

Review these settings in January and July, and after an ownership or release
workflow change.

GitHub must have:

- a protected `main` branch with pull requests, linear history, resolved review
  threads, and the repository's required CI checks;
- squash merge as the only merge method, auto-merge enabled, and merged branches
  deleted automatically;
- protected release tags;
- an `npm` environment that allows only `main`, requires a reviewer, and has no
  package token;
- private vulnerability reporting, secret scanning, push protection, automated
  security fixes, and CodeQL Default Setup for JavaScript and TypeScript;
- Renovate for routine dependency updates and CodeRabbit as an advisory reviewer.

npm must bind `@lupinum/ginko-content` to `publish.yml` and the `npm`
environment through trusted publishing.

Vercel must deploy the documentation from `main` to
`ginko-content.lupinum.com` and create pull-request previews.
