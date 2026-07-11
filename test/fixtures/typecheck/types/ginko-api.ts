/**
 * Type-level tests for the unified query API (ADR-0016) and the composable
 * hard cut (VNEXT.md 10.4-10.7, 27).
 *
 * Compiled by `pnpm typecheck`. Negative tests (`@ts-expect-error`) assert
 * that obvious misuses fail at the type level.
 */
import type {} from '../.nuxt/types/content'
import {
  backlinks,
  getCollectionPath,
  many,
  navigation,
  one,
  paginate,
  resolveOne,
  surround,
  useContentPage,
  useContentSearch,
  type ContentAlternate,
  type ContentCollectionName,
  type ContentDocumentResolution,
  type ContentDocumentRoute,
  type ContentNavigationTreeItem,
  type DocumentFromHandle,
  type LocalizedContentDocument,
  type OneOptions,
  type QueryWhere
} from '@lupinum/ginko-content/client'
import type { __ginkoI18nBrand } from '@lupinum/ginko-content/config'
import { defineCollection, defineContentConfig, reference } from '@lupinum/ginko-content/config'
import type { StrictParsedContent } from '@lupinum/ginko-content'
import { createFixtureContentProvider, createProviderFixture, createProviderFixtureEvent } from '@lupinum/ginko-content/testing/provider-fixture'
import { useContentPage as autoUseContentPage, useGinkoContentSearch as autoUseContentSearch } from '#imports'
import { z } from 'zod'

declare const clientSurface: typeof import('@lupinum/ginko-content/client')
declare const publicDocument: StrictParsedContent

// Structural source classification is module-private and never part of the
// public/root document contract (VNEXT.md 18.4, deletion register §30).
// @ts-expect-error navigation control files are consumed before public shaping.
void publicDocument.navigationFile

/* ── Deleted query verbs are absent from the public surface (VNEXT.md 26.2) ── */
// `tree`/`neighbors`/`variants` were hard-cut: `tree` folded into `navigation()`,
// `neighbors` became `surround()`, and `variants` was deleted (alternates come
// from `resolveOne()`). None may be imported as a public query verb.
// @ts-expect-error the `tree` query verb was absorbed into navigation() and is not exported.
void clientSurface.tree
// @ts-expect-error the `neighbors` query verb became surround() and is not exported.
void clientSurface.neighbors
// @ts-expect-error the `variants` query verb was deleted; alternates come from resolveOne().
void clientSurface.variants

/* ── Deleted wrapper composables are absent from the public surface (VNEXT.md 10.6) ── */
// Every wrapper composable except `useContentPage`/`useContentSearch` is a
// hard-cut deletion (VNEXT.md 10.4-10.6). Applications compose pure `/client`
// operations with `useAsyncData` instead (VNEXT.md 10.6 recipe).
// @ts-expect-error useContentOne was deleted; compose one() with useAsyncData instead.
void clientSurface.useContentOne
// @ts-expect-error useContentMany was deleted; compose many() with useAsyncData instead.
void clientSurface.useContentMany
// @ts-expect-error useContentPagination was deleted; compose paginate() with useAsyncData instead.
void clientSurface.useContentPagination
// @ts-expect-error useContentBacklinks was deleted; compose backlinks() with useAsyncData instead.
void clientSurface.useContentBacklinks
// @ts-expect-error useContentResolveOne was deleted; compose resolveOne() with useAsyncData instead.
void clientSurface.useContentResolveOne
// @ts-expect-error useContentVariants was deleted; alternates live on resolved documents.
void clientSurface.useContentVariants
// @ts-expect-error useContentTree was deleted; navigation() absorbs tree().
void clientSurface.useContentTree
// @ts-expect-error useContentNavigation was deleted; compose navigation() with useAsyncData instead.
void clientSurface.useContentNavigation
// @ts-expect-error useContentNeighbors was deleted; surround() replaces neighbors().
void clientSurface.useContentNeighbors
// @ts-expect-error useContentToc was deleted; wrap the pure extractContentToc in computed() instead.
void clientSurface.useContentToc
// @ts-expect-error useContentHead was deleted; use Nuxt useHead / Nuxt I18n head composition instead.
void clientSurface.useContentHead
// @ts-expect-error useContentSwitchLocalePath was deleted; read page.route.alternates instead.
void clientSurface.useContentSwitchLocalePath
// @ts-expect-error useContentSearchData was absorbed into useContentSearch({ collection }).
void clientSurface.useContentSearchData
// @ts-expect-error useContentSearchResults was absorbed into useContentSearch().
void clientSurface.useContentSearchResults

