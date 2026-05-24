---
type: ADR
id: "0004"
title: "Filesystem provider uses files as the source of truth"
status: active
date: 2026-04-24
---

## Context

Content modules can source documents from many places: the filesystem, a
headless CMS, a database, a remote API, a Studio-style editor service.
Each source has its own consistency model, HMR story, and failure modes.

For Ginko's default provider and current primary user experience (see
[ADR-0002](./0002-target-small-to-medium-content-sites.md) and
[ADR-0011](./0011-ide-first-no-studio.md)), content lives in the same
repository as the code. Authors edit it in an IDE and version it in git.

We need a single, clear answer to "where does filesystem content come
from?" so that HMR, build, SSR, SSG, and deploy all agree.

## Decision

**For the filesystem provider, files are the source of truth.**
Specifically, files under the app's `content/` directory or configured
content mounts.

Every downstream artifact is derived from those files:

- the parsed-content cache
- the manifest and locale variant index
- the query result set
- the navigation tree
- the search sections and indexes
- the sitemap entries

For the filesystem provider, there is no authoritative database, no
content API that can disagree with the files, and no editor service whose
state has to be reconciled.

The provider architecture permits other sources. A future CMS provider
may use database-backed published projections as its source of truth.
That does not change the filesystem provider's semantics.

## Alternatives considered

- **SQLite as source of truth with files as input.** Rejected. Adds a
  sync problem we do not need; conflicts with
  [ADR-0003](./0003-no-native-search-deps.md).
- **CMS or Studio as source of truth in core.** Rejected. CMS/editor
  state belongs in a separate provider or product; see
  [ADR-0011](./0011-ide-first-no-studio.md) and
  [ADR-0013](./0013-keep-cms-outside-core.md).
- **Remote API as source of truth for the filesystem provider.** Rejected.
  Offline-friendliness, git versioning, and IDE editing are explicit goals
  for the default provider. Remote APIs remain valid as external provider
  implementations.

## Consequences

- HMR is straightforward: file change → invalidate → re-parse → re-render.
- Git is the editorial history. Branches are draft environments.
  Commits are the audit log.
- Filesystem content cannot be edited at runtime through the core module.
  That is by design.
- The content lives with the code. CI can type-check, lint, and test
  frontmatter the same way it tests code.
- Collaborating non-technical authors need a different tool: a future CMS
  provider/product, or another CMS entirely.
