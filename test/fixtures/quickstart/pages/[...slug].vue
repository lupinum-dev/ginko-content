<script setup lang="ts">
import { pages } from '~/content.config'

const { page } = await useContentPage(pages)
</script>

<template>
  <ContentRenderer v-if="page" :value="page" />
</template>
