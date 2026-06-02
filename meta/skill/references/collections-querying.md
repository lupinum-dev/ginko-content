# Collections And Querying

Use this for `content.config.ts`, collection schemas, references, unified query helpers, and data access examples.

## Collection-First Model

Collections are the public boundary. App and server code query a named collection, not an implicit global content bag.

```ts
import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'
import { z } from 'zod'

export const docs = defineCollection({
  type: 'page',
  source: 'docs/**/*.md',
  schema: z.object({
    title: z.string()
  })
})

export const blog = defineCollection({
  type: 'page',
  source: 'blog/**/*.md',
  schema: z.object({
    title: z.string(),
    published: z.boolean().default(true)
  })
})

export default defineContentConfig({
  collections: { docs, blog }
})
```

## `content.config.ts` Owns

- Collection names and source globs.
- Collection type: `page` or `data`.
- Zod schemas and `strict`.
- `reference(collection?)` fields.
- Collection-level i18n and sitemap flags.
- Provider registration and source-specific config.

`nuxt.config.ts` should not define the content model. It controls runtime behavior.

## Collection Types

- `type: 'page'`: route-backed content such as docs, blog posts, marketing pages, and legal pages.
- `type: 'data'`: queryable or referenceable data such as authors, categories, teams, or shared blocks.

Data collections do not own public routes by default and default to `sitemap: false`. Route, search, or sitemap access against data-only collections should fail clearly unless explicitly supported.

## Source Globs

Collection `source` is relative to `content/`. It can be:

- a string
- a string array
- an object with `include` and `exclude`

When globs overlap, the first matching collection wins. Keep examples deterministic and avoid relying on accidental overlap.

## References

Use `reference(collection?)` for typed content references. Resolve them through unified helpers:

- Client/list contexts: query the referenced collection explicitly when needed.
- Server contexts: `one(event, handle, { by: { ref }, locale, fallback })`.

Avoid raw path-string coupling when the goal is a stable content relationship.

## Client Query Helpers

Use collection handles exported from `content.config.ts` with the ADR-0016 helpers for lists, dashboards, search-adjacent views, and non-route-backed lookups.

Common helpers:

- `many(handle, options)` for lists.
- `one(handle, options)` for nullable single-document reads.
- `resolveOne(handle, options)` for diagnostic single-document reads.
- `tree(handle, options)` for navigation.
- `neighbors(handle, options)` for previous/next entries.
- `variants(handle, options)` for locale variants.

```ts
import { blog } from '~/content.config'

const posts = await many(blog, {
  where: { published: true },
  sort: { date: 'desc' },
  limit: 10
})
```

For route-backed pages, prefer `useContentOne(handle, { by: { route } })` over manually querying by path.

## Server Query Helpers

Use the same helper names from `#content/server` in server handlers and Nitro runtime code. Server helpers require the H3 event as the first argument so runtime context is explicit.

```ts
import { many } from '#content/server'
import { docs } from '~/content.config'

export default defineEventHandler(async (event) => {
  return await many(event, docs, {
    where: { published: true }
  })
})
```

Server queries should not bypass provider dispatch or read filesystem artifacts directly unless the task is provider implementation work.

## Provider Capability Rules

Provider-backed query behavior must respect declared capabilities. Unsupported operators or unsupported shapes should fail with typed provider errors, not silently degrade.

Contract tests reject query behavior that:

- omits the collection name
- accepts unsupported regex filters without validation
- returns data-only route results as if they were page results

## Where To Verify

- `test/contracts/query-contracts.test.ts`
- `test/contracts/query-plan-contracts.test.ts`
- `test/contracts/app-query-contracts.test.ts`
- `test/contracts/server-reference-contracts.test.ts`
- `test/contracts/ref-links-contracts.test.ts`
- `test/fixtures/typecheck`
