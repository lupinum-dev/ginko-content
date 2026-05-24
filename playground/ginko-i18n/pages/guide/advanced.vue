<script setup lang="ts">
import { computed } from 'vue'
import { useContentNeighbors, useContentOne } from '#imports'
import { useI18n } from 'vue-i18n'
import { docs } from '../../content.config'

const { locale } = useI18n()
const { data } = await useContentOne(docs, {
  locale: () => locale.value,
  by: { path: '/guide/advanced' },
  fallback: true
})

const { data: surround } = await useContentNeighbors(docs, {
  locale: () => locale.value,
  by: { ref: () => (data.value as { ref?: string } | null)?.ref || '' }
})

const asTitle = (item: unknown) => (item && typeof item === 'object' && 'title' in item ? (item as { title?: unknown }).title || null : null)

const page = computed(() => data.value
  ? {
      title: (data.value as any).title,
      requestedPath: (data.value as any)._requestedPath,
      requestedLocale: locale.value,
      resolvedLocale: (data.value as any)._resolvedLocale,
      fallback: locale.value !== ((data.value as any)._resolvedLocale || (data.value as any)._locale),
      availableLocales: (data.value as any)._availableLocales,
      defaultSurround: [asTitle(surround.value?.prev), asTitle(surround.value?.next)],
      crossLocaleSurround: [asTitle(surround.value?.prev), asTitle(surround.value?.next)]
    }
  : null)
</script>

<template>
  <pre>{{ JSON.stringify(page, null, 2) }}</pre>
</template>
