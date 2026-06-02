/**
 * Type-level tests for the unified query API (ADR-0016).
 *
 * Compiled by `pnpm typecheck`. Negative tests (`@ts-expect-error`) assert
 * that obvious misuses fail at the type level.
 */
import type {} from '../.nuxt/types/content'
import type { ContentCollectionName, DocumentFromHandle, LocalizedDoc, QueryWhere, OneOptions } from '@lupinum/ginko-content/client'
import { getCollectionPath, one, many, paginate, backlinks, neighbors, tree, variants, useContentBacklinks, useContentMany, useContentNavigation, useContentOne, useContentPage, useContentPagination, useContentResolveOne, useContentSearch, useContentSearchData, useContentSearchResults } from '@lupinum/ginko-content/client'
import { defineCollection, defineContentConfig, reference } from '@lupinum/ginko-content/config'
import { createFixtureContentProvider, createProviderFixture, createProviderFixtureEvent } from '@lupinum/ginko-content/testing/provider-fixture'
import { useContentPagination as autoUseContentPagination, useContentBacklinks as autoUseContentBacklinks } from '#imports'
import { z } from 'zod'

const docs = defineCollection('docs', {
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

const authors = defineCollection('authors', {
  type: 'data',
  source: 'authors/*.yml',
  i18n: true,
  schema: z.object({
    name: z.string(),
    role: z.string().optional()
  })
})

const posts = defineCollection('posts', {
  type: 'page',
  source: 'posts/**/*.md',
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    date: z.union([z.string(), z.date()]),
    authors: z.array(reference('authors')),
    image: z.object({ src: z.string() }).optional()
  })
})

const _contentConfig = defineContentConfig({
  collections: { docs, authors, posts }
})
void _contentConfig

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false
type Expect<T extends true> = T

/* ── Type-level shape probes ────────────────────────────────────────────── */

// Handles carry the i18n discriminator at the type level.
type _ProbeDocsI18n = Expect<Equal<typeof docs.__i18n, true>>
type _ProbePostsI18n = Expect<Equal<typeof posts.__i18n, false>>

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
type _BlogHasLocalePaths = Expect<Equal<BlogDoc['localePaths'], LocalizedDoc['localePaths']>>
type _BlogHasResolvedLocale = Expect<Equal<BlogDoc['resolved']['locale'], string>>
type _BlogHasResolvedFallback = Expect<Equal<BlogDoc['resolved']['fallback'], boolean>>

