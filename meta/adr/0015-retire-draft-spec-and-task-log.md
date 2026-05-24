---
type: ADR
id: "0015"
title: "Retire draft specs and completed planning logs"
status: active
date: 2026-04-29
---

## Context

The repository carried long-lived planning documents such as `spec.md` and `todo.md`. They contained useful decisions, but also completed work history, future CMS details, MCP notes, and provider ideas that were easy to confuse with the current package contract.

That creates documentation drift: readers cannot tell whether a draft plan, an ADR, root docs, package docs, or implementation is authoritative.

## Decision

Durable decisions belong in root foundation docs and ADRs.

Completed task logs, superseded specs, and semi-authoritative planning documents should be deleted after their useful decisions are captured.

Current documentation authority order:

1. Implementation and tests.
2. Public package docs and docs app for user-facing API behavior.
3. Root foundation docs for project direction and architecture.
4. ADRs for accepted decisions.

## Alternatives considered

- **Keep old specs for historical context.** Rejected. Git already preserves history; stale files make active readers slower and less accurate.
- **Mark drafts as archived in place.** Rejected. It still leaves multiple sources in the working tree.
- **Rewrite the draft spec as the product contract.** Rejected for `spec.md`; provider/CMS details should be split between ADRs, architecture docs, and future provider docs.

## Consequences

- `spec.md`, `todo.md`, and the old `project-docs` wrapper can be removed once decisions are captured.
- Future large plans should either become ADRs/foundation docs or remain outside the repo until accepted.
- Cleanup should prefer fewer authoritative documents over a larger archive.
