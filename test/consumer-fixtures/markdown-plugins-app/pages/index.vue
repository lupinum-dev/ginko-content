<script setup lang="ts">
import { one } from '@lupinum/ginko-content/client'
import { pages } from '../content.config'

const page = await one(pages, { by: { path: '/' } })
</script>

<template>
  <ContentRenderer
    v-if="page"
    :value="page"
  />
</template>
