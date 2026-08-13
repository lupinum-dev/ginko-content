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
- npm trusted publishing is bound to the protected `publish.yml` workflow and
  `npm` environment. The publication job consumes only the certified tarball.
- Do not add an `NPM_TOKEN` or publish from a maintainer workstation.
- Release jobs must not use package-manager caches.
- Tags may only target a commit whose CI `Release authorization` job is green;
  `pnpm run release:verify` is the corresponding local pre-check.
