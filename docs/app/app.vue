<script setup lang="ts">
import { prefixDocsNavigation } from './utils/docs'

const { seo } = useAppConfig()
const { data: navigation } = await useAsyncData('navigation', async () => {
  const items = await $fetch('/api/_content/navigation', {
    query: {
      collection: 'docs'
    }
  })
  return prefixDocsNavigation(items)
})
useHead({
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1' }
  ],
  link: [
    { rel: 'icon', href: '/favicon.ico' }
  ],
  htmlAttrs: {
    lang: 'en'
  }
})

useSeoMeta({
  ogSiteName: seo?.siteName,
  twitterCard: 'summary_large_image',
  titleTemplate(title) {
    return title?.includes('@lupinum/ginko-content') ? title : `${title} · @lupinum/ginko-content`
  }
})

provide('navigation', navigation)
</script>

<template>
  <UApp>
    <AppHeader />
    <UMain class="relative">
      <NuxtLayout>
        <NuxtPage />
      </NuxtLayout>
    </UMain>
    <AppFooter />
  </UApp>
</template>
