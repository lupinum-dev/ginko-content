<script setup lang="ts">
import { one, many } from '#imports'
import { posts, data } from '../content.config'

const exact = await one(posts, { by: { path: '/blog/hello-world' } })
const allPosts = await many(posts, {
  where: { _navigation: { $ne: true }, _partial: { $ne: true }, _draft: { $ne: true } },
  sort: { date: 'asc' }
})
const draftCount = (await many(posts, { where: { _draft: true } })).length
const postCount = allPosts.length
const windowed = await many(posts, {
  where: { _navigation: { $ne: true }, _partial: { $ne: true }, _draft: { $ne: true } },
  sort: { date: 'asc' },
  skip: 1,
  limit: 1
})
const selectedTitle = await one(posts, {
  by: { path: '/blog/hello-world' },
  select: ['title']
})
const jsonDoc = await one(data, { by: { path: '/data/app' } })
const yamlDoc = await one(data, { by: { path: '/data/team' } })
const csvDoc = await one(data, { by: { path: '/data/metrics' } })
</script>

<template>
  <pre>{{ JSON.stringify({
    exactPath: exact?._path,
    postTitles: allPosts.map(post => post.title),
    postCount,
    postCountViaCount: postCount,
    draftCount,
    windowedTitles: windowed.map(post => post.title),
    selectedTitle,
    selectedTitleHasBody: Object.prototype.hasOwnProperty.call(selectedTitle || {}, 'body'),
    jsonDoc,
    yamlDoc,
    csvDoc
  }, null, 2) }}</pre>
</template>
