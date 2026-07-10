<script setup lang="ts">
import { useAsyncData } from '#imports'
import { useI18n } from 'vue-i18n'
import { many } from '@lupinum/ginko-content/client'
import { authors } from '../content.config'

const { locale } = useI18n()
const { data: items } = await useAsyncData(
  () => `authors:${locale.value}`,
  () => many(authors, {
    locale: locale.value,
    sort: { name: 'asc' }
  }),
  { watch: [locale] }
)
</script>

<template>
  <main>
    <h1>Authors</h1>
    <ul>
      <li v-for="author in items" :key="(author as { id?: string }).id">
        {{ (author as any).name }} - {{ (author as any).role }} - {{ (author as any).profile?.focus }} - {{ (author as any).profile?.localeLabel }}
      </li>
    </ul>
  </main>
</template>
