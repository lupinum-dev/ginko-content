<script setup lang="ts">
import type { Component } from 'vue'
import type { MarkdownRoot } from '../../../types/content'
import type { PortableComponentPolicy } from '../../../types/component-policy'
import MarkdownRenderer from './internal/MarkdownRenderer.js'

defineOptions({ inheritAttrs: false })

withDefaults(defineProps<{
  body: MarkdownRoot
  policy: PortableComponentPolicy
  components: Record<string, Component | string>
  fallbackComponents?: Record<string, Component | string>
  tag?: string
  prose?: boolean
  locale?: string
  defaultLocale?: string
  locales?: string[]
  dataContentId?: string
}>(), {
  fallbackComponents: () => ({}),
  tag: 'div',
  prose: undefined,
  locale: undefined,
  defaultLocale: undefined,
  locales: () => [],
  dataContentId: undefined,
})
</script>

<template>
  <MarkdownRenderer
    :tree="body"
    :tag="tag"
    :prose="prose"
    :locale="locale"
    :default-locale="defaultLocale"
    :locales="locales"
    :components="components"
    :fallback-components="fallbackComponents"
    :render-policy="policy"
    :data-content-id="dataContentId"
    v-bind="$attrs"
  />
</template>