// @ts-expect-error named collection declarations were removed; use the collections map key.
const _removedNamedCollection = defineCollection('legacy', {
  type: 'page',
  source: 'legacy/**/*.md'
})
void _removedNamedCollection

const rawDocs = defineCollection({
  type: 'page',
  source: 'docs/**/*.md',
  strict: true,
  i18n: { defaultLocale: 'en', locales: ['en', 'de'] },
  schema: z.object({
    title: z.string(),
    author: reference('authors').optional(),
    related: reference('docs').optional(),
    post: reference('posts').optional()
  })
})

const rawAuthors = defineCollection({
  type: 'data',
  source: 'authors/*.yml',
  i18n: true,
  schema: z.object({
    name: z.string(),
    role: z.string().optional()
  })
})

const rawPosts = defineCollection({
  type: 'page',
  source: 'posts/**/*.md',
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    date: z.string(),
    authors: z.array(reference('authors')),
    image: z.object({ src: z.string() }).optional()
  })
})

const _contentConfig = defineContentConfig({
  collections: { docs: rawDocs, authors: rawAuthors, posts: rawPosts }
})
void _contentConfig
const { docs, authors, posts } = _contentConfig.collections

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false
type Expect<T extends true> = T

/* ── Type-level shape probes ────────────────────────────────────────────── */

// Handles carry the i18n discriminator at the type level, behind a private
// symbol carrier (VNext 18.1) rather than a readable `__i18n` property.
type _ProbeDocsI18n = Expect<Equal<typeof docs[typeof __ginkoI18nBrand], true>>
type _ProbePostsI18n = Expect<Equal<typeof posts[typeof __ginkoI18nBrand], false>>
// The old readable properties must be gone at the type level.
// @ts-expect-error __i18n is no longer a readable property on collection handles.
void (docs.__i18n)
// @ts-expect-error __schema is no longer a readable property on collection handles.
void (docs.__schema)
type _ProbeConfigKeyName = Expect<Equal<typeof _contentConfig.collections.docs.name, 'docs'>>

// OneOptions imports correctly (regression: dist/types must be emitted —
// when build.config's mkdistEntries doesn't include `src/types/`,
// OneOptions resolves to `any` and silently breaks every guarantee below).
type _DocsOneIsAny = unknown extends OneOptions<typeof docs> ? 'is-any' : 'not-any'
type _ProbeNotAny = Expect<Equal<_DocsOneIsAny, 'not-any'>>

// OneOptions<docs> requires both `by` and `locale`.
type _DocsMissingLocale = { by: { ref: string }, fallback: 'en' } extends OneOptions<typeof docs> ? 'accepted' : 'rejected'
type _ProbeRejected = Expect<Equal<_DocsMissingLocale, 'rejected'>>

// OneOptions<posts> only requires `by` (no locale).
type _PostsMissingLocale = { by: { path: string } } extends OneOptions<typeof posts> ? 'accepted' : 'rejected'
type _ProbePostsAccepted = Expect<Equal<_PostsMissingLocale, 'accepted'>>

// Generated collection names infer from content.config.ts, not local handles.
type _GeneratedCollectionNames = Expect<Equal<ContentCollectionName, 'docs' | 'authors' | 'posts'>>
type StringPostDoc = DocumentFromHandle<'posts'>
type _StringPostHasTitle = Expect<Equal<StringPostDoc['title'], string>>
type _StringPostHasAuthors = Expect<Equal<StringPostDoc['authors'], string[]>>
type StringDocsDoc = DocumentFromHandle<'docs'>
type _StringDocsHasTitle = Expect<Equal<StringDocsDoc['title'], string>>

