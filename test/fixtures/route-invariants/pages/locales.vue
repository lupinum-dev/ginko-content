<script setup lang="ts">
import { one, many } from '@lupinum/ginko-content/client'
import { docs, notes } from '../content.config'

// Content-only localization (no @nuxtjs/i18n): localized one/many
// queries and fallback resolution, proven from a real generated static route.
const enGettingStarted = await one(docs, { by: { path: '/guide/getting-started', locale: 'en' } })
const deGettingStarted = await one(docs, { by: { path: '/leitfaden/erste-schritte', locale: 'de' } })

// This page has no `de` translation: requesting it in `de` must resolve
// through the `de -> en` fallback rather than 404.
const deFallback = await one(docs, {
  by: { path: '/guide/advanced-en-only', locale: 'de' },
  fallback: true
})

const allDocs = await many(docs, {
  where: { partial: { $ne: true }, navigationFile: { $ne: true }, draft: { $ne: true } }
})

const enNote = await one(notes, { by: { path: '/notes/example', locale: 'en' } })
const deNote = await one(notes, { by: { path: '/notes/example', locale: 'de' } })
</script>

<template>
  <pre data-testid="locales">{{ JSON.stringify({
    enTitle: enGettingStarted?.title,
    enLocale: enGettingStarted?.locale,
    deTitle: deGettingStarted?.title,
    deLocale: deGettingStarted?.locale,
    fallbackTitle: deFallback?.title,
    fallbackLocale: deFallback?.locale,
    fallbackResolvedLocale: (deFallback as any)?.resolvedLocale,
    docCount: allDocs.length,
    enNoteTitle: enNote?.title,
    deNoteTitle: deNote?.title
  }, null, 2) }}</pre>
</template>
