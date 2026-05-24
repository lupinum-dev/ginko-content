---
type: ADR
id: "0011"
title: "IDE-first authoring, no Studio equivalent"
status: active
date: 2026-04-24
---

## Context

Nuxt Content v3 is tightly integrated with **Nuxt Studio**, a hosted
editor service for non-technical authors. Studio is a real product with
a real audience, and for teams that need it, v3 is a good fit.

That coupling carries architectural weight for users who do **not** use
Studio:

- a content API shaped for editor integration
- runtime mutation paths that only make sense with a live editor
- data model choices optimized for editor sync

Users on the simpler end (developers writing docs and blogs in an IDE)
pay this complexity tax without getting the benefit.

We need to be explicit about what kind of authoring experience we
support — because that choice shapes everything from the data model to
the public API.

## Decision

**Ginko Core is IDE-first. There is no Studio equivalent in this
repository, and we will not build one here.**

Target author experience:

- edit Markdown / MDC files in VS Code, JetBrains, Neovim, Zed, or any
  text editor
- commit to git, push, deploy — the same loop as code
- use the filesystem watcher for HMR during development
- benefit from IDE Markdown tooling (linting, previews, spell check)
  without us duplicating any of it

Out of scope:

- a browser-based WYSIWYG editor
- a hosted editor service
- a Studio integration
- a content API layer designed for editor round-trips
- user-management, roles, or permissions for authors
- a content mutation API at runtime
- MCP tools for content editing/admin workflows

## Alternatives considered

- **Ship a built-in minimal admin UI.** Rejected. The maintenance cost
  of a non-trivial editor is enormous; a minimal one serves no one
  well; and it pulls the data model toward editor concerns.
- **Integrate with Nuxt Studio.** Rejected. Studio is an excellent
  product, but integrating would re-introduce exactly the coupling we
  are moving away from.
- **Integrate with a third-party editor (TinaCMS, Decap, Keystatic).**
  Considered. Not blocked — users are free to add those on top of the
  filesystem — but we will not ship a built-in integration in core.
- **Defer this decision.** Rejected. The decision shapes the data
  model; leaving it undecided leaks "what if we add an editor later?"
  hooks into otherwise clean code.

## Consequences

- The data model can stay file-shaped. No editor-tree, no operational
  transforms, no live-mutation API.
- Non-technical authors are out of our target audience. That is a clear
  product stance, not an accident.
- Contributors can build editor integrations on top of the filesystem
  driver as separate packages; we will accept sensible extension points
  into `src/storage/driver.ts` when they appear.
- Our docs, tutorials, and examples assume an IDE. That stays true for
  screenshots, quickstarts, and migration guides.
- This decision makes the fork meaningfully different from v3. It is
  not "v3 minus SQLite"; it is a different product aimed at a different
  author.
- A future Ginko CMS can provide browser editing and admin workflows as a
  separate provider/product. That future does not change the core
  repository boundary.
