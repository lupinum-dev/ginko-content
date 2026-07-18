---
type: ADR
id: "0006"
title: "Locale-agnostic canonical identity"
status: active
date: 2026-04-24
---

## Context

A multilingual site must know which locale variants represent the same
conceptual document. Without a stable join key, fallback, language switching,
navigation merging, references, and sitemap alternates each need their own
mapping.

## Decision

Every document has a stable, locale-agnostic `canonicalKey` shared by all of
its variants.

The field is public because providers must supply it and returned route facts
use it, but it is opaque: consumers must not parse it, author it, or render it
as a URL. Use `route.resolvedPath` for links and `ref` for an optional
human-authored stable alias.

The filesystem provider derives canonical identity in two modes:

- Shared-slug mode uses the normalized locale-agnostic content path.
- Translated-slug mode uses the numeric-prefix chain through the file tree; see
  [ADR-0008](./0008-translated-slugs-via-numeric-prefix.md).

Providers backed by another source may use their own stable entry identity as
long as every locale variant emits the same key.

Rules:

- Authors do not write `canonicalKey` in frontmatter.
- `ref` is an optional author-facing alias, not the canonical identity itself.
- Single-document resolution, language switching, navigation merging, and
  sitemap alternates all join variants through the same key.
- A translated-slug numeric-prefix change is an identity change, not a reorder.

## Alternatives considered

- Require a hand-authored identifier on every document. Rejected because it
  adds boilerplate to the default filesystem workflow.
- Match variants by localized filename. Rejected because translated slugs use
  different names by design.
- Maintain separate mapping tables per feature. Rejected because they duplicate
  identity and inevitably drift.
- Treat the key as a public route. Rejected because translated-slug keys are
  numeric identities, not URLs.

## Consequences

- Every locale-aware feature uses one identity join.
- Renaming translated text is safe while its numeric prefix remains stable.
- Provider authors must preserve canonical identity across variants.
- Consumers can compare keys for identity but must use `route` and `resolution`
  for navigation and locale behavior.
