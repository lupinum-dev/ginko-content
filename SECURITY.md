# Security Policy

Report security issues through GitHub private vulnerability reporting for this
repository. Do not open a public issue for suspected content injection, path
traversal, cache poisoning, package compromise, token leaks, or provider
capability bypasses. If private vulnerability reporting is not enabled yet,
enable it before the first public release.

## Maintained Versions

Only the latest published release line is maintained unless a separate support
branch is explicitly announced.

## Release Security

- No long-lived npm publish tokens in CI.
- Prefer npm trusted publishing plus staged publishing after the first package
  release exists on npm.
- First releases are manual owner-controlled publishes with 2FA because npm
  staged publishing requires an existing package.
- Release jobs must not use package-manager caches.
- Every release candidate must pass `pnpm run release:verify`.
