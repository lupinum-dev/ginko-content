<script setup lang="ts">
import { useContentMany } from '#imports'
import { useI18n } from 'vue-i18n'
import { authors } from '../content.config'

const { locale } = useI18n()
const { data: items } = await useContentMany(authors, {
  locale: () => locale.value,
  sort: { name: 'asc' }
})
</script>

<template>
  <main>
    <h1>Authors</h1>
    <ul>
      <li v-for="author in items" :key="(author as { _id?: string })._id">
        {{ (author as any).name }} - {{ (author as any).role }} - {{ (author as any).profile?.focus }} - {{ (author as any).profile?.localeLabel }}
      </li>
    </ul>
  </main>
</template>
