<script setup lang="ts">
const docLocales = await $fetch('/api/_content/locales/docs', { query: { identity: '1/1' } })
const authorLocales = await $fetch('/api/_content/locales/authors', { query: { identity: 'authors/evan' } })
</script>

<template>
  <pre>{{ JSON.stringify({
    docLocales,
    authorLocales
  }, null, 2) }}</pre>
</template>
