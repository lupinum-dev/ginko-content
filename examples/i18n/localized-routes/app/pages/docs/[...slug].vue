<script setup lang="ts">
import { createError, useContentPage } from '#imports'
import { docs } from '~~/content.config'

definePageMeta({ key: route => route.path })

const { page } = await useContentPage(docs, { fallback: true })

if (!page.value) {
  throw createError({ statusCode: 404, statusMessage: 'Document not found', fatal: true })
}
</script>

<template>
  <article v-if="page">
    <nav aria-label="Languages">
      <NuxtLink
        v-for="alternate in page.route.alternates"
        :key="alternate.locale"
        :to="alternate.path"
      >
        {{ alternate.locale }}
      </NuxtLink>
    </nav>

    <p v-if="page.resolution.usedFallback">
      This page is not available in the requested language.
    </p>

    <ContentRenderer :value="page" />
  </article>
</template>
