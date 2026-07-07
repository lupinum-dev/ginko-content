# Vision

Ginko is a filesystem-first, provider-neutral content engine for Nuxt.

It gives Nuxt sites a polished Markdown workflow for pages, blogs, documentation, search, and multilingual content while keeping the core open for future content providers. The default experience is files in `content/`, edited in an IDE and versioned in git. The architecture also exposes a provider contract so a future CMS, database, or company-specific content backend can serve the same public website APIs without rewriting app pages.

## Who It Is For

Ginko is for teams building content-heavy Nuxt sites:

- documentation sites
- blogs
- marketing sites with structured Markdown
- multilingual pages and guides
- small-to-medium content projects that want a simple deploy story

The filesystem workflow should feel best for a few hundred documents and remain reasonable up to around 2,000 Markdown documents, depending on content size, translations, search settings, and deployment shape. Above that, the provider contract, a CMS-backed provider, or a dedicated external search service becomes more appropriate than pushing the local filesystem model indefinitely.

## Authoring Model

Ginko core is IDE-first.

Authors write Markdown, MDC, YAML, JSON, or CSV files in the repository. Git is the editorial history. Branches are draft environments. Nuxt dev mode watches the filesystem and updates the runtime.

The core package does not include a browser editor, Studio, admin panel, role system, file-upload workflow, or runtime content mutation API. Those belong to a future external CMS product or provider, not to this repository.

## Product Boundary

The current repository owns:

- Ginko Core: the provider-neutral Nuxt content engine
- the filesystem provider: the default Markdown/filesystem source
- public composables, server helpers, rendering components, search, i18n, navigation, and sitemap integration
- the provider contract used by external content sources

The current repository does not own:

- Ginko CMS as a product
- Studio or admin UI
- MCP workflows for editing content
- database-backed editorial state
- client/user permissions for content editing
- real-time collaborative editing

A future Ginko CMS can be built separately on top of the provider contract, likely with its own app, database, uploads, identity, permissions, and agent/admin workflows.

## Relationship To Nuxt Content

Ginko is inspired by Nuxt Content and keeps familiar concepts where they serve the target use case: `content.config.ts`, collections, Markdown/MDC rendering, content routes, and query helpers.

It is not a drop-in clone of every Nuxt Content v2 or v3 behavior. Ginko chooses a narrower product shape:

- collections are the public query boundary
- i18n is foundational, not a late add-on
- search avoids native runtime databases
- sitemap output integrates with Nuxt SEO rather than generating XML itself
- the public API is smaller and more explicit
- provider support is architectural, but filesystem content remains the default path

## What We Optimize For

Ginko optimizes for:

- fast installation with no native database dependency
- explicit collection-backed querying
- route-aware page loading through `useContentPage`
- typed content through Zod-backed collections
- coherent multilingual content with fallback and translated-slug support
- search that works for generated and server-rendered sites
- provider-neutral internals without exposing provider complexity to beginners

## What We Refuse

Ginko core should not become:

- a CMS UI
- a hosted Studio product
- a generic enterprise content platform
- a full-text search backend
- a database-first content system
- a bag of compatibility shims for every Nuxt Content behavior
- a place for MCP/admin/editor workflows

When a project needs browser-based editing, draft/publish workflows, uploads, live collaboration, content permissions, or client-friendly content operations, that is a signal for a separate CMS-backed provider or product.

## Stability

Ginko still allows hard cutovers when the foundation is wrong. The project prefers clear, durable APIs over compatibility glue.

The public contract should be obvious:

- app code uses composables, rendering components, and server helpers
- content model code uses `content.config.ts`
- providers implement the provider contract
- internals can change when that improves the core

Everything else is negotiable.
