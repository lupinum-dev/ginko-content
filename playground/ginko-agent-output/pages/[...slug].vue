<script setup lang="ts">
import { useAsyncData, useRoute } from '#imports'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { one } from '@lupinum/ginko-content/client'
import { docs, services } from '../content.config'

const route = useRoute()
const { locale } = useI18n()
const handles = [docs, services]
const results = await Promise.all(handles.map(handle => useAsyncData(
  `agent-output-page:${handle.name}`,
  () => one(handle, {
    locale: locale.value,
    by: { route: route.path },
    fallback: true
  }),
  { watch: [locale, () => route.path] }
)))
const page = computed(() => results.find(result => result.data.value)?.data.value)
</script>

<template>
  <ContentRenderer v-if="page" :value="page" />
  <p v-else>Document not found.</p>
</template>
