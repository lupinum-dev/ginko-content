<script setup lang="ts">
import { useAsyncData } from '#imports'
import { useI18n } from 'vue-i18n'
import { many } from '@lupinum/ginko-content/client'
import { docs } from '../content.config'

const { locale } = useI18n()

const { data: implicit } = await useAsyncData(
  () => `query-locale:implicit:${locale.value}`,
  () => many(docs, {
    locale: locale.value,
    where: { navigationFile: { $ne: true }, partial: { $ne: true } },
    sort: { path: 'asc' }
  }),
  { watch: [locale] }
)

const { data: strictGerman } = await useAsyncData(
  'query-locale:strict-german',
  () => many(docs, {
    locale: 'de',
    where: { navigationFile: { $ne: true }, partial: { $ne: true } },
    sort: { path: 'asc' }
  })
)

const { data: fallbackGerman } = await useAsyncData(
  'query-locale:fallback-german',
  () => many(docs, {
    locale: 'de',
    fallback: true,
    where: { navigationFile: { $ne: true }, partial: { $ne: true } },
    sort: { path: 'asc' }
  })
)
</script>

<template>
  <pre>{{ JSON.stringify({
    implicit: (implicit || []).map((doc: any) => doc.title),
    strictGerman: (strictGerman || []).map((doc: any) => doc.title),
    fallbackGerman: (fallbackGerman || []).map((doc: any) => doc.title)
  }, null, 2) }}</pre>
</template>
