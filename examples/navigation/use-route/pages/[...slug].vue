<script setup lang="ts">
import { useContentPage } from '@lupinum/ginko-content/client'

const { page } = await useContentPage('pages')
</script>

<template>
  <main class="prose text-left">
    <ContentRenderer v-if="page" :value="page" />
  </main>
</template>
