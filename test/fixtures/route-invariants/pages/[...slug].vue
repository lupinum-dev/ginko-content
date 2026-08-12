<script setup lang="ts">
import { useContentPage } from '#imports'
import { docs } from '../content.config'

// Noncanonical fixture policy: static route-invariant coverage intentionally
// renders a local 200 fallback for missing paths instead of Nuxt's error page.
definePageMeta({ key: route => route.path })

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
