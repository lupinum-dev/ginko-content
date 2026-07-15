<script setup lang="ts">
import { prefixDocsNavigation } from '../utils/docs'

const route = useRoute()

const { data: navigation } = await useAsyncData('docs-navigation', async () => {
  const items = await $fetch('/api/_content/navigation', {
    query: {
      collection: 'docs'
    }
  })
  return prefixDocsNavigation(items)
})

const links = computed(() => [
  {
    label: 'Docs',
    to: '/docs/why-ginko',
    active: route.path.startsWith('/docs'),
    icon: 'i-lucide-book'
  }, {
    label: 'GitHub',
    to: 'https://github.com/lupinum-dev/ginko-content',
    target: '_blank',
    icon: 'i-simple-icons-github'
  }
])
</script>

<template>
  <UHeader>
    <template #left>
      <NuxtLink to="/" class="inline-flex items-end gap-2" aria-label="Back to home">
        <HubLogo class="h-6" />
      </NuxtLink>
    </template>

    <UNavigationMenu :items="links.map(({ icon, ...link }) => link)" variant="link" :ui="{ link: 'text-highlighted hover:text-primary data-active:text-primary' }" />

    <template #right>
      <div class="flex items-center gap-2">
        <UColorModeButton />
        <UButton to="https://github.com/lupinum-dev/ginko-content" target="_blank" icon="i-simple-icons-github" variant="ghost" color="neutral" />
      </div>
    </template>

    <template #body>
      <UContentNavigation :navigation="navigation || []" highlight type="single" :default-open="$route.path.startsWith('/docs')" />

      <div class="flex flex-col gap-y-2 mt-4">
        <USeparator class="mb-4" />
        <UButton label="Get started" color="neutral" to="/docs/get-started/installation" class="flex justify-center text-gray-900 bg-primary sm:hidden" />
      </div>
    </template>
  </UHeader>
</template>
