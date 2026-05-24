<script setup lang="ts">
import { computed, ref } from 'vue'
import { useContentSearchResults } from '@lupinum/ginko-content/client'

const term = ref('guide')
const { results, pending } = await useContentSearchResults(term)
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