// String collection names keep generated document inference.
const stringBlogResult = await one('posts', { by: { path: '/hello' } })
if (stringBlogResult) {
  const stringBlogTitle: string = stringBlogResult.title
  const stringBlogDate: string | Date = stringBlogResult.date
  const stringBlogAuthors: string[] = stringBlogResult.authors
  void stringBlogTitle
  void stringBlogDate
  void stringBlogAuthors
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

const stringManyPosts = await useContentMany('posts', {
  where: { title: { $exists: true } },
  sort: { date: 'desc' },
  select: ['title', 'date', 'authors']
})
const firstStringPost = stringManyPosts.data.value[0]
if (firstStringPost) {
  const title: string = firstStringPost.title
  const date: string | Date = firstStringPost.date
  const authors: string[] = firstStringPost.authors
  void title
  void date
  void authors
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
type _DocsResolvedRequestedLocale = Expect<Equal<DocsDoc['resolved']['requestedLocale'], string | undefined>>

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
  const pagedDate: string | Date = pagedPost.date
  void pagedTitle
  void pagedDate
}
const pageTotal: number = pagedPosts.total
const pageNext: number | null = pagedPosts.nextPage
void pageTotal
void pageNext

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

const mixedBacklinks = await backlinks(authors, {
  locale: 'de',
  by: { ref: 'authors.evan' },
  from: [posts, docs],
  fields: {
    posts: ['authors'],
    docs: ['author']
  }
})
const mixedBacklink = mixedBacklinks[0]
if (mixedBacklink) {
  const title: string = mixedBacklink.title
  void title
}

// Composables mirror the same option shape.
const manyDocs = await useContentMany(posts, { where: { title: { $exists: true } } })
const firstManyPost = manyDocs.data.value[0]
if (firstManyPost) {
  const typedTitle: string = firstManyPost.title
  const typedDate: string | Date = firstManyPost.date
  const typedAuthors: string[] = firstManyPost.authors
  const resolvedFallback: boolean = firstManyPost.resolved.fallback
  void typedTitle
  void typedDate
  void typedAuthors
  void resolvedFallback
}
const manyPopulatedDocs = await useContentMany(docs, {
  locale: 'de',
  populate: { author: authors }
})
if (manyPopulatedDocs.data.value[0]?.author) {
  const authorName: string = manyPopulatedDocs.data.value[0].author.name
  void authorName
}
if (manyPopulatedDocs.data.value[0]) {
  const populatedDocTitle: string = manyPopulatedDocs.data.value[0].title
  void populatedDocTitle
}
const oneDoc = await useContentOne(docs, { locale: 'de', by: { path: '/leitfaden' } })
if (oneDoc.data.value) {
  const resolvedLocale: string = oneDoc.data.value.resolved.locale
  const related: string | undefined = oneDoc.data.value.related
  void resolvedLocale
  void related
}
const explained = await useContentResolveOne(docs, { locale: 'de', by: { ref: 'guide.intro' } })
void explained

// Route pages may omit locale even for typed i18n handles because the route is
// the selector. Surround entries return navigation items, not full documents.
const routePage = await useContentPage(docs, { surround: true, notFound: false })
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

const stringRoutePage = await useContentPage('docs', { surround: true, notFound: false })
const stringRouteDataTitle: string | undefined = stringRoutePage.data.value?.title
const stringRoutePageTitle: string | undefined = stringRoutePage.page.value?.title
const stringRoutePreviousTitle: string | undefined = stringRoutePage.surround.value.previous?.title
const stringRouteNextTitle: string | undefined = stringRoutePage.surround.value.next?.title
void stringRouteDataTitle
void stringRoutePageTitle
void stringRoutePreviousTitle
void stringRouteNextTitle

const paginated = await useContentPagination(posts, { page: 1, limit: 10 })
const firstPaginatedPost = paginated.data.value[0]
if (firstPaginatedPost) {
  const title: string = firstPaginatedPost.title
  void title
}
const hasNextPage: boolean = paginated.hasNext.value
void hasNextPage

const backlinkData = await useContentBacklinks(authors, {
  locale: 'de',
  by: { ref: 'authors.evan' },
  from: posts
})
const firstBacklink = backlinkData.data.value[0]
if (firstBacklink) {
  const title: string = firstBacklink.title
  void title
}

const authorPath = getCollectionPath(authors, { slug: 'evan', locale: 'de', defaultLocale: 'en', locales: ['en', 'de'] })
const typedAuthorPath: string = authorPath
void typedAuthorPath

// Search composables (out of scope for ADR-0016 but kept).
void useContentSearchData(docs)
void useContentSearchResults('guide')
const headlessSearch = await useContentSearch({ initialQuery: 'guide', limit: 5 })
headlessSearch.setQuery('intro')
headlessSearch.next()
const selectedSearchResult = headlessSearch.select()
if (selectedSearchResult) {
  const searchPath: string = selectedSearchResult.path
  void searchPath
}

/* ── Auto-imported variants ─────────────────────────────────────────────── */

const autoPagination = await autoUseContentPagination(posts, { page: 1, limit: 5 })
void autoPagination
const autoBacklinkData = await autoUseContentBacklinks(authors, {
  locale: 'de',
  by: { ref: 'authors.evan' },
  from: posts
})
void autoBacklinkData
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

/* ── tree() returns typed navigation items, not unknown[] ──────────────── */

const navResult = await tree(docs, { locale: 'de', fields: ['title'] as const })
type _NavItem = typeof navResult[number]
type _NavTitleIsTyped = Expect<Equal<_NavItem['title'], string>>
void navResult

const navigationState = await useContentNavigation('docs', {
  locale: 'de',
  fields: ['title', 'author'] as const
})
const navigationItem = navigationState.data.value[0]
if (navigationItem) {
  const navigationId: string = navigationItem.id
  const navigationPath: string = navigationItem.path
  const firstNavigationPath: string | undefined = navigationState.firstPage.value?.path
  const hasNavigationPath: boolean = navigationState.paths.value.has(navigationPath)
  void navigationId
  void navigationPath
  void firstNavigationPath
  void hasNavigationPath
}

/* ── variants/neighbors take by (not top-level ref/path) ───────────────── */

const variantList = await variants(docs, { locale: 'de', by: { ref: 'guide.intro' } })
void variantList

const neighborEntries = await neighbors(docs, { locale: 'de', by: { ref: 'guide.intro' } })
void neighborEntries

/* ── Negative cases (must fail at type-check) ──────────────────────────── */

// @ts-expect-error i18n collection requires locale
await one(docs, { by: { ref: 'guide.intro' } })

// @ts-expect-error generated i18n collection names require locale
await one('docs', { by: { ref: 'guide.intro' } })

// @ts-expect-error generated collection names reject unknown literals
await one('missing', { by: { path: '/missing' } })

// @ts-expect-error generated collection names reject unknown literals in composables
await useContentPage('missing', { notFound: false })

// @ts-expect-error i18n collection requires locale on many as well
await many(docs, { where: {} })

// @ts-expect-error i18n collection requires locale on pagination as well
await paginate(docs, { page: 1, limit: 10 })

// @ts-expect-error i18n collection requires locale on pagination composable as well
await useContentPagination(docs, { page: 1, limit: 10 })

// @ts-expect-error i18n source collection requires locale on backlinks
await backlinks(posts, { by: { path: '/hello' }, from: docs, fields: { docs: ['post'] } })

await backlinks(authors, {
  locale: 'de',
  by: { ref: 'authors.evan' },
  from: posts,
  // @ts-expect-error backlink field maps accept source collection names only
  fields: { postz: ['authors'] }
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

// @ts-expect-error variants requires `by`
await variants(docs, { ref: 'guide.intro' })

// @ts-expect-error neighbors requires `by`
await neighbors(docs, { locale: 'de', ref: 'guide.intro' })

void blogResult
void docsResult
