---
type: ADR
id: "0013"
title: "Keep Ginko CMS outside the core repository"
status: active
date: 2026-04-29
---

## Context

The provider spec and implementation make it possible for a future CMS-backed source to serve the same Nuxt content APIs as the filesystem provider. That future path is valuable, but it introduces a different product:

- editing UI
- database-backed content
- file uploads
- draft and publish workflows
- user identity and permissions
- real-time behavior
- client-friendly editorial workflows

Those concerns are not part of the current `@lupinum/ginko-content` package.

## Decision

The current repository remains Ginko Core plus the filesystem provider.

A future Ginko CMS must be a separate provider/product built on top of the engine. It can use the provider contract to serve published content into Nuxt apps, but CMS/editor/admin behavior does not belong in this repository.

The core repository may define provider interfaces, provider capabilities, typed provider errors, and conformance tests. First-party packages such as `@lupinum/ginko-cms` must register their provider modules through the content provider registry hook when installed. Core must not hard-code CMS runtime behavior, CMS tables, Studio UI, publish workflows, upload handling, editor permissions, or admin-agent operations.

## Alternatives considered

- **Build CMS features directly into core.** Rejected. It would compromise the filesystem-first package and force every user to carry CMS complexity.
- **Forbid CMS-backed providers.** Rejected. The provider-neutral core is designed to support this path.
- **Keep CMS planning documents in this repo as active specs.** Rejected. They create ambiguity about what this package ships today.

## Consequences

- Core docs may mention a future CMS provider as a planned external path, but must not describe current Ginko as a CMS.
- CMS-specific details should live in the CMS repository/package when that exists.
- First-party CMS provider wiring is a module registration concern, not an app-level import string or core-owned runtime dependency.
- The provider contract should stay website-shaped: query, navigation,
  surroundings, provider-owned search, site data, and route enumeration.
- Editorial workflows should not leak into the core runtime API.
