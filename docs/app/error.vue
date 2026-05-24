<script setup lang="ts">
import type { NuxtError } from '#app'
import { prefixDocsNavigation } from './utils/docs'

useSeoMeta({
  title: 'Page not found',
  description: 'We are sorry but this page could not be found.'
})

defineProps({
  error: {
    type: Object as PropType<NuxtError>,
    required: true
  }
})
useHead({
  htmlAttrs: {
    lang: 'en'
  }
})

const { data: navigation } = await useAsyncData('navigation', async () => {
  const items = await $fetch('/api/_content/navigation', {
    query: {
      collection: 'docs'
    }
  })
  return prefixDocsNavigation(items)
})
provide('navigation', navigation)
</script>

<template>
  <UApp>
    <AppHeader />
    <UError :error="error" />

    <AppFooter />
  </UApp>
</template>
