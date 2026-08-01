<script setup lang="ts">
import { useFetch } from '#imports'
import { onMounted, ref } from 'vue'

const { data } = await useFetch('/api/hmr-state')
const clientReady = ref(false)

onMounted(() => {
  clientReady.value = true
})
</script>

<template>
  <main>
    <p data-testid="client-ready">{{ clientReady }}</p>
    <p data-testid="boot-id">{{ data?.bootId }}</p>
    <p data-testid="watched-title">{{ data?.watchedTitle }}</p>
    <p data-testid="cache-marker">{{ data?.cacheMarker }}</p>
    <p data-testid="secondary-title">{{ data?.secondaryTitle }}</p>
  </main>
</template>
