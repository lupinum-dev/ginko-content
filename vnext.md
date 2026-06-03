# Ginko Content vNext: Explicit Content API, Provider Harmony, Agent-Friendly DX

## Summary

Ginko Content vNext is one large quality, DX, and API design pass.

The goal is not to add more abstraction. The goal is to make Ginko Content feel like the better Nuxt Content: easy to start, explicit enough to reason about, hard to misuse, powerful when needed, and predictable for humans and coding agents.

The public product model is:

- Ginko Content is the public Nuxt content API.
- Filesystem content and CMS content are providers underneath the same API.
- `content.config.ts` is the source of truth for collections, schemas, references, and provider selection.
- `nuxt.config.ts` is the source of truth for runtime behavior such as i18n, sitemap, search, markdown, cache, and provider runtime options.
- `@nuxtjs/i18n` owns Nuxt route/runtime locale behavior when installed.
- `@nuxtjs/sitemap` owns sitemap XML generation when installed.
- Ginko Content contributes content route metadata, search records, navigation, surrounding links, page head data, and sitemap entries.

This pass intentionally avoids compatibility layers, duplicate APIs, and hidden magic. Defaults should be nice, but the source of truth must always be visible.

## Non-Goals

- Do not make Ginko Content an i18n framework.
- Do not make Ginko Content a sitemap XML generator when Nuxt Sitemap is present.
- Do not add i18next, vue-i18n-only, or generic translation-provider abstractions.
- Do not add CMS-specific app APIs.
- Do not add shadcn, Nuxt UI, or app-header components to core.
- Do not add dual paths, shims, or soft compatibility routes for unreleased API drift.
- Do not keep consumer workarounds as accepted patterns.
- Do not add public hooks unless a concrete extension need cannot be solved with config, providers, or composables.

## Design Principles

### One Source Per Concept

Every important concept has one owner.

| Concept | Source of truth |
| --- | --- |
| Collection identity | `content.config.ts` `collections` key |
| Collection schema | `content.config.ts` collection `schema` |
| Cross-document references | `fields.relation()`, `fields.relations()`, or explicit `reference()` metadata |
| Provider selection | `content.config.ts` |
| Provider runtime options | `nuxt.config.ts` `content.provider` / provider module options |
| Nuxt route/runtime locale | `@nuxtjs/i18n` when installed |
| Content fallback policy | `nuxt.config.ts` `content.i18n` |
| CMS publishable locales | CMS configuration / CMS module options |
| Sitemap XML | `@nuxtjs/sitemap` |
| Sitemap content entries | Ginko Content provider |
| Search source records | Ginko Content provider |
| Search UI chrome | Consumer app or UI recipe |

If two places can configure the same concept, vNext must either delete one path or define strict precedence with diagnostics.

### Explicit Defaults

Defaults are allowed when they are visible and inspectable.

Good default:

```ts
const { page } = await useContentPage('docs')
```

Why this is acceptable:

- `docs` is an explicit collection identity.
- The current route is explicit Nuxt context.
- The collection route mount is defined in `content.config.ts`.
- The active locale comes from `@nuxtjs/i18n` when installed.
- The result publishes `path`, `canonicalPath`, `locale`, `localePaths`, and `resolved` metadata.

Bad default:

```ts
const posts = await useContentBacklinks('authors', { from: 'posts' })
```

This is only acceptable if the source schema explicitly declares which fields reference `authors`. Otherwise Ginko must fail and ask for `fields`.

### Agent-Friendly APIs

Agents need APIs that are hard to misuse without reading every implementation detail.

vNext should optimize for:

- literal collection names instead of imported app-local symbols in page code;
- generated types that make invalid collection names fail;
- schema metadata that removes guesswork from references;
- diagnostics that include file/config source, expected value, actual value, and the exact fix;
- no hidden compatibility behavior that makes tests pass while production routes drift;
- no consumer-specific code paths in core.

Agents should be able to infer the correct usage from the function name, argument names, and error message.

## Target User Experience

### Minimal Filesystem App

