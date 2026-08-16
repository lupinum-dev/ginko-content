<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useContentSearch } from '@lupinum/ginko-content/client'

const { locale } = useI18n()
const { query, results, pending } = await useContentSearch({
  locale: () => locale.value
})
</script>

<template>
  <main>
    <h1>Search</h1>
    <label for="search-input">Search term</label>
    <input id="search-input" v-model="query" type="search">
    <p v-if="pending">Searching</p>
    <ul aria-label="Search results">
      <li v-for="result in results" :key="`${result.path}:${result.anchor || ''}`">
        <NuxtLink :to="result.path" :prefetch="false">
          {{ result.title }}
        </NuxtLink>
      </li>
    </ul>
  </main>
</template>
