<script setup lang="ts">
import { useContentPage, definePageMeta } from '#imports'
import { docs } from '../content.config'

// Load before the layout so its shared header has content facts during SSR.
// Missing fixture documents keep the existing 200 fallback for output checks.
definePageMeta({ layout: false, key: route => route.path })
const contentPage = await useContentPage(docs, { fallback: true })
const { page } = contentPage
</script>

<template>
  <NuxtLayout name="default" :content-page="contentPage">
    <ContentRenderer v-if="page" :value="page" />
    <p v-else>Document not found.</p>
  </NuxtLayout>
</template>
