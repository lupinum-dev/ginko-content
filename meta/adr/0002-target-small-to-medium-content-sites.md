---
type: ADR
id: "0002"
title: "Target small-to-medium content sites"
status: active
date: 2026-04-24
---

## Context

A content module can plausibly target anything from a three-page personal
blog to a 10,000-page documentation platform. Each class of site wants
different tradeoffs:

- Small sites want a simple filesystem workflow, no infrastructure, and a
  fast path to shipping.
- Large sites may want database-backed search, advanced caching, editorial
  workflows, multi-repo content federation, or CMS-backed authoring.

Trying to serve both ends in one module is how Nuxt Content v3 arrived at
its current complexity level. The more we try to cover the large-site
case, the more the small-site case pays for features it does not need.

We need an explicit stance on who this is for, so the product can stay
focused and every future decision has a reference point.

## Decision

**Ginko targets small-to-medium Nuxt content sites.**

Specifically:

- documentation sites
- blogs
- marketing sites with substantial Markdown
- small-to-medium content-heavy projects

The default filesystem workflow is optimized for a few hundred documents
and should remain reasonable up to around 2,000 Markdown documents,
depending on content size, translation count, search configuration, and
deployment shape.

This is not a hard technical ceiling. It is the product center of gravity.
Past that range, filesystem authoring, client-side JSON search payloads,
and large translated content trees become the pressure points.

Sites that need more should either:

- use Ginko with a dedicated external search (Algolia,
  Meilisearch, Typesense), or
- use an external provider or future Ginko CMS provider that serves the
  same Ginko content contract, or
- use a different content platform designed for very large sites.

## Alternatives considered

- **Be a general-purpose content module.** Rejected. That is v3's
  position; duplicating it poorly helps nobody.
- **Target only tiny sites (< 50 docs).** Rejected. Too narrow; excludes
  most real-world docs projects.
- **Pick a document ceiling by performance benchmark only.** Rejected.
  The ceiling is a stance, not a hard technical limit. We would rather
  communicate "this is where it gets uncomfortable" honestly than pretend
  we scale indefinitely.

## Consequences

- Filesystem-first docs and examples should not grow enterprise
  architecture by default.
- Feature requests that only make sense at scale should be handled as
  provider work, external search integration, or future CMS work rather
  than complicating the default filesystem path.
- We can ship simple defaults confidently: a JSON search index is
  reasonable for small-to-medium sites and wrong for very large ones.
- Documentation, examples, and playgrounds should all reflect this
  scale; do not pad them with enterprise patterns.
- This scope is revisited in the changelog if a feature lets us raise the
  ceiling without breaking the small-site experience.
