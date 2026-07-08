---
type: ADR
id: "0018"
title: "Classify public surfaces by audience"
status: active
date: 2026-06-07
---

## Context

Ginko Content exposes several audiences through one package:

- Nuxt app authors reading content in pages and components.
- Nitro/server authors querying content in handlers.
- provider authors implementing external content sources.
- cache adapter authors.
- agent markdown extension authors.
- CMS import/contract users.
- test authors using provider fixtures.

Before this decision, `@lupinum/ginko-content/server` mixed stable server query
helpers, provider helpers, cache helpers, and agent markdown helpers in one
facade. Those exports were real and some are already used by consumers, but the
audience and stability of each export was implicit.

Implicit public surface makes maintenance harder:

- contributors cannot tell whether a new export is beginner-facing, advanced,
  provider-only, testing-only, or accidental.
- docs can accidentally teach advanced provider/cache/agent helpers as the
  normal app API.
- contract tests can prove that exports load, but not why they should exist.
- moving helpers into cleaner subpaths risks breaking released users unless the
  current commitment is explicit first.

## Decision

Ginko Content classifies committed public surfaces by audience in
`meta/public-surface.json`.

Contract tests compare that classification to:

- `packages/content/package.json` export subpaths.
- `packages/content/src/public/client.ts` value exports.
- `packages/content/src/public/client.ts` type exports.
- `packages/content/src/public/server.ts` value exports.
- `packages/content/src/public/server.ts` type exports.

Adding, removing, or moving a public export requires updating the classification
with an intended audience category. Tests should fail when a facade grows
without a classification.

For now, `@lupinum/ginko-content/server` remains the compatibility facade for
server queries, provider helpers, cache helpers, and agent markdown helpers.
Agent/cache helpers are classified as advanced surfaces. They should not appear
in beginner docs. A future pre-1.0 cleanup may move them to explicit agent/cache
subpaths, but only with an intentional release/migration decision.

2026-07-08 update: the agent markdown surface now has an explicit
`@lupinum/ginko-content/agent` subpath. `@lupinum/ginko-content/server` no
longer re-exports agent helpers; `meta/public-surface.json` is the source of
truth for the current subpath and symbol classification.

## Alternatives considered

- Move agent and cache helpers immediately to new subpaths. Rejected for now
  because released consumers and examples already import them from `/server`.
  Adding new subpaths while retaining old exports would create dual public
  paths before the migration policy is documented.
- Keep export expectations only in tests. Rejected because tests alone do not
  explain the audience or stability expectation behind each export.
- Leave `/server` broad and rely on prose docs. Rejected because prose docs
  drift unless contract tests verify the source facade.

## Consequences

Public API growth becomes explicit and reviewable.

Beginner docs can stay focused on app/server query APIs while advanced docs
still cover provider, cache, CMS, testing, and agent extension surfaces.

The current `/server` facade is not treated as clean final architecture. It is
treated as a compatibility facade whose advanced exports have clear audience
labels until a deliberate pre-1.0 segmentation happens.
