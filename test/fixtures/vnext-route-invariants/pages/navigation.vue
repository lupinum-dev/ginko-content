<script setup lang="ts">
import { useAsyncData } from '#imports'
import { navigation } from '@lupinum/ginko-content/client'
import { docs } from '../content.config'

// VNEXT 20.1/24: proves navigation is its own, exact per-surface consumer
// filter — `navigation: false` removes a page from THIS surface only (it
// still renders its own generated route, checked elsewhere in this suite),
// and `sitemap: false` must NOT also remove it from navigation (that flag is
// sitemap-only). Rendered as a static route so the assertion runs against
// real generated output, not a mocked query.
const { data: enNavigation } = await useAsyncData(
  'navigation:en',
  () => navigation(docs, { locale: 'en' }),
  { default: () => [] }
)

const flattenPaths = (nodes: readonly any[]): string[] =>
  nodes.flatMap(node => [node.path, ...(node.children ? flattenPaths(node.children) : [])].filter(Boolean))
</script>

<template>
  <pre data-testid="navigation">{{ JSON.stringify(flattenPaths(enNavigation), null, 2) }}</pre>
</template>
