---
type: ADR
id: "0008"
title: "Translated slugs via numeric-prefix identity"
status: active
date: 2026-04-24
---

## Context

Users often want URLs to be **translated**, not just locale-prefixed:

- English: `/guide/getting-started`
- German: `/leitfaden/erste-schritte`

This is a standard SEO and UX expectation. The hard part is making it
work without forcing authors to maintain a brittle mapping table between
locales, and without breaking language switching, navigation merging, or
fallback resolution.

Nuxt Content v2/v3 do not solve this cleanly. Community solutions
typically bolt a mapping file on top, which drifts.

We need a way for authors to freely translate slugs while the system
still knows which documents are "the same document."

## Decision

**Translated slug mode derives canonical identity from a numeric-prefix
chain through the file tree.** Authors number their files; the numeric
chain is the identity; the human slug is free text.

Example:

```
content/
  en/
    1.guide/
      1.getting-started.md     -> key "1/1"
      2.advanced.md            -> key "1/2"
  de/
    1.leitfaden/
      1.erste-schritte.md      -> key "1/1"
      2.fortgeschritten.md     -> key "1/2"
```

Rules:

- Canonical keys in translated-slug mode are **numeric-segment-only**.
  No human slug text in the key.
- Index files inherit the containing folder's canonical key.
  `1.guide/index.md` and `1.leitfaden/index.md` are the folder document
  for key `1`.
- Changing a numeric prefix is an **identity change**, not a reorder.
  This includes sort-order tweaks — pick the right number when you
  author the file.
- Translated slugs are **opt-in** via `content.i18n.translatedSlugs: true`.
  Default is shared-slug mode.
- Both modes compile down to canonical keys before any variant lookup.
  One resolver, one code path.

## Alternatives considered

- **Author-maintained mapping file.** Rejected. Drifts; two sources of
  truth; breaks on rename.
- **Frontmatter cross-reference (`links: [de: 'erste-schritte']`).**
  Rejected. Must be duplicated on every variant; error-prone.
- **Hash of document content as identity.** Rejected. Editing the text
  of one variant changes its identity and breaks the cross-language
  relationship.
- **Same filename across locales, different folder.** That is
  shared-slug mode, which we already support. Does not solve translated
  URLs.
- **Explicit `id:` in frontmatter as the default identity mechanism.**
  Rejected as default. Kept as an escape hatch for special cases (see
  [ADR-0006](./0006-locale-agnostic-canonical-identity.md)).

## Consequences

- Authors who want translated slugs structure files with numeric
  prefixes from the start.
- Tooling (preview, link checking) can warn if a numeric prefix collides
  across siblings within a locale.
- Numeric prefixes double as a sort hint. The numbers drive identity; the
  same numbers give a predictable order.
- If a document exists in one locale but not another, the fallback
  resolver uses the canonical key to pick the best available variant.
- Shared-slug remains the default because it is simpler and sufficient
  for most sites.
