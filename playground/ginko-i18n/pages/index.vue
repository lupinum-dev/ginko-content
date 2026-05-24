<script setup lang="ts">
import { useContentOne, useRoute } from '#imports'
import { useI18n } from 'vue-i18n'
import { docs } from '../content.config'

const route = useRoute()
const { locale } = useI18n()
const { data: page } = await useContentOne(docs, {
  locale: () => locale.value,
  by: { route: () => route.path },
  fallback: true
})
</script>

<template>
  <ContentRenderer v-if="page" :value="page" />
</template>
