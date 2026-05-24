<script setup lang="ts">
import { setResponseStatus, useContentPage } from '#imports'

const { page } = await useContentPage('pages', {
  notFound: false
})

if (import.meta.server && !page.value) {
  setResponseStatus(404, 'Document not found')
}
</script>

<template>
  <ContentRenderer v-if="page" :value="page" />
  <p v-else>Document not found.</p>
</template>