```ts
// content.config.ts
import { defineCollection, defineContentConfig, fields } from '@lupinum/ginko-content/config'

export default defineContentConfig({
  collections: {
    docs: defineCollection({
      type: 'page',
      source: 'docs/**/*.md',
      pathPrefix: '/docs',
      schema: {
        title: fields.text().required(),
        description: fields.text()
      }
    })
  }
})
```

```vue
<!-- pages/docs/[...slug].vue -->
<script setup lang="ts">
const { page, previous, next } = await useContentPage('docs', {
  surround: true
})
</script>

<template>
  <ContentRenderer v-if="page" :value="page" />
</template>
```

No app page imports `content.config.ts`.

### Same App With CMS Provider

```ts
// content.config.ts
import { defineCollection, defineContentConfig, fields } from '@lupinum/ginko-content/config'

export default defineContentConfig({
  provider: 'cms',
  collections: {
    docs: defineCollection({
      type: 'page',
      source: 'docs/**/*.md',
      pathPrefix: '/docs',
      schema: {
        title: fields.text().required(),
        description: fields.text()
      }
    })
  }
})
```

The page code does not change.

### Localized App

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: [
    '@nuxtjs/i18n',
    '@lupinum/ginko-content',
    '@nuxtjs/sitemap'
  ],

  i18n: {
    defaultLocale: 'en',
    locales: [
      { code: 'en', language: 'en-US', name: 'English' },
      { code: 'de', language: 'de-DE', name: 'Deutsch' }
    ]
  },

  content: {
    i18n: {
      fallbackLocale: 'en'
    },
    sitemap: true
  }
})
```

```vue
<script setup lang="ts">
const { page } = await useContentPage('docs')
const switchLocalePath = useSwitchLocalePath()

const switchTo = (locale: string) =>
  page.value?.localePaths?.[locale]?.path ?? switchLocalePath(locale)
</script>
```

Ginko publishes content-aware locale paths. Nuxt i18n still owns locale switching and route behavior.

### References And Backlinks

```ts
// content.config.ts
export default defineContentConfig({
  collections: {
    authors: defineCollection({
      type: 'page',
      source: 'authors/**/*.md',
      pathPrefix: '/authors',
      schema: {
        name: fields.text().required()
      }
    }),

    posts: defineCollection({
      type: 'page',
      source: 'blog/**/*.md',
      pathPrefix: '/blog',
      schema: {
        title: fields.text().required(),
        authors: fields.relations('authors')
      }
    })
  }
})
```

```ts
const { page: author } = await useContentPage('authors')

const { data: posts } = await useContentBacklinks('authors', {
  from: 'posts',
  target: author
})
```

Ginko infers `posts.authors` from schema metadata. If the schema does not declare a relation to `authors`, Ginko fails with:

```txt
Cannot infer backlink fields from "posts" to "authors".
Declare fields.relation('authors') / fields.relations('authors') in posts.schema,
or pass fields: ['authors'] explicitly.
```

## Big Bang Change Set

## 1. Canonical Collection Identity

### Current Problem

The dream API uses string collection names, but some docs and examples still rely on imported collection handles. That creates friction for agents because app page code needs to understand local file exports before it can call Ginko APIs.

### Change

Make string collection names the primary public app API.

Primary:

```ts
await useContentPage('docs')
await useContentMany('posts')
await useContentNavigation('docs')
await useContentSearchData('docs')
```

Allowed advanced form:

```ts
import { docs } from '#content/collections'

