---
type: ADR
id: "0012"
title: "Provider-neutral core with filesystem as the default provider"
status: active
date: 2026-04-29
---

## Context

Ginko began from the need for a simpler filesystem content workflow, but the implementation now has a real provider boundary:

- `content.config.ts` can select a provider and register external providers.
- `getContentProvider(event)` selects the active provider.
- public server helpers dispatch through the provider contract.
- providers declare capabilities and fail unsupported operations with typed provider errors.
- filesystem and mock provider conformance tests exercise the same contract.

The docs must not describe Ginko as only a filesystem-specific runtime when the core is already provider-neutral. At the same time, beginner users should not need to learn provider theory before rendering Markdown.

## Decision

Ginko Core is provider-neutral. The filesystem provider is the default and first-class provider today.

The public product positioning should be: **filesystem-first, provider-neutral content engine for Nuxt**.

Provider architecture is first-class:

- provider selection is config-driven
- provider capabilities are runtime truth
- API handlers dispatch through provider methods
- unsupported behavior fails with typed provider errors
- external providers implement the same website-shaped contract

Product focus remains filesystem-first:

- beginner docs teach files in `content/`
- examples and playgrounds use the filesystem provider by default
- the built-in provider receives the primary maintenance focus
- custom providers are advanced integration work, not the default on-ramp

## Alternatives considered

- **Position Ginko as filesystem-only.** Rejected. It contradicts the implemented provider contract and would make future CMS/database providers look like hacks.
- **Position providers as the main product story.** Rejected. It would obscure the useful thing users can do today: ship Markdown-backed Nuxt sites.
- **Hide providers as private internals.** Rejected. The contract is already exported and tested; pretending it is private creates worse drift.

## Consequences

- Root docs and ADRs distinguish Ginko Core, the filesystem provider, and future providers.
- Public docs introduce providers late, in advanced/reference material.
- Provider work must preserve filesystem ergonomics.
- New provider-facing APIs need conformance tests and capability/error semantics.
