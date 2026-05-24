---
type: ADR
id: "0017"
title: "CMS cache invalidation boundary"
status: active
date: 2026-05-02
---

## Context

Ginko Content is provider-neutral. A CMS-backed provider needs response cache
hints, authenticated revalidation, and platform cache adapters, but core must
not become a CMS runtime or host-specific cache implementation.

Vercel ISR, CDN cache tags, and runtime cache stores have different invalidation
capabilities. Some can purge tags directly. Others only support exact paths.

## Decision

Ginko Content exposes provider-neutral cache hints, request-local hint
collection, an authenticated revalidation endpoint, and a cache adapter
interface.

Providers may implement `invalidate()` for provider-owned caches and dependency
state. That method does not purge host caches by itself.

The configured cache adapter applies response caching and purges host/runtime
caches. Path-only adapters must reject unresolved tag-only invalidation.

CMS integrations are responsible for resolving changed content into canonical
tags and, when required by the host adapter, exact affected paths before calling
the site revalidation endpoint.

## Alternatives considered

- Put CMS dependency graph storage in Ginko Content core. Rejected because it
  would make core a CMS runtime and couple filesystem/content providers to CMS
  concepts.
- Make Vercel ISR the primary cache model. Rejected because Vercel is one host
  adapter, not the architecture.
- Allow tag-only invalidation to no-op on path-only hosts. Rejected because it
  reports success while stale content may remain public.

## Consequences

Core stays provider-neutral and host-neutral.

CMS providers must own dependency resolution and publish delivery.

The revalidation endpoint can safely call both the provider and adapter, but
success requires at least one layer to actually handle the request.
