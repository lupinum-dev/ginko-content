<script setup lang="ts">
import { createError, useContentPage } from '#imports'
import { docs } from '../content.config'

definePageMeta({ key: route => route.path })

const { page } = await useContentPage(docs)

if (!page.value) {
  throw createError({ statusCode: 404, statusMessage: 'Document not found', fatal: true })
}
</script>

<template>
  <main>
    <h1 v-if="page">
      {{ page.title }}
    </h1>
  </main>
</template>
