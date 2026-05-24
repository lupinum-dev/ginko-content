<script setup lang="ts">
import { useContentTree } from '#imports'
import { useI18n } from 'vue-i18n'
import { docs } from '../content.config'

const { locale } = useI18n()

// Navigation tree for the active locale. Falls back gracefully — docs that
// only exist in the default locale still appear in the tree (vs. exact-only
// locale matching, which would silently truncate the sidebar).
const { data: nav } = await useContentTree(docs, {
  locale: () => locale.value
})

// Pull the doc titles + paths out of the tree for snapshot stability.
const flat = nav.value.flatMap(function flatten (node: any): Array<{ title: string, path: string }> {
  const here = node.path ? [{ title: node.title || '', path: node.path }] : []
  const children = Array.isArray(node.children) ? node.children.flatMap(flatten) : []
  return [...here, ...children]
})
</script>

<template>
  <pre>{{ JSON.stringify({ locale, flat }, null, 2) }}</pre>
</template>