/* ── Positive cases ─────────────────────────────────────────────────────── */

// Single-locale collection: locale not required.
const blogResult = await one(posts, { by: { path: '/hello' } })
type BlogDoc = NonNullable<typeof blogResult>
type _BlogHasTitle = Expect<Equal<BlogDoc['title'], string>>
type _BlogSeoTitle = Expect<Equal<BlogDoc['seo'], { title?: string, description?: string, image?: string | { src: string, alt?: string, width?: number, height?: number } } | undefined>>

/* ── 10.4 canonical document facts envelope ─────────────────────────────── */

// The envelope is exactly `route`/`resolution` — no top-level `path`,
// `variants`, `localePaths`, or `resolved` shape (VNEXT.md 10.4).
type _BlogHasRoute = Expect<Equal<BlogDoc['route'], ContentDocumentRoute>>
type _BlogHasResolution = Expect<Equal<BlogDoc['resolution'], ContentDocumentResolution>>
type _BlogMatchesExplicitLocalizedAlias = Expect<Equal<BlogDoc['route'], LocalizedContentDocument['route']>>
type _BlogRouteResolvedPathIsString = Expect<Equal<BlogDoc['route']['resolvedPath'], string>>
type _BlogRouteRequestedPathIsOptional = Expect<Equal<BlogDoc['route']['requestedPath'], string | undefined>>
type _BlogAlternatesAreTyped = Expect<Equal<BlogDoc['route']['alternates'], ContentAlternate[]>>
type _BlogResolvedLocaleIsString = Expect<Equal<BlogDoc['resolution']['resolved']['locale'], string>>
type _BlogRequestedLocaleIsOptional = Expect<Equal<BlogDoc['resolution']['requested']['locale'], string | undefined>>
type _BlogUsedFallbackIsBoolean = Expect<Equal<BlogDoc['resolution']['usedFallback'], boolean>>

if (blogResult) {
  // @ts-expect-error the old flat `path` field was deleted; use route.resolvedPath.
  void blogResult.path
  // @ts-expect-error the old `variants` field was deleted; use route.alternates.
  void blogResult.variants
  // @ts-expect-error the old `localePaths` field was deleted; use route.alternates.
  void blogResult.localePaths
  // @ts-expect-error the old `resolved` field was deleted; use `resolution`.
  void blogResult.resolved
  // @ts-expect-error canonicalPath does not exist — canonicalKey is opaque identity, not a URL.
  void blogResult.route.canonicalPath
}

// String collection names keep generated document inference.
const stringBlogResult = await one('posts', { by: { path: '/hello' } })
if (stringBlogResult) {
  const stringBlogTitle: string = stringBlogResult.title
  const stringBlogDate: string = stringBlogResult.date
  const stringBlogAuthors: string[] = stringBlogResult.authors
  const stringBlogResolvedPath: string = stringBlogResult.route.resolvedPath
  void stringBlogTitle
  void stringBlogDate
  void stringBlogAuthors
  void stringBlogResolvedPath
}

const stringDocsResult = await one('docs', {
  locale: 'de',
  by: { ref: 'guide.getting-started' },
  populate: { author: 'authors' }
})
if (stringDocsResult?.author) {
  const stringAuthorName: string = stringDocsResult.author.name
  void stringAuthorName
}
if (stringDocsResult) {
  const stringDocsTitle: string = stringDocsResult.title
  void stringDocsTitle
}

// The documented replacement for the deleted `useContentMany`: a pure
// operation composed with `useAsyncData` (VNEXT.md 10.6).
const manyPostsAsync = await useAsyncDataTypecheckOnly(
  'typecheck-many-posts',
  () => many(posts, {
    where: { title: { $exists: true } },
    sort: { date: 'desc' },
    select: ['title', 'date', 'authors']
  })
)
const firstManyPost = manyPostsAsync.data.value?.[0]
if (firstManyPost) {
  const title: string = firstManyPost.title
  const date: string = firstManyPost.date
  const authors: string[] = firstManyPost.authors
  const usedFallback: boolean = firstManyPost.resolution.usedFallback
  void title
  void date
  void authors
  void usedFallback
}

