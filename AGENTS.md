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

### Test escalation ladder

Do not start with the full release gate. Iterate at the narrowest layer, then
escalate once:

| Change | First check | Escalation |
|---|---|---|
| Helper or pure domain logic | Targeted Vitest file in its project | `pnpm test` |
| Query/provider/public contract | Targeted unit and contract files | `pnpm test` |
| Nuxt module, hook, or runtime | Targeted contract and affected e2e file | `pnpm test:e2e` |
| Static fixture/output | Affected e2e file or `pnpm test:generate:static` | owning e2e project |
| Browser behavior | Targeted browser file | `pnpm test:e2e:browser` |
| Docs | `pnpm docs:build && pnpm docs:smoke && pnpm docs-drift` | `pnpm verify` |
| Package/export metadata | Package contract and `pnpm release:pack` | exact packed consumer |

Run `pnpm verify` once before handoff for code or public-behavior changes. The
authoritative `release:verify` belongs in CI on the exact final SHA; do not run
it repeatedly while editing. CI blocking jobs always run their complete lane
without changed-path shortcuts.

Long-running local commands must stay attached or be polled through a durable
status file. Never end an agent task while a gate is still running.

## Release Safety

Never run live publish commands from an agent session. The normal release flow
uses the protected `Publish` GitHub Actions workflow with the successful CI run
ID and exact package version. A human reviewer approves its `npm` environment.
The workflow publishes only the previously certified tarball.

Use these commands only to prepare and verify release metadata:

```bash
pnpm run release:notes
pnpm run release:verify
```

The local `release:publish` script is a manual recovery path only. Follow
`MAINTAINING.md` if the protected workflow cannot be used.
Do not commit `.pack/`, `dist/`, `.nuxt/`, `.output/`, or generated tarballs.

Use a short branch name that describes the work, such as
`fix/provider-pagination`. Do not require an agent or tool prefix such as
`codex/`, `claude/`, or `cursor/`.

Follow `docs/WRITING.md` for human-authored documentation. Do not rewrite legal
text, code, API identifiers, quotations, or generated reports to match the
controlled-English profile.

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
