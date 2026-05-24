<script setup lang="ts">
import { useContentOne, useRoute, setResponseStatus } from '#imports'
import { pages } from '../content.config'

const route = useRoute()
const { data: page } = await useContentOne(pages, {
  by: { path: route.path }
})

if (import.meta.server && !page.value) {
  setResponseStatus(404, 'Document not found')
}
</script>

<template>
  <ContentRenderer v-if="page" :value="page" />
  <p v-else>Document not found.</p>
</template>
