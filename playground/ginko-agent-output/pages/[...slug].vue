<script setup lang="ts">
import { useContentOne, useRoute } from '#imports'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { docs, services } from '../content.config'

const route = useRoute()
const { locale } = useI18n()
const handles = [docs, services]
const results = await Promise.all(handles.map(handle => useContentOne(handle, {
  locale: () => locale.value,
  by: { route: () => route.path },
  fallback: true
})))
const page = computed(() => results.find(result => result.data.value)?.data.value)
</script>

<template>
  <ContentRenderer v-if="page" :value="page" />
  <p v-else>Document not found.</p>
</template>
