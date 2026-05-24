# CMS Cache Contract Demo

This example shows the cache/invalidation contract for a CMS-backed provider.

Run it with:

```bash
pnpm example advanced/cms-cache-contract
```

The demo contains:

- `server/cms-provider.ts` — provider methods returning `withContentCache(data, hint)`
- `server/content-cache.ts` — a cache adapter that applies response headers and records purges
- `server/api/cms/publish-author.post.ts` — simulated CMS publish webhook
- `server/cms-store.ts` — in-memory authors, posts, and cache event logs

Try the author dependency scenario:

```bash
curl -X POST http://localhost:3000/api/cms/publish-author \
  -H 'content-type: application/json' \
  -d '{"author":"alice","name":"Alicia"}'
```

Expected invalidation:

- `/authors/alice`
- `/blog/post-1` through `/blog/post-5`
- `/blog`

`/blog/post-6` references Bob, so it should not be included.
