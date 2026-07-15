# Routing, Rendering, Navigation, And I18n

Use this for route-backed pages, locale behavior, translated slugs, language switching, navigation, and content rendering.

## Preferred Page API

Use `useContentPage(handle, options)` for route-backed pages. It resolves the active route, locale, and fallback state through the unified query workflow, owns SSR payload integration, route watching, stable keying, and stale-page flash suppression. It does not throw a default 404, does not mutate `<head>`, and does not execute redirects — the app decides that policy from `route.requestedPath`/`route.resolvedPath`.

```vue
<script setup lang="ts">
import { createError, useContentPage } from '#imports'
import { docs } from '~/content.config'

const { page, status, error } = await useContentPage(docs, {
  fallback: true
})

if (import.meta.server && !page.value) {
  throw createError({ statusCode: 404, statusMessage: 'Document not found' })
}
</script>

<template>
  <ContentRenderer v-if="page" :value="page" />
</template>
```

Use lower-level query functions (`one`, `many`, `paginate`, `resolveOne`, `surround`, `backlinks`, `navigation`) paired with `useAsyncData` when the page is not route-backed or the UI is intentionally listing/filtering content.

## Route And Locale Helpers

- `page.route.alternates`: labeled locale-switch contract (`source: 'variant' | 'fallback'`, with `resolvedLocale` on fallback entries) for resolved route-backed documents — the replacement for the deleted `useContentSwitchLocalePath`.
- `navigation(handle, options)` (with `useAsyncData`): normalized navigation tree for a collection.
- `useContentPage(handle, { surround: true })` or `surround(handle, options)`: previous/next entries around a route-backed document.
- `querySiteData(options?)`: site-level content data.
- `extractContentToc`: table of contents helper (pure function; no composable wrapper).

## Locale Source Of Truth

When `@nuxtjs/i18n` is installed, Nuxt i18n is the locale source of truth for locales, default locale, and route strategy. Ginko adds content-specific behavior on top:

- fallback chains
- translated slug mode
- strict translated-slug validation
- collection-level i18n opt-in
- canonical identity for variant matching

Content-only localization (no `@nuxtjs/i18n` installed) is a supported mode, not a degraded fallback: declare locales, a default locale, and per-collection `i18n` entirely through `content.i18n` in `nuxt.config.ts`. See ADR-0007.

Do not implement language switching by string prefix replacement. Use canonical identity and the public route helpers.

## Variant And Fallback Rules

- A variant is one locale's version of a canonical document.
- Single-document page resolution is locale-aware and can fall back by default.
- List queries do not mix fallback locales by default.
- Route-less server contexts have no hidden ambient locale.
- Shared-slug and translated-slug modes both resolve through canonical identity.

If a task changes fallback behavior, inspect both runtime route code and contract tests. Locale behavior is central, not an edge case.

## Filesystem Routing Concepts

The filesystem provider owns:

- file and folder routing
- `.navigation.yml`
- `index.md` folder metadata
- numeric ordering prefixes
- draft and partial conventions
- translated-slug numeric-prefix identity

These concepts shape filesystem behavior, but they are not mandatory requirements for all future providers.

## Rendering

Content rendering supports Markdown/MDC and Vue components in markdown. Use `ContentRenderer` for block rendering and `ContentRendererInline` for inline rendering. User-defined content components belong in `components/content`.

Avoid pushing renderer internals into app examples. Keep docs centered on public components and composables.

## Navigation

Navigation is normalized provider output. Filesystem navigation derives from files, numeric prefixes, `index.md`, and `.navigation.yml`; external providers may map CMS route/navigation records into the same normalized tree.

Apps should consume normalized navigation, not provider-native metadata.

## Where To Verify

- `test/contracts/use-content-page-contracts.test.ts`
- `test/contracts/navigation-contracts.test.ts`
- `test/contracts/navigation-tree-contracts.test.ts`
- `test/contracts/locale-manifest.test.ts`
- `test/contracts/render-components-contracts.test.ts`
- `internal/nuxt-integration-sitemap-i18n.md`
