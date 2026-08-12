<script setup lang="ts">
import { pages } from '~/content.config'

definePageMeta({ key: route => route.path })

const { page } = await useContentPage(pages)

if (!page.value) {
  throw createError({ statusCode: 404, statusMessage: 'Page not found', fatal: true })
}
</script>

<template>
  <ContentRenderer v-if="page" :value="page" />
</template>
