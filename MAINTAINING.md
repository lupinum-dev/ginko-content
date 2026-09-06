# Maintaining Ginko Content

Ginko Content is the CMS-neutral content engine and provider contract. It owns
content parsing, querying, route, navigation, search, sitemap helpers, and the
runtime-neutral CMS contract.

## Package surface

The repository publishes `@lupinum/ginko-content` from `packages/content`.
The package must remain CMS-neutral. Runtime content code must not import Ginko
CMS.

## Local setup

Run `pnpm install --frozen-lockfile`, then `pnpm dev:prepare` and `pnpm dev`.
Use the playground URL printed by Nuxt. `pnpm docs` starts the source-workspace
documentation app. These local content fixtures need no login or backend service.
Use disposable content, keep external credentials out of the run, and stop only
servers and browser sessions you started.

Explore navigation, content rendering, search, a missing route, and recovery by
returning to a known page. Check a narrow screen and reload. Source-workspace
docs and exact packed-consumer evidence prove different installation paths.
Record the actual commands, failures, recovery, and cleanup at handoff. Hosted
settings and other operating systems require separate evidence.

## Daily work

Run the broad workspace gate before you open a pull request:

```bash
pnpm verify
```

This command builds the package, prepares fixtures, checks repository policy,
builds the docs and maintained examples, runs the test suites, and typechecks
the workspace.

Use `pnpm audit:all` after dependency changes. Keep `pnpm audit:prod` as the
additional check for the published package graph. Do not accept an advisory
without an explicit maintainer decision.

## Quick fixes

Keep one cause and one verification path in the pull request. Add a regression
test when the defect can return. Run `pnpm verify` before handoff.

## Large changes

Open an issue first. Split the work by public behavior and keep provider,
runtime, types, tests, and documentation in the same focused change.

## Documentation changes

Follow [docs/WRITING.md](./docs/WRITING.md). Build the documentation with
`pnpm docs:build`, and run `pnpm verify` before merge.

## Prepare a release

1. Prepare the intended version and changelog draft:

   ```bash
   pnpm run release:prepare -- -r 1.0.0-beta.1
   ```

   Replace the example version. The command does not commit, tag, push, or
   publish.
2. Review and edit the matching `CHANGELOG.md` section. Changelogen creates a
   draft; the committed changelog is the source of truth.
3. Update the README, public docs, and examples when public behavior changed.
4. Open a release pull request and merge it only after all required checks pass.

Do not create a release tag or publish from a workstation. Do not run
`npm publish`. The protected workflow owns npm publication, the release tag,
and the GitHub release.

## Publish a release

Publishing is intentionally maintainer-triggered:

1. Wait for the `Release authorization` job on the merged `main` commit.
2. Open **Actions → Publish → Run workflow** on `main`.
3. Enter the exact package version.
4. Approve the protected `npm` environment when GitHub requests review.

The workflow authorizes the current `main` commit and its successful CI run.
For a new version, that commit supplies the certified tarball. For recovery of
an existing npm version, the certified provenance source supplies it instead.
The OIDC-capable publication job does not check out the repository, install
dependencies, or execute repository scripts. It publishes the tarball with
`next` for prereleases or `latest` for stable versions. A separate job creates
the matching GitHub release from the source-bound changelog section.

The npm trusted publisher must use this exact identity:

- package: `@lupinum/ginko-content`
- repository: `lupinum-dev/ginko-content`
- workflow: `publish.yml`
- environment: `npm`
- allowed action: `npm publish`

Do not add an `NPM_TOKEN`. If the protected workflow is unavailable, repair the
workflow. Do not create a second publication path.

## Recover a partial release

Do not rebuild the tarball or create a replacement version for a GitHub-only
failure. Rerun the failed job when the existing workflow is correct. If the
workflow itself needs a fix, retain the original candidate and reconcile from
its certified source SHA after the fix. The certified source SHA is the exact
commit cryptographically recorded by npm provenance for the published tarball.

Recover in this order:

1. Dispatch from the current `main` SHA after it has successful push CI.
2. For an unpublished version, use current `main` as the certified source. For
   an existing version, derive the certified source from npm provenance with
   the isolated Sigstore 5 verifier.
3. Require the certified source to be an ancestor of current `main` and to have
   successful push CI. If the release tag exists, require it to peel to that
   source. A missing tag is created there only after publication is verified.
