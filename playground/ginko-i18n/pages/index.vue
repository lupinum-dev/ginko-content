<script setup lang="ts">
import { useContentPage } from '#imports'
import { docs } from '../content.config'

const { page } = await useContentPage(docs, {
  fallback: true
})
</script>

<template>
  <ContentRenderer v-if="page" :value="page" />
</template>