const stringPopulatedPost = await one('posts', {
  by: { path: '/hello' },
  populate: { authors: 'authors' }
})
if (stringPopulatedPost?.authors[0]) {
  const populatedAuthorName: string = stringPopulatedPost.authors[0].name
  void populatedAuthorName
}

const populatedDocsResult = await one(docs, {
  locale: 'en',
  by: { ref: 'guide.getting-started' },
  populate: { author: authors }
})
if (populatedDocsResult?.author) {
  const populatedAuthorName: string = populatedDocsResult.author.name
  void populatedAuthorName
}
if (populatedDocsResult) {
  const populatedDocsTitle: string = populatedDocsResult.title
  void populatedDocsTitle
}
void populatedDocsResult

// i18n collection: locale required.
const docsResult = await one(docs, {
  locale: 'fr',
  by: { ref: 'guide.getting-started' }
})
type DocsDoc = NonNullable<typeof docsResult>
type _DocsHasTitle = Expect<Equal<DocsDoc['title'], string>>
type _DocsRequestedLocaleIsOptionalString = Expect<Equal<DocsDoc['resolution']['requested']['locale'], string | undefined>>
type _DocsAlternateCarriesResolvedLocale = Expect<Equal<Extract<DocsDoc['route']['alternates'][number], { source: 'fallback' }>['resolvedLocale'], string>>

// Public-safe MongoDB-style filter operators are accepted.
const filtered = await many(posts, {
  where: { date: { $gt: '2024-01-01' }, title: { $icontains: 'foo' } },
  sort: { date: 'desc' },
  limit: 10
})
void filtered

// @ts-expect-error public unified filters intentionally do not expose caller-provided regex.
void ({ title: { $regex: 'foo' } } satisfies QueryWhere<{ title: string }>)

const pagedPosts = await paginate(posts, {
  where: { title: { $exists: true } },
  page: 2,
  limit: 5
})
const pagedPost = pagedPosts.data[0]
if (pagedPost) {
  const pagedTitle: string = pagedPost.title
  const pagedDate: string = pagedPost.date
  void pagedTitle
  void pagedDate
}
const pageTotal: number = pagedPosts.total
const pageNext: number | null = pagedPosts.nextPage
void pageTotal
void pageNext

/* ── paginate() discriminates offset vs cursor by the caller's own `mode` ── */

// Omitting `mode` narrows to the offset shape — `total`/`page`/`nextPage` exist.
type _OffsetPageHasTotal = Expect<Equal<typeof pagedPosts.mode, 'offset'>>

const cursorPosts = await paginate(posts, {
  where: { title: { $exists: true } },
  mode: 'cursor',
  after: null,
  limit: 5
})
type _CursorPageModeIsTyped = Expect<Equal<typeof cursorPosts.mode, 'cursor'>>
const cursorEndCursor: string | null = cursorPosts.endCursor
void cursorEndCursor
// @ts-expect-error a cursor page has no `total` — no synthetic total is invented
void cursorPosts.total
// @ts-expect-error a cursor page has no `page` number
void cursorPosts.page

const authorBacklinks = await backlinks(authors, {
  locale: 'de',
  by: { ref: 'authors.evan' },
  from: posts,
  sort: { date: 'desc' }
})
const authorBacklink = authorBacklinks[0]
if (authorBacklink) {
  const backlinkTitle: string = authorBacklink.title
  const backlinkAuthors: string[] = authorBacklink.authors
  void backlinkTitle
  void backlinkAuthors
}

const stringAuthorBacklinks = await backlinks('authors', {
  locale: 'de',
  by: { ref: 'authors.evan' },
  from: 'posts'
})
const stringAuthorBacklink = stringAuthorBacklinks[0]
if (stringAuthorBacklink) {
  const backlinkTitle: string = stringAuthorBacklink.title
  const backlinkAuthors: string[] = stringAuthorBacklink.authors
  void backlinkTitle
  void backlinkAuthors
}

