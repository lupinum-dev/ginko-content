<script setup lang="ts">
const { page } = await useContentPage('landing')

useSeoMeta({
  title: () => (page.value as any)?.seo?.title || (page.value as any)?.title || '',
  description: () => (page.value as any)?.seo?.description || (page.value as any)?.description || '',
  ogTitle: () => (page.value as any)?.seo?.title || (page.value as any)?.title || '',
  ogDescription: () => (page.value as any)?.seo?.description || (page.value as any)?.description || ''
})
</script>

<template>
  <ContentRenderer v-if="page" :value="page" :prose="false" />
</template>
