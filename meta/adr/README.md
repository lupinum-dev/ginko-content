# Architecture Decision Records

Each ADR captures one decision: the context that forced it, the option we
picked, the alternatives we turned down, and the consequences we accept.

ADRs are immutable once merged. If a decision is reversed, write a new
ADR that supersedes the old one; do not rewrite history.

## Index

| ID    | Title                                                                                                 | Status |
|-------|-------------------------------------------------------------------------------------------------------|--------|
| 0001  | [Fork Nuxt Content as "Ginko"](./0001-fork-from-nuxt-content.md)                                      | active |
| 0002  | [Target small-to-medium content sites](./0002-target-small-to-medium-content-sites.md)                 | active |
| 0003  | [No native search deps — JSON + Pagefind](./0003-no-native-search-deps.md)                             | active |
| 0004  | [Filesystem provider uses files as the source of truth](./0004-filesystem-source-of-truth.md)          | active |
| 0005  | [Collection-first public query surface](./0005-collection-first-public-query-surface.md)               | superseded by 0016 |
| 0006  | [Locale-agnostic canonical identity](./0006-locale-agnostic-canonical-identity.md)                     | active |
| 0007  | [`@nuxtjs/i18n` as the locale source of truth](./0007-nuxt-i18n-as-locale-source-of-truth.md)          | active |
| 0008  | [Translated slugs via numeric-prefix identity](./0008-translated-slugs-via-numeric-prefix.md)          | active |
| 0009  | [Sitemap ownership split with `@nuxtjs/sitemap`](./0009-sitemap-ownership-split.md)                    | active |
| 0010  | [Layered source architecture](./0010-layered-source-architecture.md)                                   | active |
| 0011  | [IDE-first authoring, no Studio equivalent](./0011-ide-first-no-studio.md)                             | active |
| 0012  | [Provider-neutral core with filesystem as the default provider](./0012-provider-neutral-core-filesystem-default.md) | active |
| 0013  | [Keep Ginko CMS outside the core repository](./0013-keep-cms-outside-core.md)                          | active |
| 0014  | [Keep MCP out of Ginko Core](./0014-keep-mcp-out-of-core.md)                                           | active |
| 0015  | [Retire draft specs and completed planning logs](./0015-retire-draft-spec-and-task-log.md)             | active |
| 0016  | [Unified query API](./0016-unified-query-api.md)                                                       | active |
| 0017  | [CMS cache invalidation boundary](./0017-cms-cache-invalidation-boundary.md)                           | active |
| 0018  | [Classify public surfaces by audience](./0018-public-surface-classification.md)                        | active |

## Format

```
---
type: ADR
id: "NNNN"
title: "short title"
status: active | superseded | deprecated
date: YYYY-MM-DD
---

## Context
## Decision
## Alternatives considered
## Consequences
```