const mixedBacklinks = await backlinks(authors, {
  locale: 'de',
  by: { ref: 'authors.evan' },
  from: [posts, docs],
  via: {
    posts: ['authors'],
    docs: ['author']
  }
})
const mixedBacklink = mixedBacklinks[0]
if (mixedBacklink) {
  const title: string = mixedBacklink.title
  void title
}

/* ── useContentPage: the sole route-aware app composable (VNEXT.md 10.5, 27.1) ── */

// Route pages may omit locale even for typed i18n handles because the route is
// the selector. Surround entries return navigation items, not full documents.
const routePage = await useContentPage(docs, { surround: { select: ['title'] } })
const routePageTitle: string | undefined = routePage.page.value?.title
const routePreviousItem = routePage.previous.value
if (routePreviousItem) {
  const routePreviousTitle: string = routePreviousItem.title
  // @ts-expect-error route surround items are navigation entries, not full localized documents.
  const routePreviousLocale: string = routePreviousItem.locale
  void routePreviousTitle
  void routePreviousLocale
}
const routeNextItem = routePage.next.value
if (routeNextItem) {
  const routeNextTitle: string = routeNextItem.title
  void routeNextTitle
}
void routePageTitle
const routePageStatus: string = routePage.status.value
const routePageError: unknown = routePage.error.value
void routePageStatus
void routePageError
await routePage.refresh()

// @ts-expect-error useContentPage has no `notFound` option (VNEXT.md 27.1) — the app decides.
await useContentPage(docs, { notFound: false })

// @ts-expect-error useContentPage has no `data` alias — `page` is the sole name.
void routePage.data

// @ts-expect-error useContentPage has no `surround` array field — use `previous`/`next`.
void routePage.surround

const stringRoutePage = await useContentPage('docs')
const stringRoutePageTitle: string | undefined = stringRoutePage.page.value?.title
// Omitting `surround` still types `previous`/`next` (always `null` at runtime).
const stringRoutePrevious: null | { title: string } = stringRoutePage.previous.value
void stringRoutePageTitle
void stringRoutePrevious

const authorPath = getCollectionPath(authors, { slug: 'evan', locale: 'de', defaultLocale: 'en', locales: ['en', 'de'] })
const typedAuthorPath: string = authorPath
void typedAuthorPath

/* ── useContentSearch: the sole public search composable (VNEXT.md 10.5, 27.2) ── */

const headlessSearch = await useContentSearch({ initialQuery: 'guide', limit: 5 })
headlessSearch.setQuery('intro')
headlessSearch.next()
const selectedSearchResult = headlessSearch.select()
if (selectedSearchResult) {
  const searchPath: string = selectedSearchResult.path
  const searchCollection: string = selectedSearchResult.collection
  void searchPath
  void searchCollection
}
// `searchNavigation` is the sole name for search navigation data (VNEXT.md 27.2)
// — there is no `navigation` compatibility alias.
const searchNavItem = headlessSearch.searchNavigation.value[0]
if (searchNavItem) {
  const searchNavTitle: string = searchNavItem.title
  void searchNavTitle
}
// @ts-expect-error `navigation` is not a compatibility alias for `searchNavigation`.
void headlessSearch.navigation

// `collection` opts into the absorbed useContentSearchData index/navigation loading.
const collectionSearch = await useContentSearch({ collection: docs, locale: 'de' })
const searchFile = collectionSearch.files.value[0]
if (searchFile) {
  const searchFileTitle: string = searchFile.title
  void searchFileTitle
}

/* ── Auto-imported variants (VNEXT.md 10.8: exactly useContentPage/useContentSearch) ── */

const autoRoutePage = await autoUseContentPage(posts)
void autoRoutePage
const autoSearch = await autoUseContentSearch({ initialQuery: 'guide' })
void autoSearch

/* ── Provider fixture public testing subpath ───────────────────────────── */