4. Download the exact retained CI artifact from the certified source, not from
   the later workflow-fix commit.

`@lupinum/ginko-content@0.3.6` has no npm provenance, so this recovery path
deliberately rejects it. That published version is immutable; do not add a
bypass or rebuild it. The next version must prove trusted publication and
provenance before this path can recover it.

The unprivileged job compares the registry SHA-1 with the retained tarball and
verifies the exact publishing workflow, source commit, and tarball SHA-512. It
also extracts release notes from the source commit. The protected job accepts
only that source-bound verification record. For an existing version, it fetches
only the validated npm attestation URL and requires the unique current SLSA
bundle to match the recorded SHA-256. It stops if registry existence, bytes, or
provenance changed before approval. It then verifies the correct dist-tag
(`next` for prereleases or `latest` for stable releases) for a new publication.
For an existing version it leaves the current channel head unchanged. Skip the
protected npm environment for this repair. Create or repair the tag and GitHub
release against the certified source. If the tag is missing, create it at that
source through the Git API. Re-read the tag and recursively peel it before
creating the GitHub Release. If GitHub rejects historical tag creation, run the
exact `gh api` command printed by the failed job. Then retry only the GitHub
Release job.

## Roll back a defective release

Do not unpublish unless npm policy and a confirmed security incident require
it. Restore the last known-good dist-tag, deprecate the defective version, and
publish a forward fix with a new version. Never rebuild different bytes for an
existing version.

## Respond to a credential incident

Stop release workflows and revoke the affected credential or trusted-publisher
binding. Review GitHub audit logs, workflow changes, tags, releases, and npm
access. Restore publishing only after the source commit and retained artifacts
are verified.

## Release gate

A release may use only the exact commit whose CI `Release authorization` job is
green. The gate requires static quality, core contracts, docs and examples,
server e2e, browser behavior, static generation, the exact artifact, the
minimum runtime, Node 26, and Windows portability evidence.

The Windows lane verifies package creation and path portability. The supported
Nuxt floor excludes the older drive-letter prerender issue documented in the
migration guide.

Local `pnpm run release:verify` is a diagnostic pre-check. It does not replace
the authoritative CI gate on the exact final SHA.

## Supply-chain policy

`pnpm check:dependencies` checks the actual workspace policy. Exact exceptions
need inline JSON with `reason`, `owner`, and UTC `expires` within 24 hours.
Generated consumers and production audits derive and check that same policy
before every install. Generated installs omit workspace overrides and package
extensions so they test the published graph and requested framework versions.
npm uses the equivalent age cutoff without broadening exact exceptions to
package-name exemptions. A daily CI lane checks expiry.
The repository-owned checker comes from
`lupinum-oss/starters/_shared/check-dependency-policy.mjs`; copy updates from
that canonical implementation.

The dependency canary selects the minimum Nuxt version from the package peer
range in an isolated checkout. Ordinary packed checks use the maintained Nuxt
version; explicit CLI selection wins over canary environment selection. Each
packed run reports and checks the installed version.

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
- GitHub Actions restricted to full commit-SHA references, with default
  workflow permissions read-only;
- Issues enabled for public reports, with Wikis and Discussions disabled so
  versioned repository documentation remains authoritative;
- protected release tags;
- an `npm` environment that allows only `main`, requires a reviewer, and has no
  package token;
- private vulnerability reporting, secret scanning, push protection, automated
  security fixes, and CodeQL Default Setup for JavaScript and TypeScript;
- Renovate for routine dependency updates and CodeRabbit as an advisory reviewer.

npm must bind `@lupinum/ginko-content` to `publish.yml` and the `npm`
environment through trusted publishing.

Vercel must deploy `docs/` from `main` to `ginko-content.lupinum.com`. Disable
automatic branch previews; request pull-request previews on demand. Use the
Basic build machine with On-Demand Concurrent Builds disabled. Change the build
machine type only when Basic cannot complete the build or a measured, named
alternative lowers the total cost per successful build.

Set the Root Directory to `docs`. Enable
**Include source files outside of the Root Directory in the Build Step** so the
documentation build can use the locked workspace package. Do not set an Output
Directory or Install Command override. Vercel detects pnpm from the repository
lockfile and installs the workspace before it runs the committed build command.
