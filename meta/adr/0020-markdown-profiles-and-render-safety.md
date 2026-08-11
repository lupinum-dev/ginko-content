---
type: ADR
id: "0020"
title: "Markdown profiles and closed render safety"
status: active
date: 2026-08-11
---

## Context

Ginko accepts Markdown from three boundaries with different trust, lifecycle,
and bundling constraints:

- application-owned filesystem content is parsed during the Nuxt/Nitro build;
- CMS and portable content must remain deterministic outside an application;
- inline content is parsed in a Vue runtime that may execute during SSR and in a
  browser.

Treating those boundaries as one configurable parser created accidental promises.
Build-time plugin specifiers cannot safely become arbitrary browser imports, while
silently parsing CMS content with application configuration would make a portable
document depend on an unrelated Nuxt application. At the same time, Comark emits
typed tuple nodes that must pass Ginko's object-AST safety policy before Vue can
render them. Parser support without policy support is not a supported feature.

## Decision

Ginko owns one canonical tuple-to-object normalization boundary and three named
Markdown profiles.

### Filesystem configured profile

Filesystem ingestion uses the plugins resolved from `content.markdown.plugins`
at build time. Nuxt module setup validates the configuration, and generated
server parser code imports every enabled plugin through statically analyzable
literal imports. This profile may use server/build-only integrations such as
Shiki, Math, Mermaid, TOC, summary, and footnotes.

### Portable baseline profile

CMS parsing and portability use a fixed, framework-free baseline owned by the
package version. They do not load application Nuxt plugin specifiers. A portable
document is valid only when parsing, canonical normalization, public validation,
serialization, and reparse agree under this profile and the declared component
policy.

The CMS contract version identifies the JSON wire schema. Ginko does not add a
second public parser-profile version until an external negotiation requirement
exists; package semver and the conformance corpus govern baseline changes.

### Inline client-safe profile

`ContentRendererInline` uses a fixed client-safe baseline. It supports SSR,
hydration, and reactive updates but does not promise parity with arbitrary
build-time plugins. Its renderer registry is generated from literal imports for
the client-safe integrations Ginko explicitly supports. It never evaluates a
server module specifier received through public runtime config.

### Closed parser-to-render contract

A syntax is supported only when all of these stages agree:

1. the owning profile parses it;
2. canonical normalization converts parser-owned tuples and metadata into the
   inert public object AST;
3. public and portable policies accept only the exact generated shape;
4. Vue SSR and hydration render the normalized shape without bypassing policy;
5. agent serialization neither exposes inert parser data nor loses meaningful
   content;
6. stringify and reparse preserve portable semantics where portability applies.

Safety allowances are structural and exact, not tag-wide escapes:

- task inputs are limited to the disabled checkbox shape emitted by Comark;
- named-slot templates are valid only as direct children of a declared component
  and only for slot names in that component's policy;
- table alignment permits only parser-owned left, center, and right alignment;
- code metadata permits only the documented inert language, filename, highlight,
  and meta representation;
- Math and Mermaid are accepted only through their registered parser-owned
  components and never authorize arbitrary MathML, SVG, directives, or events;
- arbitrary `input`, `template`, `style`, active HTML, Vue bindings, directives,
  and event props remain rejected.

Recognized summary behavior is consumed by the summary plugin. Every other Comark
comment tuple is removed during canonical normalization. Comments never become a
tagless element and never reach Vue, search text, portable output, or agent text.

Ginko retains its typed component-frontmatter normalization until upstream Comark
can preserve boolean, number, array, and object YAML values through the same
contract. The shim is protected by conformance tests and is not a second parser.

`markdown.plugins` has no hidden plugins. Its default is the empty list. `shiki`
is the canonical highlighting plugin name; `highlight` is only a setup-time
deprecated alias during the `0.4.x` compatibility line. Invalid option spellings
fail setup rather than being ignored.

Normalized AST changes bump the content cache version. Raw Comark snapshots and
Ginko pipeline snapshots are kept separate so dependency upgrades can distinguish
upstream parser changes from changes to Ginko normalization or policy.

## Alternatives considered

- **Use the application-configured profile everywhere.** Rejected because CMS and
  portable results would depend on a Nuxt app and could execute untrusted module
  specifiers.
- **Expose arbitrary inline plugins through public runtime config.** Rejected
  because serialized configuration cannot carry functions and browsers cannot
  resolve variable bare-package imports safely.
- **Use Comark's Vue renderer as the public boundary.** Rejected because Ginko's
  provider-neutral object AST, component policy, portable contract, and agent
  output require one Ginko-owned inert representation.
- **Allow every HTML shape emitted by the parser.** Rejected because a parser is
  not a security policy and authored active nodes can share tag names with safe
  parser output.
- **Maintain separate normalizers for filesystem, CMS, portability, and inline.**
  Rejected because they would drift and make support status boundary-dependent.

## Consequences

- Plugin enablement and browser bundling become explicit build artifacts.
- CMS and portable output remain deterministic and framework-free.
- Inline rendering has a smaller, truthful contract than filesystem ingestion.
- Adding or upgrading a syntax requires updating the conformance row and reviewing
  raw, normalized, policy, SSR, agent, and portable evidence together.
- Some currently advertised syntax remains rejected until its exact generated
  shape is normalized and allowlisted. Tests record those gaps without weakening
  the safety boundary.
- Cache invalidation is required whenever normalized AST meaning changes.
