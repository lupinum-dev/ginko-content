<script setup lang="ts">
import { computed, ref } from 'vue'
import { useContentSearch } from '@lupinum/ginko-content/client'

const { results, pending } = await useContentSearch({ initialQuery: 'guide' })
const normalizedResults = computed(() => (results.value || []).map(result => ({
  path: result.path,
  title: result.title,
  anchor: result.anchor || null
})))
const inlineValue = ref('<!-- inline-secret -->\n\n> [!NOTE]\n> **Inline baseline**')
const updateInline = () => {
  inlineValue.value = 'Stale intermediate value'
  queueMicrotask(() => {
    inlineValue.value = '- [x] Updated inline value'
  })
}
</script>

<template>
  <main>
    <h1>Built-in Search Playground</h1>
    <p>Normalized search results from Ginko.</p>
    <p id="pending">
      {{ pending }}
    </p>
    <pre id="results">{{ JSON.stringify(normalizedResults, null, 2) }}</pre>
    <ContentRendererInline id="inline-baseline" tag="div" :value="inlineValue" />
    <button id="update-inline" type="button" @click="updateInline">
      Update inline Markdown
    </button>
  </main>
</template>
