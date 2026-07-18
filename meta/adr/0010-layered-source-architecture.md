---
type: ADR
id: "0010"
title: "Layered source architecture"
status: active
date: 2026-04-24
---

## Context

Nuxt module setup, Nitro handlers, Vue composables, filesystem storage, and
content-domain behavior have different dependencies and change for different
reasons. Mixing them makes pure behavior hard to test and encourages framework
or provider details to leak into the public contract.

## Decision

Organize package source by dependency layer with direction toward the domain:

- `types` defines shared types.
- `core` owns pure content, query, and validation primitives.
- `features` composes framework-free product behavior from core.
- `parsers` owns format entry points.
- `storage` owns filesystem-provider state, manifests, and validation input.
- `integrations` binds domain behavior to Nitro and Vue.
- `module` owns Nuxt build-time setup.
- `runtime` contains thin Nuxt, Nitro, and Vue entry points.
- `public` contains package export facades.
- dedicated `cms-contract`, `portability`, `portability-node`, `cli`, and
  `testing` directories own their explicitly bounded public purposes.

The maintained directory map and allowed edges live in
[`meta/ARCHITECTURE.md`](../ARCHITECTURE.md). Executable architecture tests
enforce the important prohibitions:

- `core` does not import `runtime`, `features`, Nuxt, Nitro, Vue, or H3.
- `features` and `storage` do not import `runtime`.
- runtime and transport entry points do not become homes for domain logic.
- generic utility directories do not hide domain behavior.

The public export map is a compatibility seam, not permission for public
facades to duplicate implementations.

## Alternatives considered

- Keep all implementation under one `runtime` directory. Rejected because it
  obscures framework boundaries and makes pure tests depend on Nuxt.
- Organize only by product feature. Rejected because query, localization, and
  navigation each span pure behavior and framework bindings.
- Rely on conventions without executable checks. Rejected because dependency
  drift is cheap to introduce and expensive to unwind.

## Consequences

- Domain behavior can be tested without starting Nuxt.
- Framework upgrades concentrate in integration and runtime layers.
- Filesystem-specific behavior stays out of the provider-neutral contract.
- New top-level source homes require a concrete ownership boundary and an
  architecture update, not speculative future flexibility.