const fixture = createProviderFixture({
  collections: {
    docs: {
      type: 'page',
      i18n: { defaultLocale: 'en', locales: ['en', 'de'] },
      route: { en: '/docs', de: '/dokumentation' }
    }
  },
  documents: []
})
const fixtureProvider = createFixtureContentProvider(fixture)
const fixtureEvent = createProviderFixtureEvent({ fixture, provider: fixtureProvider })
void fixtureEvent

/* ── navigation() returns typed navigation items, not unknown[] ────────── */

const navResult = await navigation(docs, { locale: 'de', select: ['title'] as const })
type _NavItem = typeof navResult[number]
type _NavTitleIsTyped = Expect<Equal<_NavItem['title'], string>>
void navResult

/* ── surround() takes by (not top-level ref/path) and returns previous/next ── */

const surroundEntries = await surround(docs, { locale: 'de', by: { ref: 'guide.intro' } })
type _SurroundPreviousIsTyped = Expect<Equal<typeof surroundEntries.previous, ContentNavigationTreeItem<DocsDoc> | null>>
void surroundEntries

/* ── 10.3 selection-aware return types (decision 24) ───────────────────── */

// With a const `select`, `one()` narrows to the selected keys PLUS the
// guaranteed identity/route/resolution keys, and drops unselected frontmatter.
const selectedPost = await one(posts, { by: { path: '/hello' }, select: ['title', 'date'] })
if (selectedPost) {
  const selTitle: string = selectedPost.title
  const selDate: string = selectedPost.date
  // Guaranteed keys survive projection in the TYPE exactly as at runtime.
  const selId: string = selectedPost.id
  const selResolvedPath: string = selectedPost.route.resolvedPath
  const selResolvedLocale: string = selectedPost.resolution.resolved.locale
  void selTitle
  void selDate
  void selId
  void selResolvedPath
  void selResolvedLocale
  // @ts-expect-error `description` was not selected — it does not survive projection.
  void selectedPost.description
  // @ts-expect-error `authors` was not selected — it does not survive projection.
  void selectedPost.authors
}

// Populated fields survive even when not named in `select` (VNEXT.md 10.3).
const selectedPopulated = await one(posts, {
  by: { path: '/hello' },
  select: ['title'],
  populate: { authors: 'authors' }
})
if (selectedPopulated?.authors[0]) {
  const populatedAuthorName: string = selectedPopulated.authors[0].name
  void populatedAuthorName
}
if (selectedPopulated) {
  const selectedPopulatedTitle: string = selectedPopulated.title
  void selectedPopulatedTitle
  // @ts-expect-error `date` was neither selected nor populated — it is dropped.
  void selectedPopulated.date
}

// Without `select`, the complete inferred document is returned unchanged.
const unselectedPost = await one(posts, { by: { path: '/hello' } })
if (unselectedPost) {
  const fullDescription: string | undefined = unselectedPost.description
  const fullAuthors: string[] = unselectedPost.authors
  void fullDescription
  void fullAuthors
}

// `many` uses the same projection helper (VNEXT.md 10.3).
const selectedMany = await many(posts, { select: ['title'] })
const selectedManyItem = selectedMany[0]
if (selectedManyItem) {
  const selectedManyTitle: string = selectedManyItem.title
  const selectedManyId: string = selectedManyItem.id
  void selectedManyTitle
  void selectedManyId
  // @ts-expect-error `date` was not selected on the many() projection.
  void selectedManyItem.date
}

// `paginate` items use the same projection helper in both modes.
const selectedOffsetPage = await paginate(posts, { page: 1, limit: 5, select: ['title'] })
const selectedOffsetItem = selectedOffsetPage.data[0]
if (selectedOffsetItem) {
  const selectedOffsetTitle: string = selectedOffsetItem.title
  void selectedOffsetTitle
  // @ts-expect-error `date` was not selected on the paginate() offset projection.
  void selectedOffsetItem.date
}
const selectedOffsetTotal: number = selectedOffsetPage.total
void selectedOffsetTotal

