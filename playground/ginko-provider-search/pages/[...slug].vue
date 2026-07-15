<script setup lang="ts">
import { setResponseStatus, useContentPage } from '#imports'
import { docs } from '../content.config'

const { page } = await useContentPage(docs)

if (import.meta.server && !page.value) {
  setResponseStatus(404, 'Document not found')
}
</script>

<template>
  <main>
    <h1 v-if="page">
      {{ page.title }}
    </h1>
    <p v-else>
      Document not found.
    </p>
  </main>
</template>
