<script setup lang="ts">
import { many } from '@lupinum/ginko-content/client'
import { docs } from '../content.config'

// Proves the `content:file:beforeParse` hook's effect on the
// `order` route/navigation fact is visible through a real query, ordered
// identically to how it affects route listing -- generated as a static route
// itself, so this page's rendered output IS the "generated route" half of
// the invariant.
const enDocs = await many(docs, {
  where: {
    locale: { $eq: 'en' },
    partial: { $ne: true },
    navigationFile: { $ne: true },
    draft: { $ne: true }
  },
  sort: { order: 'asc' }
})
</script>

<template>
  <pre data-testid="nav-order">{{ JSON.stringify(enDocs.map(doc => ({ title: doc.title, order: doc.order, path: doc.route.resolvedPath })), null, 2) }}</pre>
  <!-- Proves the real `content.transformers` wiring's
       computed `wordCount` fact is visible through a direct query,
       identically to how it affects the transformed page's own generated
       route (asserted against `[...slug].vue`'s `word-count` testid). -->
  <pre data-testid="nav-word-count">{{ JSON.stringify(enDocs.map(doc => ({ path: doc.route.resolvedPath, wordCount: (doc as unknown as { wordCount?: number }).wordCount })), null, 2) }}</pre>
  <!-- The cross-artifact golden's fact source: query,
       navigation, and sitemap consumers share this same document/route
       identity and apply only their own per-surface opt-out filter on top of
       it (test/e2e/generate-output.test.ts asserts the intersection/
       divergence across routes, this query, /navigation, and the search
       index). -->
  <pre data-testid="nav-surface-flags">{{ JSON.stringify(enDocs.map(doc => ({
    path: doc.route.resolvedPath,
    navigation: (doc as unknown as { navigation?: boolean }).navigation !== false,
    sitemap: (doc as unknown as { sitemap?: boolean }).sitemap !== false
  })), null, 2) }}</pre>
</template>
