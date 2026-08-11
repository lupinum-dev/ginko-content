<script setup lang="ts">
import { hash } from 'ohash'
import { computed, onServerPrefetch, shallowRef, useAttrs, watch } from 'vue'
import type { MarkdownRoot } from '../../../types/content'
import { useState } from '#imports'
import MarkdownRenderer from './internal/MarkdownRenderer.js'
import { useUnwrap } from '../composables/useUnwrap'
import { resolveMarkdownRendererFallbackComponents } from '../../markdown/plugins'
import { toMarkdownRoot } from '../../../core/markdown/tree'
import { normalizeComarkNodes } from '../../../core/markdown/normalize-comark'
import { parseComark } from '../../../core/markdown/parse-comark'

const props = defineProps({
  value: {
    type: String,
    required: true
  },
  tag: {
    type: String,
    default: 'span'
  },
  unwrap: {
    type: [Boolean, String],
    default: 'p'
  },
  prose: {
    type: Boolean,
    default: undefined
  },
  components: {
    type: Object,
    default: () => ({})
  }
})

const attrs = useAttrs()
const { unwrap: unwrapRoot } = useUnwrap()
const stateKey = `content:inline:${hash({
  value: props.value,
  unwrap: props.unwrap
})}`
const initialState = useState<{
  tree: MarkdownRoot | null
}>(stateKey, () => ({
  tree: null
}))
const tree = shallowRef<MarkdownRoot | null>(initialState.value.tree)

const fallbackComponents = resolveMarkdownRendererFallbackComponents()

const resolvedComponents = computed(() => props.components)

const rendererAttrs = computed(() => {
  const { class: className, ...rest } = attrs

  return className == null
    ? rest
    : {
        ...rest,
        class: className as string | unknown[] | Record<string, any>
      }
})

let refreshId = 0
const refresh = async () => {
  const currentRefresh = ++refreshId
  const parsed = await parseComark(props.value || '')
  const body = unwrapRoot({
    ...toMarkdownRoot(normalizeComarkNodes(parsed.nodes as unknown[]))
  }, props.unwrap)

  if (currentRefresh === refreshId) {
    tree.value = body
  }
}

onServerPrefetch(async () => {
  await refresh()
  initialState.value = {
    tree: tree.value
  }
})

if (import.meta.client && !tree.value) {
  void refresh()
}

watch(
  [() => props.value, () => props.unwrap],
  () => {
    void refresh()
  }
)
</script>

<template>
  <MarkdownRenderer
    v-if="tree"
    :tree="tree"
    :tag="tag"
    :prose="prose"
    :components="resolvedComponents"
    :fallback-components="fallbackComponents"
    v-bind="rendererAttrs"
  />
</template>
