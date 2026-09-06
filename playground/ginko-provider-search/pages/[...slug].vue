<script setup lang="ts">
import { createError, useContentPage, definePageMeta } from '#imports'
import { docs } from '../content.config'

definePageMeta({ key: route => route.path })

const { page, status } = await useContentPage(docs)

if (status.value === 'not-found') {
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
