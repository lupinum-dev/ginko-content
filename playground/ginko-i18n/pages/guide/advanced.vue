<script setup lang="ts">
import { computed } from 'vue'
import { useAsyncData } from '#imports'
import { one, surround } from '@lupinum/ginko-content/client'
import { useI18n } from 'vue-i18n'
import { docs } from '../../content.config'

const { locale } = useI18n()
const { data } = await useAsyncData(
  () => `guide-advanced:one:${locale.value}`,
  () => one(docs, {
    locale: locale.value,
    by: { path: '/advanced' },
    fallback: true
  }),
  { watch: [locale] }
)

const { data: surroundEntries } = await useAsyncData(
  () => `guide-advanced:surround:${locale.value}`,
  () => surround(docs, {
    locale: locale.value,
    by: { path: '/advanced' }
  }),
  { watch: [locale], default: () => ({ previous: null, next: null }) }
)

const asTitle = (item: unknown) => (item && typeof item === 'object' && 'title' in item ? (item as { title?: unknown }).title || null : null)

const page = computed(() => data.value
  ? {
      title: (data.value as any).title,
      requestedPath: (data.value as any).route?.requestedPath,
      requestedLocale: locale.value,
      resolvedLocale: (data.value as any).resolution?.resolved?.locale,
      fallback: (data.value as any).resolution?.usedFallback,
      alternates: (data.value as any).route?.alternates,
      defaultSurround: [asTitle(surroundEntries.value?.previous), asTitle(surroundEntries.value?.next)],
      crossLocaleSurround: [asTitle(surroundEntries.value?.previous), asTitle(surroundEntries.value?.next)]
    }
  : null)
</script>

<template>
  <ContentRenderer v-if="data" :value="data" />
  <pre>{{ JSON.stringify(page, null, 2) }}</pre>
</template>
