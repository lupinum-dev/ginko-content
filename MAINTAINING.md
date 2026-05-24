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

`release:verify` runs `verify`, production audit, and release packing.

## Release Runbook

Publishing is intentionally manual. The `release:publish` script exits with a
failure message so nobody, human or agent, can accidentally push packages to
npm.

1. Start from a clean working tree on the release branch.
2. Update `packages/content/package.json`, compatibility data, and docs
   intentionally.
3. Generate release notes:

```bash
pnpm run release:notes
```

4. Review `CHANGELOG.md`; changelogen is a draft generator, not an authority.
5. Run the release gate:

```bash
pnpm run release:verify
```

6. Inspect `.pack/*.tgz` before publishing:

```bash
tar -tzf .pack/lupinum-ginko-content-*.tgz | less
tar -xOf .pack/lupinum-ginko-content-*.tgz package/package.json | rg 'workspace:' && exit 1
npm publish .pack/lupinum-ginko-content-*.tgz --access public --otp <code>
```

7. Commit the release prep. Do not commit `.pack/` artifacts.
8. Publish only after the owner has reviewed the tarball and npm package
   settings.

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
