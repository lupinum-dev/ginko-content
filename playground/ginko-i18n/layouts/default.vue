<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useContentSwitchLocalePath, useLocalePath, useSwitchLocalePath } from '#imports'

const { locale } = useI18n()
const switchLocalePath = useSwitchLocalePath()
const switchContentLocalePath = useContentSwitchLocalePath()
const localePath = useLocalePath()

const localeLinks = computed(() => {
  return [
    { code: 'en', name: 'English' },
    { code: 'de', name: 'Deutsch' }
  ].map(entry => ({
    ...entry,
    // Prefer the content's translated path. Fall back to Nuxt i18n's
    // route-only switch for pages that aren't backed by content.
    to: switchContentLocalePath(entry.code) || switchLocalePath(entry.code)
  }))
})

const demoLinks = computed(() => [
  { label: 'Authors', to: localePath('/authors') },
  { label: 'Docs Query', to: localePath('/docs-query') },
  { label: 'Query Locale', to: localePath('/query-locale') },
  { label: 'Nav Debug', to: localePath('/nav') }
])
</script>

<template>
  <div class="shell">
    <header class="shell__header">
      <div>
        <p class="eyebrow">
          Ginko
        </p>
        <h1 class="title">
          Playground
        </h1>
      </div>

      <div class="shell__actions">
        <div class="toolbar">
          <span class="toolbar__label">Locale</span>
          <NuxtLink
            v-for="entry in localeLinks"
            :key="entry.code"
            :to="entry.to"
            class="toolbar__link"
            :class="{ 'toolbar__link--active': locale === entry.code }"
          >
            {{ entry.name }}
          </NuxtLink>
        </div>

        <div class="toolbar">
          <span class="toolbar__label">Demo Pages</span>
          <NuxtLink
            v-for="entry in demoLinks"
            :key="entry.to"
            :to="entry.to"
            class="toolbar__link"
          >
            {{ entry.label }}
          </NuxtLink>
        </div>
      </div>
    </header>

    <div class="shell__body">
      <aside class="shell__sidebar">
        <PageNav />
      </aside>

      <main class="shell__main">
        <div class="page">
          <slot />
        </div>
      </main>
    </div>
  </div>
</template>

<style>
html, body, #__nuxt {
  margin: 0;
  padding: 0;
  min-height: 100vh;
}

html {
  font-family: Georgia, "Times New Roman", serif;
  background: #f6f1e8;
  color: #1e1a16;
}

body {
  background:
    linear-gradient(180deg, rgba(255,255,255,0.72), rgba(255,255,255,0.72)),
    repeating-linear-gradient(
      0deg,
      rgba(120, 95, 70, 0.06) 0,
      rgba(120, 95, 70, 0.06) 1px,
      transparent 1px,
      transparent 30px
    );
}

a {
  color: inherit;
}

code, pre {
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
}

.shell {
  min-height: 100vh;
}

.shell__header {
  display: flex;
  gap: 1rem;
  justify-content: space-between;
  align-items: flex-start;
  padding: 1.5rem 2rem 1rem;
  border-bottom: 1px solid #d7c9b6;
  background: rgba(255, 251, 245, 0.88);
}

.eyebrow {
  margin: 0 0 0.35rem;
  font-size: 0.8rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #7c6856;
}

.title {
  margin: 0;
  font-size: clamp(1.8rem, 3vw, 2.4rem);
  font-weight: 600;
}

.shell__actions {
  display: grid;
  gap: 0.65rem;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  align-items: center;
  justify-content: flex-end;
}

.toolbar__label {
  font-size: 0.82rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #7c6856;
}

.toolbar__link {
  padding: 0.32rem 0.6rem;
  border: 1px solid #d7c9b6;
  border-radius: 999px;
  background: #fffaf2;
  text-decoration: none;
}

.toolbar__link--active {
  background: #2f5f58;
  border-color: #2f5f58;
  color: #fffaf2;
}

.shell__body {
  display: grid;
  grid-template-columns: 18rem minmax(0, 1fr);
  min-height: calc(100vh - 120px);
}

.shell__sidebar {
  border-right: 1px solid #d7c9b6;
  background: rgba(250, 244, 235, 0.92);
}

.shell__main {
  padding: 2rem;
}

.page {
  max-width: 58rem;
}

.page h1,
.page h2,
.page h3 {
  line-height: 1.15;
}

.page p,
.page li {
  line-height: 1.65;
}

.page pre {
  overflow: auto;
  padding: 1rem;
  border: 1px solid #d7c9b6;
  background: #fffdf9;
}

.page :not(pre) > code {
  padding: 0.1rem 0.35rem;
  border: 1px solid #ddcfbc;
  background: #fffaf2;
}

@media (max-width: 900px) {
  .shell__header {
    flex-direction: column;
  }

  .toolbar {
    justify-content: flex-start;
  }

  .shell__body {
    grid-template-columns: 1fr;
  }

  .shell__sidebar {
    border-right: 0;
    border-bottom: 1px solid #d7c9b6;
  }

  .shell__main {
    padding: 1.25rem;
  }
}
</style>
