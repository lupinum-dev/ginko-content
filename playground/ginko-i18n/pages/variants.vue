<script setup lang="ts">
import { computed } from 'vue'
import { useAsyncData } from '#imports'
import { one } from '@lupinum/ginko-content/client'
import { docs } from '../content.config'

// `variants()`/`useContentVariants` were deleted —
// alternates now live directly on a resolved document's `route.alternates`.

// Fully-translated doc — both en and de variants exist.
const { data: fullyTranslatedDoc } = await useAsyncData(
  'variants:fully-translated',
  () => one(docs, { locale: 'en', by: { ref: 'guide-getting-started' } })
)
const fullyTranslated = computed(() => fullyTranslatedDoc.value?.route.alternates ?? [])

// Partially-translated doc — only en exists, de falls back.
const { data: partialDoc } = await useAsyncData(
  'variants:partial',
  () => one(docs, { locale: 'en', by: { ref: 'guide-advanced' } })
)
const partial = computed(() => partialDoc.value?.route.alternates ?? [])
</script>

<template>
  <div>
    <h2>route.alternates: fully translated</h2>
    <pre>{{ JSON.stringify(fullyTranslated, null, 2) }}</pre>

    <h2>route.alternates: partial (en only)</h2>
    <pre>{{ JSON.stringify(partial, null, 2) }}</pre>
  </div>
</template>
