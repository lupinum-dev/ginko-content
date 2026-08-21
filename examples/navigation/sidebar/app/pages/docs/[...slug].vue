<script setup lang="ts">
import { defineContentPage } from '@lupinum/ginko-content/client'
import { docs } from '../../../content.config'

definePageMeta({ key: route => route.path })

const { page } = await defineContentPage(docs)
</script>

<template>
  <ContentRenderer v-if="page" :value="page" />
</template>
