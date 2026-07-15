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
    <p data-testid="order">
      order: {{ page.order }}
    </p>
    <p data-testid="word-count">
      wordCount: {{ (page as unknown as { wordCount?: number }).wordCount }}
    </p>
    <ContentRenderer :value="page" />
  </article>
  <p v-else>
    Document not found.
  </p>
</template>
