<script setup lang="ts">
import { defineContentPage } from '@lupinum/ginko-content/client'
import { docs } from '../../content.config'

definePageMeta({ key: route => route.path })

const { page } = await defineContentPage(docs)
</script>

<template>
  <div v-if="page">
    <p>
      <a :href="`${page.route.resolvedPath}.md`">View this page as markdown</a>
    </p>
    <ContentRenderer :value="page" />
  </div>
</template>
