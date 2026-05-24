<script setup lang="ts">
import { useContentOne, useRoute } from '#imports'
import { pages } from '../content.config'

const route = useRoute()
const { data: page } = await useContentOne(pages, {
  by: { path: () => route.path }
})
</script>

<template>
  <ContentRenderer v-if="page" :value="page" />
</template>
