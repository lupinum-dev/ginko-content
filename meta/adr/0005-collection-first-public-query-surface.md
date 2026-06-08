---
type: ADR
id: "0005"
title: "Collection-first public query surface"
status: superseded
date: 2026-04-24
superseded_by: "0016"
---

This ADR is superseded by [ADR-0016: Unified query API](./0016-unified-query-api.md).
The collection-first requirement remains, but the public API names in this ADR
are historical and should not be used as current guidance.

## Context

Nuxt Content v2 exposed an implicit global content bag: any document was
queryable by path, with optional tagging. That was convenient for small
apps and disastrous for larger ones — no type guarantees, no way to
scope parsing or validation, no clear ownership of documents.

v3 introduced collections. Ginko inherits that direction, but v3's
public API still retains some path-based querying paths that make it
easy to bypass the collection model. That erodes the value of having
collections at all.

We need the public query surface to be unambiguous about which collection
a query targets, so type inference, schema validation, and i18n behavior
can all hang off the collection.

## Decision

**Collections are required for public querying.** There is no public
path-based query that skips the collection model.

- `content.config.ts` is the declaration point for collections, schemas,
  parsing, and per-collection i18n opt-in.
- Public querying goes through `queryCollection(name)` (client) and
  `serverQueryCollection(event, name)` (server), both of which require a
  collection name.
- One raw query lane exists for typed single-document reads, also
  collection-scoped.
- Page-level composables (`useContentPage`, `useContentRoute`,
  `useContentSwitchLocalePath`) take a collection name.

Sugar forms that bypass the collection (for example
`queryCollection(c).path(p)` or `serverQueryCollection(event, c).path(p)`)
are explicitly non-goals.

## Alternatives considered

- **Keep a global path-based API.** Rejected. Re-introduces all the v2
  footguns: no schema per document type, no parsing differences per
  collection, no locale scoping.
- **Auto-infer a default collection.** Rejected. Magic defaults make
  debugging worse and type narrowing unreliable.
- **Multiple query lanes (collection-first + path-first).** Rejected.
  Doubles the surface area, forces every feature to handle both.

## Consequences

- Every doc page and every API route must know its collection name.
- Type inference is strong: the collection's schema flows through query
  results all the way to the template.
- Migration from v2-style apps requires declaring collections; this is
  a deliberate breaking change.
- Features like translated slugs, search sections, sitemap sources, and
  navigation merging all have a clear ownership boundary.
- The public package exports and user-facing API reference are the
  authoritative contract for public identifiers.
