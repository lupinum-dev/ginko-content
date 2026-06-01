<script setup lang="ts">
import { one } from '@lupinum/ginko-content/client'
import { pages } from './content.config'

const data = await one(pages, {
  by: { path: '/' },
  select: ['title']
})
</script>

<template>
  <NuxtExampleLayout example="queries/without" repo="lupinum-dev/ginko-content">
    <p>The <code>select: ['title']</code> query keeps the content fields explicit while route metadata stays available.</p>
    <ul v-if="data">
      <li v-for="item in Object.keys(data)" :key="item">
        {{ item }}
      </li>
    </ul>
  </NuxtExampleLayout>
</template>