const selectedCursorPage = await paginate(posts, { mode: 'cursor', after: null, limit: 5, select: ['title'] })
const selectedCursorItem = selectedCursorPage.data[0]
if (selectedCursorItem) {
  const selectedCursorTitle: string = selectedCursorItem.title
  void selectedCursorTitle
  // @ts-expect-error `date` was not selected on the paginate() cursor projection.
  void selectedCursorItem.date
}
// @ts-expect-error a cursor page has no `total`, even with a selection applied.
void selectedCursorPage.total

// `resolveOne().doc` uses the same projection helper (VNEXT.md 10.3).
const selectedResolve = await resolveOne(posts, { by: { path: '/hello' }, select: ['title'] })
if (selectedResolve.doc) {
  const selectedResolveTitle: string = selectedResolve.doc.title
  const selectedResolveLocale: string = selectedResolve.doc.resolution.resolved.locale
  void selectedResolveTitle
  void selectedResolveLocale
  // @ts-expect-error `date` was not selected on the resolveOne().doc projection.
  void selectedResolve.doc.date
}

/* ── Negative cases (must fail at type-check) ──────────────────────────── */

// @ts-expect-error i18n collection requires locale
await one(docs, { by: { ref: 'guide.intro' } })

// @ts-expect-error generated i18n collection names require locale
await one('docs', { by: { ref: 'guide.intro' } })

// @ts-expect-error generated collection names reject unknown literals
await one('missing', { by: { path: '/missing' } })

// @ts-expect-error generated collection names reject unknown literals in composables
await useContentPage('missing')

// @ts-expect-error i18n collection requires locale on many as well
await many(docs, { where: {} })

// @ts-expect-error i18n collection requires locale on pagination as well
await paginate(docs, { page: 1, limit: 10 })

// @ts-expect-error i18n source collection requires locale on backlinks
await backlinks(posts, { by: { path: '/hello' }, from: docs, via: { docs: ['post'] } })

await backlinks(authors, {
  locale: 'de',
  by: { ref: 'authors.evan' },
  from: posts,
  // @ts-expect-error backlink field maps accept source collection names only
  via: { postz: ['authors'] }
})

// @ts-expect-error by accepts exactly one selector
await one(posts, { by: { path: '/hello', ref: 'hello' } })

// @ts-expect-error typo'd field — QueryWhere is narrowed to declared schema fields
await many(posts, { where: { titel: 'Hello' } })

// @ts-expect-error typo'd field — generated collection names are narrowed too
await many('posts', { where: { titel: 'Hello' } })

// @ts-expect-error typo'd sort field — typed handles are narrowed to declared schema fields
await many(posts, { sort: { titel: 'asc' } })

// @ts-expect-error typo'd sort field — generated collection names are narrowed too
await many('posts', { sort: { titel: 'asc' } })

// @ts-expect-error typo'd select field — typed handles are narrowed to declared schema fields
await many(posts, { select: ['titel'] })

// @ts-expect-error typo'd select field — generated collection names are narrowed too
await many('posts', { select: ['titel'] })

// @ts-expect-error populate shorthand is intentionally not part of the public API
await one('docs', { locale: 'de', by: { path: '/leitfaden' }, populate: ['author'] })

// @ts-expect-error surround requires `by`
await surround(docs, { locale: 'de', ref: 'guide.intro' })

/* ── CS-7 (T5.5): i18n zero-arg / empty-options holes ──────────────────── */

// @ts-expect-error — i18n collections require a locale; zero-arg many() must not compile
await many(docs)

// @ts-expect-error — navigation options on i18n collections require `locale`
await navigation(docs, {})

// Control (must compile): zero-arg many on a non-i18n handle
await many(posts)

void blogResult
void docsResult

/**
 * Minimal stand-in for Nuxt's `useAsyncData` so this fixture can typecheck
 * the documented `useAsyncData(key, () => many(...))` migration recipe
 * (VNEXT.md 10.6) without depending on a live Nuxt app instance. Only the
 * type shape matters here — `pnpm typecheck` never executes this file.
 */
declare function useAsyncDataTypecheckOnly<T>(key: string, handler: () => Promise<T>): Promise<{ data: { value: T | undefined } }>
