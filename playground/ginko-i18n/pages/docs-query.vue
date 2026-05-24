<script setup lang="ts">
import { useContentMany } from '#imports'
import { useI18n } from 'vue-i18n'
import { docs } from '../content.config'

const { locale } = useI18n()
const { data: items } = await useContentMany(docs, {
  locale: () => locale.value,
  where: { related: { $exists: true } },
  sort: { title: 'asc' }
})
</script>

<template>
  <pre>{{ JSON.stringify((items || []).map((doc: any) => doc.title), null, 2) }}</pre>
</template>
