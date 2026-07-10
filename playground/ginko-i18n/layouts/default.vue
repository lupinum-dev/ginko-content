<script setup lang="ts">
import { computed } from 'vue'
import { useI18n, useLocalePath, useSwitchLocalePath } from '#imports'

const localePath = useLocalePath()

// The shell layout renders around every page, including ones with no
// content behind them, so it can only offer a route-only locale switch
// (Nuxt I18n's own `useSwitchLocalePath()` — a plain URL-prefix swap, no
// content query). Content-aware switching over `page.route.alternates`
// (VNEXT.md 10.4, 27.4), which needs the resolved document, lives on the
// route page itself (`pages/[...slug].vue`) instead: a parent layout
// unavoidably renders before a child page's async setup publishes anything
// during SSR, so a layout-owned cross-component registry (the old
// `useContentRoute`/`useContentSwitchLocalePath` mechanism, VNEXT.md 10.6
// hard-cut) could only ever show stale/guessed links here. Both switchers
// coexist: this one guarantees every page (including ones that bypass
// `[...slug].vue`, like the debug pages under `pages/guide/`) always has a
// locale link; the page-level one additionally offers the precise
// canonical/fallback-labeled link once real document data is available.
// Distinct short labels ("EN"/"DE"), not the page-level switcher's full
// "English"/"Deutsch" names: browser tests target the content-aware link by
// its accessible name, and Playwright's default name matching is a substring
// match, so a name here that merely appended text (e.g. "English (route)")
// would still collide with it.
const { locales } = useI18n()
const switchLocalePath = useSwitchLocalePath()
const localeCodes: Record<string, string> = { en: 'EN', de: 'DE' }
const routeLocaleLinks = computed(() => locales.value.map((entry) => {
  const code = typeof entry === 'string' ? entry : entry.code
  return { code, name: localeCodes[code] || code.toUpperCase(), to: switchLocalePath(code) }
}))

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
          <span class="toolbar__label">Locale (route)</span>
          <NuxtLink
            v-for="entry in routeLocaleLinks"
            :key="entry.code"
            :to="entry.to"
            class="toolbar__link"
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
