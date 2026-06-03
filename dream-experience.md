# RFC: Dream Experience For Ginko Content

Status: draft
Date: 2026-06-02
Scope: `@lupinum/ginko-content`, `saas-template`, `saas-i18n`, `shadcn-starter`

## Summary

Ginko Content is close to the right product shape: a collection-first content
engine for Nuxt with typed content, route-aware page loading, search,
navigation, sitemap, and i18n. The current consumers prove the foundation works,
but they also show where the public API is making apps repeat work that the
library already knows.

The target experience is:

```ts
const { page, surround } = await useContentPage('docs')
```

For most route pages, that should be enough. It should be typed, route-aware,
locale-aware in Nuxt apps, and explicit about what it is doing.

The sweet spot is not "magic". It is a small set of explicit APIs that remove
boilerplate by putting each concept in one canonical place:

- collection identity comes from `content.config.ts`
- route mounts come from collection config
- Nuxt composables can infer the active locale
- fallback remains explicit unless a collection deliberately opts into it
- page data comes from `useContentPage`
- navigation comes from the content tree
- search scope comes from search config
- relationship queries happen in the query layer, not in Vue components

Agents will write much of the app code in the future. That makes API design more
important, not less. APIs should make the obvious code correct, easy to inspect,
and hard to drift. Avoid clever inference that hides ownership, but also avoid
forcing agents to reimplement tree walking, locale glue, search scoping, and
reference filtering in every app.

## Design Principles

1. One source of truth per concept.
2. Nuxt app code uses composables.
3. Lower-level query functions are explicit imports.
4. Generated types should make string collection names ergonomic.
5. Magic is acceptable only when ownership is already configured and visible.
6. Backend/provider invariants stay out of frontend orchestration.
7. Derived UI state is allowed only when it is clearly derived and rebuildable.
8. Prefer hard cutovers for unreleased or greenfield surfaces.
9. Implicit defaults must not hide missing content.

## Non-Goals

- Do not turn Ginko Content into a CMS product.
- Do not move Studio, MCP, browser editing, permissions, or workflow logic into
  core.
- Do not add adapters for every consumer style.
- Do not keep old and new public query APIs side by side unless release
  stability requires it.
- Do not add a generic app-navigation system. Content-backed entries can be
  derived, but non-content app routes remain app-owned.

## Current Friction

The review found these recurring problems across consumers:

- apps import `content.config.ts` handles into runtime code
- Old named collection declarations repeated collection identity
- generic functions like `one`, `many`, and `tree` are globally auto-imported
- i18n pages repeat `locale`
- pages that intentionally use fallback repeat `fallback: true`
- localized route mounts are repeated in `content.config.ts` and page meta
- docs navigation requires app-owned recursion and normalization
- search scope and search UI copy drift
- search results lack collection identity
- author pages fetch all posts and filter relationships in Vue
- populated references are not trusted by TypeScript at call sites
- Nuxt UI surround conversion is repeated
- SEO/head extraction is repeated
- unsupported `<ContentRenderer>` input can render debug JSON in production
- consumers rely on local packed tarballs, so source changes are not validated
  unless someone repacks

## Proposed Experience

### 1. Collection Identity

Collection keys should be the canonical identity. Do not ask users to repeat the
same name in a variable, a string argument, and a map key.

Before:

```ts
export const docs = defineCollection({
  type: 'page',
  source: 'docs/**/*.md',
  route: '/docs'
})

export default defineContentConfig({
  collections: {
    docs
  }
})
```

After:

```ts
export default defineContentConfig({
  collections: {
    docs: defineCollection({
      type: 'page',
      source: 'docs/**/*.md',
      route: '/docs'
    })
  }
})
```

Generated app types should make this work:

```ts
const { page } = await useContentPage('docs')
const { data: posts } = await useContentMany('blog', {
  sort: { date: 'desc' }
})
```

Optional handles can still exist, but they should be generated from the canonical
config, not authored as a second identity source:

```ts
import { docs, blog } from '#content/collections'

await useContentPage(docs)
await useContentMany(blog)
```

Second-pass API note:

Generated handles are useful, but they are not the first cut. They create another
public export surface and can become the same handle-centric API under a new
name. The primary app API should be typed string names. Add generated handles
only if there is a real ergonomic gap that string names cannot cover.

Benefits:

- removes collection-name drift
- makes agents write shorter and more idiomatic Nuxt code
- keeps `content.config.ts` as the one content model source
- allows explicit handles when useful without requiring app imports from
  `content.config.ts`

Tradeoffs:

- requires generated type support for string collection names
- requires config resolution to attach names after reading the map
- generated handles would add another public export surface
- existing handle-based examples need a hard update or a short migration note

### 2. Typed String Collection Names

String collection names should not lose type inference.

Before:

```ts
await useContentMany('blog', {
  populate: { author: 'authors' }
})
```

This should not fall back to broad `ParsedContent` if the generated collection
map knows `blog`.

After:

```ts
const { data: posts } = await useContentMany('blog', {
  populate: { author: 'authors' }
})

posts.value[0]?.author?.name
```

Required type behavior:

- `DocumentFromHandle<'blog'>` reads `ContentCollectionMap['blog']`
- `LocaleOption<'docs'>` reads `ContentCollectionI18nMap`
- `populate: { author: 'authors' }` returns a typed populated author
- `populate: ['author']` can be considered later, but only when the field is
  unambiguously declared with `reference('authors')`

Benefits:

- consumers do not need local `BlogPost` redeclarations for normal rendering
- agents can use simple string names and still get type errors
- fewer imports in page components

Tradeoffs:

- more type-level work in the generated declaration file
- explicit `populate` mapping is more verbose than inferred arrays
- inferred arrays should not ship until ambiguity and provider behavior are
  tested

### 3. Auto-Imports

Nuxt auto-imports should feel like Nuxt. Generic query primitives should not be
global.

Before:

```ts
const items = await tree(docs)
const doc = await one(posts, { by: { ref: 'post.launch' } })
```

After:

```ts
const { data: navigation } = await useContentNavigation('docs')
const { data: post } = await useContentOne('posts', {
  by: { ref: 'post.launch' }
})
```

Lower-level functions remain explicit:

```ts
import { one, many, tree } from '@lupinum/ginko-content/client'
```

Server code:

```ts
import { one } from '#content/server'
```

Second-pass API note:

Renaming the direct functions is less important than removing the global
auto-imports. The first cut should remove global auto-imports. Renaming to
`queryContentOne`/`queryContentMany` is optional and should happen only if the
team wants import sites to make the content boundary visually obvious.

Benefits:

- avoids global names like `one`, `many`, `tree`, `neighbors`
- makes content boundaries visible in scripts and server handlers
- keeps app pages idiomatic with `useContent*`

Tradeoffs:

- longer direct function names are clearer but less pleasant
- keeping short direct function names is fine if they are explicit imports
- existing examples using auto-imported `tree()` need updating

### 4. Route Pages

`useContentPage` should be the single documented API for content-backed route
pages.

Before:

```ts
const route = useRoute()
const { data: page } = await useContentOne(docs, {
  by: { route: () => route.path },
  locale,
  fallback: true
})
const { data: neighbors } = await useContentNeighbors(docs, {
  by: { route: () => route.path },
  locale,
  fallback: true
})
```

After:

```ts
const { page, surround } = await useContentPage('docs', {
  surround: true
})
```

`useContentOne` remains the explicit non-route selector helper:

```ts
const { data: author } = await useContentOne('authors', {
  by: { ref: 'authors.alex-river' }
})
```

Benefits:

- one default route-page pattern
- avoids duplicated route selectors
- removes local Nuxt UI surround adapters

Tradeoffs:

- `useContentPage` is intentionally special and route-aware
- docs must clearly reserve `useContentOne` for explicit selectors

### 5. Composable Return Shape

Composables should use a consistent AsyncData-like contract.

Recommended shape:

```ts
const {
  data,
  pending,
  status,
  error,
  refresh
} = await useContentMany('blog')
```

Route page helper can expose aliases because `page` reads better:

```ts
const {
  data,
  page,
  previous,
  next,
  surround,
  pending,
  error
} = await useContentPage('docs', { surround: true })
```

Rules:

- every composable exposes `pending`, `status`, `error`, `refresh`
- list helpers return arrays by default
- route page exposes `page` as an alias of `data`
- `previous` and `next` are exposed as separate refs
- `surround` is the derived array of existing adjacent links, suitable for
  Nuxt UI-style surround components without a local adapter

Benefits:

- fewer surprises moving between helpers
- Nuxt-like shape
- direct compatibility with common UI patterns

Tradeoffs:

- small API expansion on `useContentPage`
- existing consumers may need variable renames if `data` becomes canonical

### 6. Locale And Fallback

Pure query functions stay explicit. Nuxt composables default from Nuxt/content
runtime config for locale only.

Before:

```ts
const { locale } = useI18n()

const { page } = await useContentPage(docs, {
  locale,
  fallback: true
})
```

After:

```ts
const { page } = await useContentPage('docs')
```

If the page should intentionally fall back to another locale, keep that visible:

```ts
const { page } = await useContentPage('docs', {
  fallback: true
})
```

Explicit override remains available:

```ts
await useContentPage('docs', {
  locale: 'de',
  fallback: ['en']
})
```

Pure query functions remain explicit:

```ts
await one('docs', {
  locale: 'de',
  fallback: true,
  by: { ref: 'guide.installation' }
})
```

Benefits:

- less repeated frontend orchestration
- app behavior follows configured Nuxt i18n
- missing translations remain visible unless fallback is explicit
- scripts and server code stay explicit

Tradeoffs:

- composable behavior depends on Nuxt runtime context
- pages that want fallback still carry one explicit option
- tests must prove the defaulting behavior for i18n and non-i18n apps

### 7. Localized Routes

Collection route config should be the canonical route mount.

Before:

```ts
// content.config.ts
docs: defineCollection({
  route: { en: '/docs', de: '/dokumentation' }
})
```

```ts
// app/pages/docs/[...slug].vue
definePageMeta({
  i18n: {
    paths: {
      en: '/docs/[...slug]',
      de: '/dokumentation/[...slug]'
    }
  }
})
```

After:

```ts
docs: defineCollection({
  route: { en: '/docs', de: '/dokumentation' }
})
```

No repeated page route map for content-backed routes.

Implementation options:

- generate Nuxt i18n route metadata from content collection routes
- expose a helper for route files if generation is impossible
- add validation that page meta and collection routes match during development

Recommendation:

Start with validation or a helper generated from `content.config.ts`. Full route
generation is attractive, but it can become hidden framework magic and is easy to
get wrong around dynamic routes. Do not hand-maintain both route maps without an
assertion proving they match.

Benefits:

- removes a common i18n drift source
- agents cannot accidentally update one route map and miss the other
- localized sitemap/search/page resolution share the same mount config

Tradeoffs:

- integration with Nuxt i18n route generation must be tested carefully
- dynamic routes may need a clear mapping convention
- validation is less magical than generation but still leaves a little page
  boilerplate

### 8. Navigation

Navigation should expose the information apps are already deriving.

Before:

```ts
function findFirstPage(items) {
  for (const item of items) {
    if (item.path) return item.path
    const child = findFirstPage(item.children || [])
    if (child) return child
  }
}

const docsTree = await useContentTree(docs)
const firstPage = computed(() => findFirstPage(docsTree.data.value))
```

After:

```ts
const {
  data: navigation,
  firstPage,
  paths
} = await useContentNavigation('docs')
```

For shadcn-style docs sidebars:

```ts
const {
  data: navigation,
  firstPage
} = await useContentNavigation('docs', {
  fields: ['icon', 'badge', 'sidebar']
})

const sections = computed(() =>
  createDocsSections(navigation.value, { section: 'section', group: 'group' })
)
```

Second-pass API note:

Do not put docs-sidebar section/group projection into the first core API. That
is too specific to the shadcn starter. Ginko should provide normalized
navigation, stable ids, folder/page typing, `firstPage`, `paths`, and traversal
helpers. The consumer can keep the small projection that maps its own
`sidebar: section | group` metadata to UI.

Benefits:

- deletes repeated tree walking
- keeps canonical path/id/folder logic in Ginko
- lets consumers keep actual UI rendering local

Tradeoffs:

- consumers with rich sidebars still keep a small UI projection
- avoiding section/group projection keeps core less product-specific

### 9. Search

Search needs one configured scope and results with collection identity.

Before:

```ts
const { query, results } = await useContentSearch()

const group = hit.path.startsWith('/blog') ? 'blog' : 'docs'
```

After:

```ts
import { useContentSearch } from '@lupinum/ginko-content/client'

const { query, results } = await useContentSearch()

results.value[0]
// {
//   collection: 'blog',
//   path: '/blog/navigation-quality',
//   anchor: 'routing',
//   title: 'Navigation Quality',
//   excerpt: '...'
// }
```

Second-pass API note:

The name `useContentSearchController` is probably too clunky. The better first
cut is to keep `useContentSearch` as an explicit import when Nuxt UI owns the
auto-imported name. If the project strongly wants an auto-imported headless
controller later, add an alias then. Do not rename only to work around one
auto-import collision.

Search data should support configured public collections:

```ts
const search = await useContentSearchData()
```

Or explicit scope:

```ts
const search = await useContentSearchData(['docs', 'blog', 'changelog'])
```

Defaults:

- include route-backed `type: 'page'` collections
- exclude `type: 'data'` collections
- require explicit opt-in for data collections
- warn if a non-routable collection is indexed into public route search

Benefits:

- no URL-prefix guessing
- search UI copy can match configured scope
- data collections do not leak into public search
- avoids a new awkward controller name

Tradeoffs:

- search index records get slightly larger
- apps with intentional data-search need explicit config
- shadcn-style apps still import the headless search helper explicitly

### 10. Relationships And Population

Reference relationships should be queryable without frontend filtering.

Before:

```ts
const { page: author } = await useContentPage('authors')
const { data: posts } = await useContentMany('posts', {
  populate: { authors: 'authors' }
})

const authorPosts = computed(() =>
  posts.value.filter(post => getAuthorRefs(post).includes(author.value?.ref))
)
```

After:

```ts
const { page: author } = await useContentPage('authors')
const { data: posts } = await useContentBacklinks('authors', {
  by: { route: () => author.value?.path || '' },
  from: 'posts'
})
```

Or a more explicit reference-query helper:

```ts
const { data: posts } = await useContentReferences('posts', {
  field: 'authors',
  to: { collection: 'authors', route: () => author.value?.path || '' }
})
```

Recommendation:

Prefer improving `backlinks` if it already owns this behavior. Do not add a
second relationship query API unless backlinks cannot express the requirement.

Benefits:

- relationship filtering moves out of Vue components
- avoids loading all posts and all authors
- makes invalid references easier to test

Tradeoffs:

- backlink/reference query behavior must be provider-contract tested
- ambiguous reference fields still need explicit field selection

### 11. Head And SEO

Consumers should not repeat title/description extraction on every route page.

Before:

```ts
const title = computed(() => page.value?.seo?.title || page.value?.title || '')
const description = computed(() =>
  page.value?.seo?.description || page.value?.description || ''
)

useSeoMeta({
  title,
  ogTitle: title,
  description,
  ogDescription: description
})
```

After:

```ts
const { page } = await useContentPage('docs')
useContentHead(page)
```

Or, if automatic head is truly desired:

```ts
const { page } = await useContentPage('docs', {
  head: true
})
```

Recommendation:

Expose `useContentHead(page)` publicly. Keep automatic head opt-in or delete the
`contentHead` option if it is not wired. Explicit helper calls are easier for
agents and reviewers to reason about than hidden page side effects.

Benefits:

- deletes repeated computed SEO blocks
- keeps SEO source obvious
- aligns with explicit-over-magic preference

Tradeoffs:

- one helper call remains in pages
- content SEO schema needs a stable documented shape

### 12. Renderer Fallbacks

`<ContentRenderer>` should not render diagnostic JSON in production.

Before:

```html
<pre>{
  "message": "You should use slots with <ContentRenderer>",
  ...
}</pre>
```

After:

- render the `empty` slot if provided
- render nothing otherwise
- warn only in development

Benefits:

- avoids production debug output
- keeps diagnostics available during development

Tradeoffs:

- invalid input can be visually silent in production
- tests should cover the empty slot behavior

### 13. Markdown Component Registration

The current shadcn setup must register component directories and maintain a
large `markdown.tags` map. That is explicit, but noisy.

Keep explicit mappings as the default:

```ts
content: {
  markdown: {
    tags: {
      card: 'MdcCard',
      'card-group': 'MdcCardGroup'
    }
  }
}
```

Optionally add a convention helper:

```ts
content: {
  markdown: {
    tagPrefix: 'Mdc',
    tags: {
      'doc-img': 'MdcDocImg'
    }
  }
}
```

