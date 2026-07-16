# Security Policy

Report security issues privately to [info@lupinum.com](mailto:info@lupinum.com).
Do not open a public issue for suspected content injection, path traversal,
cache poisoning, package compromise, token leaks, or provider capability
bypasses. GitHub private vulnerability reporting may also be used when it is
enabled for this repository.

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
