---
type: ADR
id: "0001"
title: "Fork Nuxt Content as Ginko instead of adopting v3"
status: active
date: 2026-04-24
---

## Context

Nuxt Content v3 represents a significant architectural rewrite over v2. It
is well engineered, powers large sites including `nuxt.com`, and solves
real problems for that class of project. For the projects we are building
— small-to-medium documentation sites, blogs, and content-heavy Nuxt sites
that should stay easy to author and deploy — v3 introduced more friction
than it removed:

- a native dependency (`better-sqlite3`) that regularly breaks across
  environments and versions
- tight coupling to Nuxt Studio as the intended authoring experience
- a more involved translation setup (collection per locale, manual
  fallback chains, manual slug mapping, manual language switching)
- a general complexity budget calibrated for large doc platforms

v2 solved several of these problems more simply, but v2 is frozen and
will not receive new work.

We need a path forward that preserves the parts of v2 and v3 we value
without inheriting the parts that make small sites painful.

## Decision

Fork the Nuxt Content codebase and ship it as **`@lupinum/ginko-content`**,
an independently maintained Nuxt module for filesystem-first,
provider-neutral content sites.

- Nuxt 4 is the minimum peer.
- We do not commit to v3 API parity.
- We do not commit to v2 API parity.
- We keep the parts of either that serve the target use cases and
  redesign the rest.
- The filesystem provider is the default production path.
- The provider contract is part of the architecture so future providers
  can serve the same public site APIs.
- Hard cutovers and major-version breaking changes are acceptable during
  pre-1.0.

## Alternatives considered

- **Adopt Nuxt Content v3.** Rejected. The native dependency situation,
  Studio coupling, and translation ergonomics are not acceptable for the
  target audience. See [ADR-0003](./0003-no-native-search-deps.md) and
  [ADR-0011](./0011-ide-first-no-studio.md).
- **Stay on Nuxt Content v2.** Rejected. v2 is frozen. We would own all
  bug fixes and Nuxt 4 compatibility work for an unmaintained upstream.
- **Build from scratch.** Rejected. Reusing v2/v3's parser, MDC
  integration, and component renderer saves a year of work and preserves
  the Vue-in-Markdown surface users expect.
- **Contribute simplifications back to v3.** Considered. Not mutually
  exclusive, but v3's direction is set for a different audience;
  upstream simplification is unlikely to be accepted, and we need to move
  faster than that process allows.

## Consequences

- We own a module and its maintenance burden, independent of upstream.
- We can break compatibility freely during pre-1.0 to land the right
  shape.
- Users on v3 who want what we offer must migrate; users on v2 have a
  forward-compatible path once we publish a migration guide.
- Future CMS-backed content should plug in as an external provider rather
  than turning this repository into a CMS product.
- Credit is due to the Nuxt team for the architectural groundwork we
  inherit. This fork is a divergence of goals, not a criticism of theirs.