Recommendation:

Do not prioritize this before query, navigation, i18n, search, and population.
The current explicit map is annoying but understandable. A convention helper is
acceptable only if it deletes boilerplate without becoming a second registry.

### 14. Consumer Integration Path

The three consumers currently depend on local packed tarballs. That is derived
output and easy to forget during development.

Before:

```json
"@lupinum/ginko-content": "file:../ginko-content/.pack/lupinum-ginko-content-0.1.2.tgz"
```

Recommended modes:

For templates meant to be published:

```json
"@lupinum/ginko-content": "^0.1.2"
```

For local integration work:

```json
"@lupinum/ginko-content": "link:../ginko-content/packages/content"
```

Or a single scripted pack/install path that rebuilds the package before consumer
tests. Use `workspace:*` only if the consumers move into the same pnpm
workspace.

Benefits:

- source changes are validated without hidden repack steps
- release packaging stays a release concern
- fewer stale consumer reviews

Tradeoffs:

- workspace linking may not match published package contents
- release verification still needs pack/install tests
- `link:` can hide package export mistakes that `npm pack` would catch

## Consumer Target Code

### `saas-template`

Before:

```ts
import { docs } from '~~/content.config'

const { page, previous, next } = await useContentPage(docs, {
  surround: { fields: ['description'] }
})
```

After:

```ts
const { page, surround } = await useContentPage('docs', {
  surround: { fields: ['description'] }
})

useContentHead(page)
```

Delete:

- local `toNuxtUiSurround`
- local docs first-page recursion if `useContentNavigation` exposes `firstPage`
- static `/docs` redirect if `docs/index.vue` is the canonical redirect path

### `saas-i18n`

Before:

```ts
const { locale } = useI18n()

definePageMeta({
  i18n: {
    paths: {
      en: '/docs/[...slug]',
      de: '/dokumentation/[...slug]'
    }
  }
})

const { page } = await useContentPage(docs, {
  locale,
  fallback: true
})
```

After:

```ts
const { page } = await useContentPage('docs', {
  fallback: true
})
useContentHead(page)
```

Delete:

- repeated `locale` in Nuxt page composables
- manually duplicated content route page meta where possible
- fallback badge detection against private `_resolvedLocale`
- hard-coded English date formatting

Expose:

```ts
page.value?.resolved.fallback
page.value?.resolved.locale
page.value?.resolved.requestedLocale
```

### `shadcn-starter`

Before:

```ts
import { docs } from '../../content.config'

const { data } = await useAsyncData(
  'docs-navigation-tree',
  () => tree(docs, { fields: ['icon', 'badge', 'sidebar'] })
)
```

After:

```ts
const { data: navigation } = await useContentNavigation('docs', {
  fields: ['icon', 'badge', 'sidebar']
})

const sections = computed(() => createDocsSections(navigation.value))
```

Before:

```ts
import { useContentSearch } from '@lupinum/ginko-content/client'

const { query, results } = await useContentSearch()
const group = hit.path.startsWith('/blog') ? 'blog' : 'docs'
```

After:

```ts
import { useContentSearch } from '@lupinum/ginko-content/client'

const { query, results } = await useContentSearch()
const group = results.value[0]?.collection
```

Delete:

- raw docs tree type definitions
- path-prefix search grouping
- global docs layout state for derived page title and TOC where page props can
  be passed directly

## API Change List

High priority:

1. Derive collection names from `defineContentConfig({ collections })`.
2. Add typed string collection support.
3. Stop auto-importing generic query primitives.
4. Keep or rename direct query primitives as an explicit-import decision.
5. Make `useContentPage` the documented route-page default.
6. Add composable locale defaulting from Nuxt/content runtime config.
7. Keep fallback explicit unless a collection deliberately opts into it.
8. Make collection `route` the canonical localized route source, with
   validation before full generation.
9. Add public navigation traversal helpers or `useContentNavigation`.
10. Default search to routable page collections and add `collection` to results.
11. Improve populate/backlink ergonomics for references.

Medium priority:

12. Normalize composable return contracts.
13. Return Nuxt UI-compatible `surround` links from `useContentPage`.
14. Expose `useContentHead(page)`.
15. Make renderer unsupported-input fallback production-safe.
16. Type synthetic navigation folder nodes correctly.

Lower priority:

