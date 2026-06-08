<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useContentSearchResults } from '@lupinum/ginko-content/client'
import { ref } from 'vue'

const { locale } = useI18n()
const term = ref('')
const { results, pending } = await useContentSearchResults(term, {
  locale: () => locale.value
})
</script>

<template>
  <main>
    <h1>Search</h1>
    <label for="search-input">Search term</label>
    <input id="search-input" v-model="term" type="search">
    <p v-if="pending">Searching</p>
    <ul aria-label="Search results">
      <li v-for="result in results" :key="`${result.path}:${result.anchor || ''}`">
        <NuxtLink :to="result.path">
          {{ result.title }}
        </NuxtLink>
      </li>
    </ul>
  </main>
</template>
