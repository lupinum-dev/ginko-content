<script setup lang="ts">
import { createError, useContentPage } from '#imports'
import { pages } from '../content.config'

definePageMeta({ key: route => route.path })

const { page } = await useContentPage(pages)

if (!page.value) {
  throw createError({ statusCode: 404, statusMessage: 'Document not found', fatal: true })
}
</script>

<template>
  <ContentRenderer v-if="page" :value="page" />
</template>
