<script setup lang="ts">
import { hash } from 'ohash'
import { computed, onServerPrefetch, shallowRef, useAttrs, watch } from 'vue'
import type { MarkdownRoot } from '../../../types/content'
import { useRuntimeConfig, useState } from '#imports'
import MarkdownRenderer from './internal/MarkdownRenderer.js'
import { useUnwrap } from '../composables/useUnwrap'
import { resolveMarkdownPlugins, resolveMarkdownRendererComponents, resolveMarkdownRendererFallbackComponents } from '../../markdown/plugins'
import { toMarkdownRoot } from '../../../core/markdown/tree'
import { parseComark } from '../../../core/markdown/parse-comark'
import { loadContentComponentEntries } from '../../../integrations/vue/content-components'

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

const runtimeContent = useRuntimeConfig().public.content
const attrs = useAttrs()
const { unwrap: unwrapRoot } = useUnwrap()
const stateKey = `content:inline:${hash({
  value: props.value,
  unwrap: props.unwrap,
  prose: props.prose,
  plugins: runtimeContent.markdown?.plugins || [],
  tags: runtimeContent.markdown?.tags || {}
})}`
const initialState = useState<{
  tree: MarkdownRoot | null
}>(stateKey, () => ({
  tree: null
}))
const tree = shallowRef<MarkdownRoot | null>(initialState.value.tree)

const resolvedComponents = computed(() => ({
  ...Object.fromEntries(loadContentComponentEntries({
    type: 'root',
    children: tree.value?.children || []
  } as any, runtimeContent.markdown?.tags || {})),
  ...resolveMarkdownRendererComponents(runtimeContent.markdown.plugins),
  ...props.components
}))

const rendererAttrs = computed(() => {
  const { class: className, ...rest } = attrs

  return className == null
    ? rest
    : {
        ...rest,
        class: className as string | unknown[] | Record<string, any>
      }
})

const refresh = async () => {
  const plugins = await resolveMarkdownPlugins(runtimeContent.markdown.plugins)
  const parsed = await parseComark(props.value || '', plugins)
  const body = unwrapRoot({
    ...toMarkdownRoot(parsed.nodes as any[])
  }, props.unwrap)

  tree.value = body
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
  [() => props.value, () => props.unwrap, () => props.components, () => runtimeContent.markdown?.plugins, () => runtimeContent.markdown?.tags],
  () => {
    void refresh()
  },
  { deep: true }
)
</script>

<template>
  <MarkdownRenderer
    v-if="tree"
    :tree="tree"
    :tag="tag"
    :prose="prose"
    :components="resolvedComponents"
    :fallback-components="resolveMarkdownRendererFallbackComponents()"
    v-bind="rendererAttrs"
  />
</template>
