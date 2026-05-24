<script setup lang="ts">
import { useContentVariants } from '#imports'
import { docs } from '../content.config'

// Fully-translated doc — both en and de variants exist.
const { data: fullyTranslated } = await useContentVariants(docs, {
  locale: 'en',
  by: { ref: 'guide-getting-started' }
})

// Partially-translated doc — only en exists, de falls back.
const { data: partial } = await useContentVariants(docs, {
  locale: 'en',
  by: { ref: 'guide-advanced' }
})
</script>

<template>
  <div>
    <h2>variants(): fully translated</h2>
    <pre>{{ JSON.stringify(fullyTranslated, null, 2) }}</pre>

    <h2>variants(): partial (en only)</h2>
    <pre>{{ JSON.stringify(partial, null, 2) }}</pre>
  </div>
</template>