await useContentPage(docs)
```

Local `~/content.config` imports in page components should be removed from beginner docs and consumers.

### Implementation Tasks

- Ensure the generated collection map gives literal string APIs full type inference.
- Keep collection key as canonical identity.
- Update README and docs to teach string names first.
- Keep generated handles as optional advanced DX, not the core story.
- Add type tests for invalid collection names.

### Acceptance Criteria

- `useContentPage('docs')` is fully typed.
- Invalid collection names fail TypeScript where possible.
- Beginner docs do not import collection handles from `~/content.config`.
- Consumer apps no longer need app-local collection imports for normal route pages.

## 2. Schema-Driven References

### Current Problem

Backlinks require callers to pass reference fields manually in common cases. That is explicit, but it repeats information that already belongs in the schema.

### Change

Use schema relation metadata as the source of truth for reference fields.

`fields.relation('authors')`, `fields.relations('authors')`, and lower-level `reference('authors')` should feed a generated reference manifest.

The manifest should answer:

- which source collections reference a target collection;
- which fields contain the reference;
- whether the reference is single or many;
- whether the relation is localized;
- whether the relation can be populated.

### Implementation Tasks

- Build a reference manifest from `content.config.ts`.
- Use the manifest in `backlinks()` and `useContentBacklinks()`.
- Use the manifest in `populate` validation.
- Add clear errors for ambiguous or missing relation metadata.
- Keep explicit `fields` as an escape hatch.

### Acceptance Criteria

- `useContentBacklinks('authors', { from: 'posts' })` works when `posts.schema` declares a relation to `authors`.
- Missing metadata fails with an actionable error.
- Multiple possible fields are allowed only when all declared fields are valid; otherwise callers can narrow with `fields`.
- Consumer author pages remove `fields: ['authors']`.

## 3. Populate API Hardening

### Current Problem

Populate is powerful, but it can become stringly typed and easy to misuse.

### Change

Keep the explicit object syntax as the primary API:

```ts
const { page } = await useContentPage('posts', {
  populate: {
    authors: 'authors'
  }
})
```

Do not add array shorthand in this pass.

The schema relation manifest should validate that `authors` is a relation field pointing to the `authors` collection.

### Implementation Tasks

- Validate populate source field against the reference manifest.
- Type populate result fields from the target collection.
- Emit diagnostics when populate target does not match relation metadata.

### Acceptance Criteria

- Incorrect populate targets fail before runtime surprises.
- Consumer code does not need `as unknown as BlogPost[]` style casts for populated author/post data.

## 4. Locale Ownership Cleanup

### Current Problem

Locale state can be misunderstood because Nuxt i18n, Ginko content fallback, collection i18n flags, and CMS publish locales all exist in the same app.

### Change

Document and enforce the ownership table:

| Concern | Owner |
| --- | --- |
| Current Nuxt locale | `@nuxtjs/i18n` |
| Localized routes | `@nuxtjs/i18n` plus Ginko route metadata |
| Content fallback | `content.i18n` |
| Collection localization opt-in | collection config |
| CMS publishable locales | CMS config |
| Content locale switch targets | `page.localePaths` |

Ginko should not silently invent localized routes. If a localized route is missing, the result must say whether it is exact, fallback, or unavailable.

### Implementation Tasks

- Audit all locale resolution paths.
- Keep route-time locale resolution explicit.
- Keep route-less server calls requiring explicit locale for localized collections.
- Add mismatch diagnostics between Nuxt i18n locales and content locales.
- Remove contradictory docs around content locale switch helpers.

### Acceptance Criteria

- Locale precedence is documented in one table.
- Missing locale route, fallback locale, and exact locale are distinguishable in result metadata.
- Consumers do not branch on raw locale codes to build content URLs.

## 5. Route And Locale Switching Contract

### Current Problem

`page.localePaths` is the right public content contract, but helper exports and docs can drift.

### Change

Use this public contract:

- `useContentPage()` publishes `page.localePaths`.
- Consumers use `page.localePaths[locale]?.path` when they need the content-aware target.
- Consumers use Nuxt i18n `switchLocalePath(locale)` as fallback.

If a Ginko helper remains, it must be documented as a tiny wrapper over that exact behavior.

### Implementation Tasks

- Decide whether `useContentSwitchLocalePath()` remains public.
- If it remains, document it and test it.
- If it does not remain, remove public docs/exports and keep internal publisher only.
- Add tests for locale switching on translated slugs.

### Acceptance Criteria

- ADR, docs, runtime exports, and generated types agree.
- Locale switching works for translated docs routes.
- No second locale-switch source of truth exists in consumers.

## 6. Provider Contract vNext

### Current Problem

The provider interface supports capabilities, but conformance testing is too close to the filesystem provider. CMS intentionally does not support every filesystem capability.

### Change

Split provider conformance into capability tiers.

Required base tier:

- provider metadata;
- explicit capabilities;
- collection query;
- page resolution for route-backed collections;
- typed provider errors;
- cache hints when available.

Optional tiers:

- localized routes;
- navigation;
- surroundings;
- search sections;
- provider search;
- sitemap entries;
- count queries;
- numeric skip;
- draft/published modes.

### Implementation Tasks

- Refactor provider contract tests by capability.
- Make tests assert unsupported operations fail clearly.
- Run the same suite against filesystem and CMS providers.
- Keep CMS provider website-shaped, not database-shaped.

### Acceptance Criteria

- Filesystem provider passes all filesystem-supported tiers.
- CMS provider passes every tier it claims.
- CMS provider is not required to expose `searchSections` if it provides its own search engine.
- Unsupported provider operations never fail as vague runtime exceptions.

## 7. Sitemap Contract Cleanup

### Current Problem

Sitemap behavior is one of the easiest places for consumers and agents to paper over config drift with `routeRules`, `nitro.prerender.ignore`, or hardcoded generated paths.

### Change

Ginko must respect Nuxt Sitemap mode instead of assuming a child-sitemap topology.

Single sitemap mode:

- prerender `/sitemap.xml`;
- assert root urlset;
- do not require child locale sitemaps.

I18n multi-sitemap mode:

- prerender sitemap index and child sitemaps;
- assert children are present and non-empty;
- report which sitemap URL should be submitted.

### Implementation Tasks

- Fix sitemap prerender route discovery.
- Add mode-aware sitemap assertions.
- Add exact path assertions.
- Add forbidden path assertions.
- Warn on placeholder or suspicious site URLs in production-like builds.

### Acceptance Criteria

- Consumer apps do not need sitemap `ignore` workarounds.
- Required public content URLs are asserted exactly.
- `_payload`, `_nuxt`, `_og`, API, auth-only, admin, and malformed duplicate URLs are forbidden by default or easy to assert.
- Sitemap diagnostics name the mode, generated files, expected routes, and missing routes.

## 8. Search API Clarity

### Current Problem

Search has two valid shapes:

- headless content search;
- UI-shaped search data for Nuxt UI command/search components.

Those should be explicit so consumers do not confuse data preparation with UI behavior.

### Change

Keep two APIs:

```ts
await useContentSearch('docs')
await useContentSearchData('docs')
```

`useContentSearch()` is headless.

`useContentSearchData()` prepares structured data for UI search integrations.

Ginko may provide Nuxt UI recipes or tiny mappers, but not application search chrome.

### Implementation Tasks

- Document the difference between headless search and UI search data.
- Ensure search result routes always use provider route identity.
- Add localized search route tests.
- Add diagnostics when the configured search engine requires a provider capability that is disabled.

### Acceptance Criteria

- Search results navigate to localized content routes.
- CMS provider can use CMS search without exposing filesystem `searchSections`.
- Consumers do not maintain local route-prefix fixes for search results.

## 9. Navigation API Clarity

### Current Problem

Consumers sometimes need local recursion to find the first docs page or normalize sidebar state.

### Change

`useContentNavigation()` should expose enough normalized metadata for common docs/sidebar layouts without owning UI rendering.

Recommended return shape:

```ts
const {
  data,
  firstPage,
  paths,
  activePath
} = await useContentNavigation('docs')
```

### Implementation Tasks

- Keep navigation nodes provider-neutral.
- Expose route-normalized paths.
- Expose `firstPage` for `/docs` redirects/index pages.
- Avoid UI-specific grouping unless it is pure data and documented.

### Acceptance Criteria

- Consumers do not need repeated local recursion to find first page.
- Sidebar active state can be derived from returned path metadata.
- No UI framework dependency is introduced.

## 10. Page Head And SEO Contract

### Current Problem

SEO/head behavior should be predictable across filesystem and CMS providers, localized and non-localized apps.

### Change

`useContentPage()` should expose enough page metadata for `useContentHead(page)` to produce:

- title;
- description;
- canonical URL when site URL is configured;
- Open Graph basics;
- localized alternates when available;
- explicit fallback metadata.

Ginko should not duplicate Nuxt i18n SEO ownership. It should consume route metadata and content alternates.

### Implementation Tasks

- Audit `useContentHead()` inputs and output.
- Add tests for canonical path vs requested path vs localized path.
- Warn when absolute SEO URLs are requested but site URL is missing.
- Ensure fallback content is not silently presented as exact translation.

### Acceptance Criteria

- Exact translation and fallback rendering are distinguishable.
- Canonical and alternate links match provider route metadata.
- Generated and previewed pages have stable head output.

## 11. Diagnostics And Doctor

### Current Problem

Reliability is not only passing tests. Users and agents must be able to fix mistakes quickly.

### Change

Treat diagnostics as a first-class API.

Every important error should include:

- what happened;
- where it happened;
- expected value;
- actual value;
- why Ginko cannot continue;
- exact fix;
- relevant collection/provider/locale/route.

### New Doctor Checks

- collection key and declared identity drift;
- invalid collection name usage when statically detectable;
- missing reference metadata for backlinks/populate;
- provider capability mismatch;
- CMS provider with wrong search engine;
- sitemap mode mismatch;
- placeholder `site.url`;
- missing `@nuxtjs/sitemap` when sitemap is enabled;
- Nuxt i18n/content locale mismatch;
- manually constructed localized content URLs;
- data-only collections participating in route/page/search/sitemap behavior accidentally;
- generated sitemap missing required paths;
- generated sitemap containing forbidden internal paths.

### Acceptance Criteria

- Common misconfigurations fail with actionable errors.
- `ginko doctor` can be used by a coding agent before making changes and after generation.
- Error messages are covered by focused tests where practical.

## 12. Config Surface Simplification

### Current Problem

Runtime config, app config, module options, collection config, and CMS options can feel like one large bucket if docs do not draw boundaries.

### Change

Keep config explicit and narrow.

`content.config.ts`:

- collections;
- schema;
- collection type;
- source;
- route mount;
- provider selection;
- references;
- CMS field metadata.

`nuxt.config.ts` `content`:

- i18n fallback policy;
- markdown/rendering behavior;
- search engine and search runtime;
- sitemap integration;
- provider runtime configuration;
- route validation/assertion behavior.

Provider module options:

- backend credentials;
- Studio/admin settings;
- CMS publish workflow;
- provider-specific runtime behavior.

### Implementation Tasks

- Add config responsibility table to docs.
- Remove examples that configure the same concept in multiple places.
- Add diagnostics when duplicate config sources disagree.

### Acceptance Criteria

- A user can answer "where do I configure this?" from one docs page.
- Agents do not invent second sources of truth in consumers.

## 13. Public API Surface Audit

### Current Problem

Unreleased APIs can drift faster than docs. vNext should hard-cut stale exports.

### Change

Audit every public export.

Keep exports that are part of the product story:

- config helpers;
- app composables;
- server utilities;
- renderer components/composables;
- provider types;
- testing provider contract;
- focused transformers.

Remove or un-document exports that exist only because an old consumer needed them.

### Implementation Tasks

- Generate a public export inventory.
- Mark each export as primary, advanced, provider-only, testing-only, or internal.
- Delete stale public exports.
- Add package export tests.

### Acceptance Criteria

- Public API docs match package exports.
- No consumer relies on undocumented internals.
- Removed unreleased exports are deleted, not shimmed.

## 14. Golden Demo And Release Gate

### Current Problem

The dream needs one executable proof, not only many unit tests.

### Change

Create a golden demo or fixture app that verifies:

- filesystem provider;
- provider contract fixture or CMS provider in the CMS repo;
- docs pages;
- blog pages;
- data collections;
- references/backlinks;
- navigation;
- surroundings;
- head/SEO;
- search;
- sitemap;
- optional i18n;
- static generate.

### Implementation Tasks

- Add a small fixture app or dedicated test workspace.
- Add generated-output assertions.
- Add browser QA script or documented QA checklist.
- Keep the app intentionally small.

### Acceptance Criteria

- One command proves the public dream before release.
- QA covers static output, route switching, search navigation, sitemap XML, and browser console health.

## Migration Rules For This Pass

This is a big bang refactor in unreleased/new API territory.

Rules:

- Prefer hard cutovers over compatibility shims.
- Delete old patterns from consumers after the new path passes.
- Do not keep old and new helpers side by side unless both are intentionally public.
- Update docs and examples in the same pass as code.
- Add tests for invariants, not only happy paths.
- Keep app-specific UI in consumers.

## Consumer Cleanup Targets

After vNext lands, consumers should not contain:

- local `fields: ['authors']` backlink workarounds when schema relation metadata exists;
- local sitemap `nitro.prerender.ignore` patches for expected Ginko/Nuxt Sitemap output;
- hardcoded docs first-page recursion if `useContentNavigation()` exposes `firstPage`;
- localized route string construction for content URLs;
- casts caused by missing populate/backlink types;
- app-local content route prefix repair for search results;
- duplicate `/docs` redirect sources unless both are required and documented.

## Testing Plan

### Unit And Type Tests

- collection key type inference;
- invalid collection name type failures;
- relation manifest generation;
- backlink field inference;
- populate target validation;
- locale fallback metadata;
- route metadata exact/fallback/unavailable states;
- provider capability validation;
- sitemap assertion parser;
- diagnostic message snapshots for key errors.

### Provider Contract Tests

- filesystem full capability suite;
- fixture provider suite;
- CMS provider supported capability suite in the CMS repo;
- unsupported capability failure tests.

### Nuxt Runtime Tests

- `useContentPage('docs')` route resolution;
- localized route resolution;
- `page.localePaths` publication;
- `useContentHead()` canonical/alternate output;
- `useContentNavigation()` first page and active paths;
- search result route identity;
- sitemap source hook behavior.

### Generate Tests

- static pages exist;
- sitemap files exist according to mode;
- required paths exist;
- forbidden internal paths are absent;
- search payload includes localized content;
- no renderer fallback JSON appears.

### Browser QA

- docs index redirects or renders first page correctly;
- docs nested page renders body/sidebar/TOC;
- blog page renders body/authors/surroundings;
- author page renders backlinks;
- localized docs switch both directions;
- fallback page is explicitly marked;
- search result navigation uses the correct route;
- sitemap fetch succeeds;
- browser console has no hydration, route metadata, payload 404, or renderer errors.

## Release Acceptance

vNext is complete only when:

- docs teach one public story;
- app page code uses typed string collection names;
- references/backlinks are schema-driven;
- providers pass capability-based conformance;
- sitemap output needs no consumer workaround;
- locale ownership is documented and tested;
- public exports match public docs;
- diagnostics are actionable;
- golden demo/generate/browser QA passes;
- consumers are updated to remove workarounds;
- changelog names breaking changes and new APIs.

## Recommended Sequence

1. Freeze this document as the vNext scope.
2. Update public API docs and README to the target story.
3. Implement typed string API hardening.
4. Implement reference manifest and backlink/populate validation.
5. Resolve route/locale switching contract drift.
6. Refactor provider conformance by capability.
7. Fix sitemap mode handling and assertions.
8. Improve navigation/search/head diagnostics.
9. Add doctor checks.
10. Update consumers and delete workarounds.
11. Run full static, generate, and browser QA.
12. Commit as one intentional vNext refactor.

## Final Product Standard

The standard for this pass is:

> A developer or coding agent should be able to open `content.config.ts`, understand the content model, call Ginko composables with explicit collection names, and get correct pages, navigation, references, search, i18n paths, head metadata, and sitemap entries without app-level workaround code.

When something is misconfigured, Ginko should fail early, name the source of truth, and say exactly what to change.
