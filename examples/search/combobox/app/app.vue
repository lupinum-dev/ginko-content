<script setup lang="ts">
import { useContentSearch } from '@lupinum/ginko-content/client'
import { pages } from '../content.config'

const search = await useContentSearch({
  collection: pages,
  limit: 5
})

function onKeydown (event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    search.next()
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    search.previous()
  } else if (event.key === 'Enter') {
    const selected = search.select()
    if (selected) {
      search.reset()
      navigateTo(selected.path)
    }
  }
}
</script>

<template>
  <div class="wrap">
    <input
      class="search"
      type="search"
      placeholder="Search… (arrow keys, Enter)"
      :value="search.query.value"
      aria-label="Search content"
      @input="search.setQuery(($event.target as HTMLInputElement).value)"
      @keydown="onKeydown"
    >
    <ul v-if="search.hasResults.value" class="results" role="listbox">
      <li
        v-for="(result, index) in search.results.value"
        :key="result.path"
        :aria-selected="index === search.activeIndex.value"
        class="result"
        :class="{ active: index === search.activeIndex.value }"
      >
        <NuxtLink :to="result.path" @click="search.reset()">
          {{ result.title }}
        </NuxtLink>
      </li>
    </ul>
    <p v-else-if="search.isEmpty.value">
      No matches.
    </p>
    <NuxtPage class="prose text-left" />
  </div>
</template>

<style scoped>
.wrap { max-width: 40rem; margin: 0 auto; }
.search { width: 100%; padding: 0.5rem; }
.results { list-style: none; padding: 0; border: 1px solid #ddd; }
.result.active { background: #eef; }
.result a { display: block; padding: 0.4rem 0.6rem; }
</style>
