<script setup lang="ts">
import { defineContentPage } from '@lupinum/ginko-content/client'
import { pages } from '../content.config'

definePageMeta({ key: route => route.path })

const { page } = await defineContentPage(pages)
</script>

<template>
  <main class="prose">
    <ContentRenderer v-if="page" :value="page" />
  </main>
</template>
