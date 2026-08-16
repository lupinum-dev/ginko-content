<script setup lang="ts">
import { computed } from 'vue'
import { useContentPage } from '#imports'
import { docs } from '../content.config'

// This app's 404 policy: `useContentPage()` never throws
// a default 404 on its own, so an unmatched route (including `/internal/secret`
// and its Nuxt-I18n-generated `/de/internal/secret` counterpart — see
// nuxt.config.ts's `sitemap.exclude` comment) simply renders this fallback
// text at the default 200 status, exactly as it must stay in the
// prerendered/static build. The shared layout's route-only locale switcher
// still gives every one of these routes a real link.
definePageMeta({ key: route => route.path })

const { page } = await useContentPage(docs, { fallback: true })

// This content-aware locale switcher complements the layout's always-present
// route-only switcher: once a real
// document resolves, this renders the precise canonical path per locale
// (and labels genuine fallback locales), instead of a naive URL-prefix swap.
const localeNames: Record<string, string> = { en: 'English', de: 'Deutsch' }
const localeSwitchLinks = computed(() => (page.value?.route.alternates ?? []).map(alternate => ({
  ...alternate,
  name: localeNames[alternate.locale] || alternate.locale
})))
</script>

<template>
  <div v-if="page">
    <div v-if="localeSwitchLinks.length" class="toolbar">
      <span class="toolbar__label">Locale (content)</span>
      <NuxtLink
        v-for="alternate in localeSwitchLinks"
        :key="alternate.locale"
        :to="alternate.path"
        :prefetch="false"
        class="toolbar__link"
        :title="alternate.source === 'fallback'
          ? `Content falls back to ${alternate.resolvedLocale}`
          : undefined"
      >
        {{ alternate.name }}
      </NuxtLink>
    </div>
    <ContentRenderer :value="page" />
  </div>
  <p v-else>Document not found.</p>
</template>
