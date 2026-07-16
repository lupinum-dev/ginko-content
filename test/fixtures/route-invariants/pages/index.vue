<script setup lang="ts">
import { useContentPage } from '#imports'
import { docs } from '../content.config'

const { page } = await useContentPage(docs, {
  fallback: true
})
</script>

<template>
  <article v-if="page">
    <h1>{{ page.title }}</h1>
    <ContentRenderer :value="page" />
  </article>
</template>
