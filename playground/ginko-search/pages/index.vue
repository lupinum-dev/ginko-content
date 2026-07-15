<script setup lang="ts">
import { computed } from 'vue'
import { useContentSearch } from '@lupinum/ginko-content/client'

const { results, pending } = await useContentSearch({ initialQuery: 'guide' })
const normalizedResults = computed(() => (results.value || []).map(result => ({
  path: result.path,
  title: result.title,
  anchor: result.anchor || null
})))
</script>

<template>
  <main>
    <h1>Built-in Search Playground</h1>
    <p>Normalized search results from Ginko.</p>
    <p id="pending">
      {{ pending }}
    </p>
    <pre id="results">{{ JSON.stringify(normalizedResults, null, 2) }}</pre>
  </main>
</template>
