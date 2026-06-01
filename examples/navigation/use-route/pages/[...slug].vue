<script setup lang="ts">
import { useContentPage } from '@lupinum/ginko-content/client'
import { pages } from '../content.config'

const { page } = await useContentPage(pages)
</script>

<template>
  <main class="prose text-left">
    <ContentRenderer v-if="page" :value="page" />
  </main>
</template>
