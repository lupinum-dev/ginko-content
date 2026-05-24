<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useContentMany } from '#imports'
import { docs } from '../content.config'

const { locale } = useI18n()

const { data: implicit } = await useContentMany(docs, {
  locale: () => locale.value,
  where: { _navigation: { $ne: true }, _partial: { $ne: true } },
  sort: { _path: 'asc' }
})

const { data: strictGerman } = await useContentMany(docs, {
  locale: 'de',
  where: { _navigation: { $ne: true }, _partial: { $ne: true } },
  sort: { _path: 'asc' }
})

const { data: fallbackGerman } = await useContentMany(docs, {
  locale: 'de',
  fallback: true,
  where: { _navigation: { $ne: true }, _partial: { $ne: true } },
  sort: { _path: 'asc' }
})
</script>

<template>
  <pre>{{ JSON.stringify({
    implicit: (implicit || []).map((doc: any) => doc.title),
    strictGerman: (strictGerman || []).map((doc: any) => doc.title),
    fallbackGerman: (fallbackGerman || []).map((doc: any) => doc.title)
  }, null, 2) }}</pre>
</template>