17. Optional markdown tag convention helper.
18. Clean up or delete unwired `contentHead`.
19. Align navigation docs and behavior around `order` if it is real, otherwise
    remove it.
20. Replace local tarball dependencies with a canonical integration workflow.

## Boilerplate vs Magic

Acceptable explicitness:

- collection routes are written in `content.config.ts`
- content pages call `useContentPage('docs')`
- content pages that want locale fallback say `fallback: true`
- pages call `useContentHead(page)`
- shadcn docs sidebars explicitly declare section/group metadata fields
- pure query functions require explicit locale/fallback
- data collections explicitly opt into public search

Unacceptable boilerplate:

- importing `content.config.ts` handles in app pages just for typing
- repeating collection names in multiple places
- repeating i18n route mounts in page meta and collection config
- repeating active `locale` on every Nuxt page
- hand-recursing content trees to find first pages
- filtering all posts in Vue to find references
- guessing search result type from URL prefixes
- local casts after explicit `populate`

Acceptable magic:

- Nuxt composables default to active Nuxt locale
- `useContentPage` uses the current route
- `useContentNavigation` normalizes tree paths and ids
- public search defaults to routable page collections
- generated types infer document shapes from string collection names

Unacceptable magic:

- hidden SEO side effects by default
- silent data-collection search indexing
- implicit fallback in pure query functions
- implicit fallback in Nuxt composables unless explicitly configured per
  collection
- generated route behavior that cannot be inspected or validated
- compatibility shims that keep old and new query paths alive in greenfield code

## Invariant Tests

Add focused tests for:

- collection key is the only collection identity source
- string collection names infer document and locale requirements
- generic query functions are not globally auto-imported
- `useContentPage('docs')` resolves current route
- Nuxt i18n composables default to active locale
- Nuxt i18n composables do not fallback unless `fallback` is explicit or the
  collection opts in
- pure query functions still require explicit locale/fallback
- collection route config matches Nuxt i18n route metadata or fails validation
- `/docs` redirect target equals navigation first page
- navigation synthetic folders have stable ids and optional paths
- `useContentNavigation` exposes `firstPage`
- search excludes `type: 'data'` by default
- search results include `collection`
- populated references are typed and resolve correctly
- backlink/reference queries do not require loading all source documents in Vue
- renderer invalid input does not emit debug JSON in production

Consumer invariant tests:

- `saas-template`: `/docs` redirect matches first content page
- `saas-i18n`: localized route mounts match content collection routes
- `saas-i18n`: date formatting uses active locale
- `shadcn-starter`: docs sidebar projection drops no routable nav item
- `shadcn-starter`: search scope matches configured collections

## Migration Shape

Because the package is still early, prefer hard cutovers for the API cleanup:

1. Update Ginko Content public API and generated types.
2. Update docs and examples to the new canonical patterns.
3. Update `saas-template`.
4. Update `saas-i18n`.
5. Update `shadcn-starter`.
6. Add consumer invariant tests.
7. Run package tests, type checks, docs build, examples build, and consumer
   validation.

Do not introduce dual query paths for unreleased behavior. If a public release
already exposed a surface, handle it with semver, changelog notes, and a short
migration section instead of open-ended compatibility layers.

## Open Questions

1. Should generated collection handles live at `#content/collections`, or should
   string collection names be the only recommended app API?
2. Can Nuxt i18n route metadata be generated reliably from collection routes, or
   should Ginko validate first and provide helper output?
3. Should `useContentNavigation` include section/group projection, or should it
   expose lower-level helpers and let shadcn keep grouping local?
4. Should `populate: ['author']` be supported only when the schema field uses
   `reference()`, or should it also infer by field naming conventions?
5. Should `useContentHead(page)` be explicit-only, or should `useContentPage`
   support `head: true`?

## Recommended First Cut

The smallest change set that would materially improve all consumers:

1. Add typed string collection names.
2. Stop auto-importing `one`, `many`, `tree`, and `neighbors`.
3. Add `useContentNavigation('docs')` with `firstPage`.
4. Return `surround`, `previous`, and `next` from `useContentPage`.
5. Default Nuxt composables to active locale, but keep fallback explicit.
6. Add `collection` to search results and default search to page collections.
7. Expose `useContentHead(page)`.

This set deletes real consumer boilerplate without adding a broad new subsystem.
