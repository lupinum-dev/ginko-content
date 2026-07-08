<script setup lang="ts">
import { useContentMany } from '@lupinum/ginko-content/client'
import { ref } from 'vue'
import { posts } from './content.config'

const skip = ref(2)
const limit = ref(2)

const { data } = await useContentMany(posts, {
  skip,
  limit
})
</script>

<template>
  <NuxtExampleLayout example="queries/skip-limit" repo="lupinum-dev/ginko-content">
    <label for="skip">Skip ({{ skip }})</label>
    <input id="skip" v-model="skip" type="range" min="0" max="5">
    <label for="skip">Limit ({{ limit }})</label>
    <input id="limit" v-model="limit" type="range" min="1" max="5">
    <section>
      <h2>Results: </h2>
      <ul>
        <li v-for="{path, title} in data" :key="path">
          {{ title }}
        </li>
      </ul>
    </section>
  </NuxtExampleLayout>
</template>
