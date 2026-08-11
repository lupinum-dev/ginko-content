<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAsyncData, useRuntimeConfig } from '#imports'

const runtime = useRuntimeConfig().public.content
let locale = computed(() => runtime.defaultLocale || '')
try {
  locale = useI18n().locale
} catch {
  locale = computed(() => runtime.defaultLocale || '')
}

const { data: navigation } = await useAsyncData(
  () => `page-nav:${locale.value}`,
  () => $fetch('/api/_content/navigation', {
    query: {
      collection: 'docs',
      locale: locale.value
    }
  })
)
</script>

<template>
  <nav class="nav" aria-label="Content navigation">
    <div class="nav__heading">
      Navigation
    </div>
    <ul class="nav__list">
      <NavItem v-for="item of (navigation || [])" :key="item.path || item.title" :nav-item="item" />
    </ul>
  </nav>
</template>

<style scoped>
.nav {
  padding: 1rem 1rem 1.5rem;
}

.nav__heading {
  margin-bottom: 0.85rem;
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #7c6856;
}

.nav__list {
  margin: 0;
  padding: 0;
}
</style>
