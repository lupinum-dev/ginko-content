---
type: ADR
id: "0009"
title: "Sitemap ownership split with `@nuxtjs/sitemap`"
status: active
date: 2026-04-24
---

## Context

A sitemap has several moving parts:

- enumerating the URLs to include
- attaching hreflang alternates for localized URLs
- splitting into per-locale sitemap files
- generating the XML
- emitting a sitemap index
- wiring into `robots.txt`

`@nuxtjs/sitemap` (part of Nuxt SEO) already does all of that well, is
actively maintained, and is what most Nuxt sites are already using.

A content module can either duplicate this work (and diverge from
`@nuxtjs/sitemap` over time) or integrate with it cleanly.

## Decision

**`@nuxtjs/sitemap` owns sitemap generation. Ginko owns the content
sources.**

Concretely:

- The module auto-registers a **sitemap source** with `@nuxtjs/sitemap`
  when `content.sitemap` is enabled.
- The source enumerates content-backed routes, with hreflang alternates
  derived from the locale variant resolver.
- `@nuxtjs/sitemap` does the XML, the locale splitting, the index, the
  hreflang rendering, the robots wiring.

Recommended setup:

```ts
export default defineNuxtConfig({
  modules: [
    '@nuxtjs/sitemap',
    '@lupinum/ginko-content'
  ],
  content: {
    sitemap: true
  }
})
```

Rules:

- Content-routed collections are eligible by default.
- `content.sitemap.include` and `content.sitemap.exclude` are escape
  hatches.
- Drafts are excluded from sitemap in production by default
  (`content.sitemap.includeDrafts` to override).
- Standard Nuxt `pages/` routes stay owned by Nuxt SEO's app sources.
- Content-backed routes stay owned by the content sitemap source.
- `content.sitemap` (including per-collection/per-document `sitemap: false`
  and `includeDrafts`) governs **sitemap inclusion only**. It never changes
  which routes are enumerated for prerender/static generation — sitemap
  policy and prerender policy are separate concerns with separate config.
- `queryCollectionsSitemapEntries` (server surface) is the supported way to
  build a custom sitemap/robots endpoint against content data directly, for
  apps that do not want the `@nuxtjs/sitemap` auto-registration path. It
  returns entry data; it does not render XML.

## Alternatives considered

- **Generate our own sitemap XML.** Rejected. Duplicates work, drifts
  from Nuxt SEO, surprises users with a second tool producing sitemaps.
- **Force users to hand-wire a sitemap source per app.** Rejected. The
  whole point is sensible defaults; auto-registration is the right
  default.
- **App-local localized sitemap alias routes.** Explicitly a non-goal.
  Alternates go through `@nuxtjs/sitemap` hreflang.
- **Require Nuxt SEO as a hard peer dep.** Rejected. Sites without
  sitemaps should not have to install it.

## Consequences

- `@nuxtjs/sitemap` is an optional peer that users install when they
  want sitemaps.
- Users do not configure content URLs in two places.
- Content-aware hreflang "just works" once both modules are installed.
- Changes in `@nuxtjs/sitemap`'s source API may require adjustments; we
  accept that coupling as the price of not reimplementing the feature.
