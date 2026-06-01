<script setup lang="ts">
import { one } from '@lupinum/ginko-content/client'
import { pages } from './content.config'

const page = await one(pages, {
  by: { path: '/' }
})
</script>

<template>
  <NuxtExampleLayout example="mdc/inline-component" repo="lupinum-dev/ginko-content">
    <ContentRenderer v-if="page" :value="page" class="prose text-left" />
  </NuxtExampleLayout>
</template>
