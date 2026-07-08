<script setup lang="ts">
import { useAsyncData } from '#imports'

const { data: nav } = await useAsyncData('docs-nav', () => $fetch('/api/_content/navigation', {
  query: {
    collection: 'docs'
  }
}))
</script>

<template>
  <pre>{{ JSON.stringify((nav || []).map(item => ({ title: item.title, path: item.path, fallback: item.fallback, children: item.children?.map(child => ({ title: child.title, path: child.path, fallback: child.fallback })) })), null, 2) }}</pre>
</template>
