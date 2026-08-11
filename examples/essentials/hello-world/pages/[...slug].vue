<script setup lang="ts">
import { useContentPage } from '@lupinum/ginko-content/client'
import { createError } from '#imports'
import { pages } from '../content.config'

definePageMeta({ key: route => route.path })

const { page } = await useContentPage(pages)

if (!page.value) {
  throw createError({ statusCode: 404, statusMessage: 'Page not found', fatal: true })
}
</script>

<template>
  <main class="prose">
    <ContentRenderer v-if="page" :value="page" />
  </main>
</template>
