<script setup lang="ts">
import { useContentPage } from '#imports'
import { events } from '../../content.config'

const { page } = await useContentPage(events)
</script>

<template>
  <article v-if="page">
    <h1>{{ page.title }}</h1>
    <p data-testid="rendered-at">
      {{ Date.now() }}
    </p>
    <ContentRenderer :value="page" />
  </article>
</template>
