# Collections

Use this when writing or changing `content.config.ts`, collection schemas, references, or filesystem sources.

## Minimal page collection

```ts
import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'
import { z } from 'zod'

export const docs = defineCollection('docs', {
  type: 'page',
  source: 'docs/**/*.md',
  schema: z.object({
    title: z.string(),
    description: z.string().optional()
  })
})

export default defineContentConfig({
  collections: {
    docs
  }
})
```

Export the collection handle when app code imports it:

```ts
import { docs } from '~/content.config'
```

## Source rules

- Filesystem-backed collections need `source`.
- Provider-backed collections may omit `source` when the provider owns lookup.
- Collection globs must be disjoint. A file matching multiple collections is an error.
- Use `source.exclude` to keep broad collections from swallowing narrow ones.
- Do not include locale folders in `source` for `i18n: true` collections.

## Page vs data

Use `type: 'page'` for content with public routes, navigation, search links, or sitemap output.

Use `type: 'data'` for records that do not have their own public URL. Keep data-only collections out of sitemap output. If the data needs a public URL, model it as a page collection.

## Schemas

Plain Zod unknown-key behavior still applies. `strict: true` on the collection controls fail-vs-warn for validation errors, but it does not reject undeclared frontmatter keys by itself.

Use strict Zod objects when unknown keys should fail:

```ts
schema: z.object({
  title: z.string(),
  description: z.string().optional()
}).strict()
```

Prefer `z.string()` for dates that are read in client components:

```ts
schema: z.object({
  date: z.string()
})
```

Only use `z.coerce.date()` when the app is prepared for client transport serialization. Payloads crossing the public HTTP boundary may arrive as strings.

## References

Give referenced documents a stable `id` or `ref` before using short aliases:

```md
---
id: jane-doe
name: Jane Doe
---
```

```md
---
title: Launch notes
author: jane-doe
---
```

For path-based references, use the canonical content path rather than a route-localized `path`.
