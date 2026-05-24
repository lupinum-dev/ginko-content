---
type: ADR
id: "0006"
title: "Locale-agnostic canonical identity, internal only"
status: active
date: 2026-04-24
---

## Context

A multilingual content site needs an answer to: "this English page and
this German page — are they the same page?"

Without that answer:

- a language switcher cannot land on the translated equivalent
- navigation merging across locales collapses or duplicates nodes
- fallback resolution has no anchor to fall back from
- sitemap hreflang alternates are hand-wired per route

Nuxt Content v3 pushes much of this onto the user: one collection per
locale, explicit mapping tables, per-feature reconciliation. It works,
but the boilerplate is exactly the kind of thing we want to remove.

## Decision

Every content document has a **canonical key**: a stable,
**locale-agnostic** identifier that all variants of that document share.

- Canonical keys are **internal only**. They never appear in author-facing
  APIs — not in frontmatter references, not in query parameters, not in
  public examples.
- Author-facing references stay human-readable (paths, or explicit `id`
  frontmatter when an author wants to pin identity).
- The system maps human references to canonical keys at the boundary.

Two canonical-key modes:

- **Shared-slug mode (default):** the canonical key is the normalized
  locale-agnostic content path. English and German variants share a slug.
- **Translated-slug mode:** the canonical key is the numeric-prefix chain
  through the file tree. See
  [ADR-0008](./0008-translated-slugs-via-numeric-prefix.md).

Rules:

- `id` frontmatter override is an **escape hatch**, not the default path.
- If one locale variant declares an explicit `id`, every variant must
  declare the same `id`. Validation rejects partial or conflicting ids
  across variants.
- Single-document resolution is locale-aware with fallback in one pass.
- Language switching resolves by canonical identity, not by
  locale-prefix string swap.
- Navigation merging uses the same canonical identity that variant
  resolution uses.

## Alternatives considered

- **Expose canonical keys to authors.** Rejected. Opaque numeric or
  hash-like identifiers in frontmatter are a worse authoring experience.
- **Require explicit `id` on every document.** Rejected. Too much
  boilerplate; defeats "drop a file and it works."
- **Filename-based identity only.** Works in shared-slug mode; fails in
  translated-slug mode where each locale names the file differently.
- **Frontmatter cross-reference tables ("this doc matches that doc").**
  Rejected. Error-prone, duplicated across every variant, drifts.

## Consequences

- There is one variant resolver (`resolveVariant`) that every
  locale-aware feature calls into.
- Renaming a translated file is safe as long as its canonical identity
  is preserved (shared-slug: path unchanged; translated-slug: numeric
  prefix unchanged).
- Changing a numeric prefix in translated-slug mode is an **identity
  change**, not a reorder. Tooling must treat it as a breaking change
  for that document.
- Authors never see canonical keys, which is the point.
