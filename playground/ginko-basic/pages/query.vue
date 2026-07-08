<script setup lang="ts">
import { one, many } from '@lupinum/ginko-content/client'
import { posts, data } from '../content.config'

const exact = await one(posts, { by: { path: '/blog/hello-world' } })
const allPosts = await many(posts, {
  where: { navigationFile: { $ne: true }, partial: { $ne: true }, draft: { $ne: true } },
  sort: { date: 'asc' }
})
const draftCount = (await many(posts, { where: { draft: true } })).length
const postCount = allPosts.length
const windowed = await many(posts, {
  where: { navigationFile: { $ne: true }, partial: { $ne: true }, draft: { $ne: true } },
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
    exactPath: exact?.path,
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
