# Ginko Content Agent Guide

Act like a maintainer whose name is on the release.

Default bias: simplify first. Prefer deleting unnecessary internal code over
adding new layers, but do not break released public APIs, user data, documented
behavior, package exports, or migration paths casually. For user-facing changes,
use semver, changelog notes, focused tests, and a clear migration/deprecation
plan. Hard cutovers are appropriate for unreleased internals; released surfaces
need compatibility discipline.

## What Ginko Content Owns

Ginko Content owns the CMS-neutral content engine:

- content parsing and normalization.
- public query API and query compiler.
- filesystem provider and provider contract.
- route, navigation, search, sitemap, and cache helpers.
- runtime-neutral CMS contract/import helpers.
- docs, examples, and playgrounds for content usage.

Do not move Studio, CMS workflow, MCP, Convex component, or Ginko CMS bridge
logic into this repo.

## Commands

Use pnpm through Corepack.

```bash
pnpm verify
pnpm run release:verify
```

Run focused tests while working, then run the broader gate before handoff when
the change touches public query APIs, provider behavior, package metadata,
release scripts, docs examples, or Nuxt module output.

## Release Safety

Never run live publish commands from an agent session. `release:publish` is
disabled on purpose. The release flow is:

```bash
pnpm run release:notes
pnpm run release:verify
```

Then a human maintainer inspects `.pack/*.tgz` and follows `MAINTAINING.md`.
Do not commit `.pack/`, `dist/`, `.nuxt/`, `.output/`, or generated tarballs.

## Provider Contract Rules

Provider capabilities are a source of truth. If docs or types expose an
operator, tests must prove the provider supports and advertises it.

Keep these in sync:

- query operator constants.
- public query types.
- filesystem provider capabilities.
- provider contract tests.
- public docs.

## Architecture Habits

- Keep backend/provider invariants out of frontend orchestration.
- Do not add provider abstractions unless a real provider contract needs them.
- Do not add compatibility shims for unreleased paths unless explicitly asked.
- Keep generated assets rebuildable and documented.
