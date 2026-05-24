---
type: ADR
id: "0014"
title: "Keep MCP out of Ginko Core"
status: active
date: 2026-04-29
---

## Context

MCP can make sense for a CMS/admin product where agents can inspect drafts, prepare publish operations, explain visibility problems, or operate against an authenticated content backend.

Ginko Core does not have those runtime responsibilities. It is a Nuxt content engine whose default provider reads files and serves published website content. There is no core identity model, editor permission model, admin workflow, mutation API, or database-backed draft state.

## Decision

MCP is out of scope for this repository.

Core docs, ADRs, and package documentation should not teach MCP workflows as part of Ginko. If MCP becomes relevant, it belongs to a future CMS/admin/cloud layer where identity, permissions, database state, and editing operations actually exist.

## Alternatives considered

- **Expose MCP tools from Ginko Core.** Rejected. Filesystem content already lives in git and IDE workflows; adding MCP would create an admin surface without the security model it needs.
- **Keep MCP planning notes in core docs.** Rejected. It makes the current package look like a CMS/admin system when it is not.
- **Mention MCP only as future external work.** Accepted. That keeps the boundary honest without blocking future CMS work.

## Consequences

- MCP references should be removed from core docs unless they explicitly describe future external CMS/admin work.
- Provider APIs should not be shaped around agent operations.
- Any future MCP surface must come with its own product boundary, identity model, permission model, and ADRs in the relevant package.
