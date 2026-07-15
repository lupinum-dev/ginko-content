<script setup lang="ts">
import { useAsyncData } from '#imports'
import { useI18n } from 'vue-i18n'
import { many } from '@lupinum/ginko-content/client'
import { docs } from '../content.config'

const { locale } = useI18n()

const { data: implicit } = await useAsyncData(
  () => `docs-query:implicit:${locale.value}`,
  () => many(docs, {
    locale: locale.value,
    where: { related: { $exists: true } },
    sort: { title: 'asc' }
  }),
  { watch: [locale] }
)
</script>

<template>
  <pre>{{ JSON.stringify((implicit || []).map((doc: any) => doc.title), null, 2) }}</pre>
</template>
