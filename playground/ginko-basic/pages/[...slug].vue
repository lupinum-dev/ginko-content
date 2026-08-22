<script setup lang="ts">
import { createError, useContentPage } from '#imports'
import { pages } from '../content.config'

definePageMeta({ key: route => route.path })

const { page, status } = await useContentPage(pages)

if (status.value === 'not-found') {
  throw createError({ statusCode: 404, statusMessage: 'Document not found', fatal: true })
}
</script>

<template>
  <ContentRenderer v-if="page" :value="page" />
</template>
