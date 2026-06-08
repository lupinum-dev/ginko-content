<script setup lang="ts">
import { useContentPage } from '#imports'
import { docs } from '../content.config'

const { data: page } = await useContentPage(docs, {
  fallback: true,
  notFound: false
})
</script>

<template>
  <ContentRenderer v-if="page" :value="page" />
</template>
