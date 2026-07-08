<script setup lang="ts">
import { computed, useAttrs } from 'vue'
import { useRuntimeConfig } from '#imports'
import { useContentPreview } from '../../composables/preview'
import { useUnwrap } from '../../composables/useUnwrap'
import MarkdownRenderer from './MarkdownRenderer.js'
import { useLocalePath } from '../../composables/content-i18n'
import { resolveMarkdownRenderRefs, rewriteMarkdownRefLinks } from '../../../../core/references/resolve'
import { loadContentComponentEntries } from '../../../../integrations/vue/content-components'
import { resolveMarkdownRendererComponents } from '../../../markdown/plugins'
import { isMarkdownRoot } from '../../../../core/markdown/tree'

const props = defineProps({
  value: {
    type: Object,
    required: true
  },
  excerpt: {
    type: Boolean,
    default: false
  },
  tag: {
    type: String,
    default: 'div'
  },
  prose: {
    type: Boolean,
    default: undefined
  },
  unwrap: {
    type: [Boolean, String],
    default: false
  },
  components: {
    type: Object,
    default: () => ({})
  },
  data: {
    type: Object,
    default: () => ({})
  }
})

const debug = import.meta.dev || useContentPreview().isEnabled()
const runtimeContent = useRuntimeConfig().public?.content || {}
const attrs = useAttrs()
const { unwrap: unwrapRoot } = useUnwrap()
const localePath = useLocalePath()
const locale = computed(() => props.value.locale || props.value._resolvedLocale || props.value._locale)
const linkLocale = computed(() => props.value._requestedLocale || locale.value)
const defaultLocale = computed(() => props.value.defaultLocale || runtimeContent.defaultLocale)
const locales = computed(() => {
  const variantLocales = Array.isArray(props.value.variants)
    ? props.value.variants
        .map((variant: { locale?: string }) => variant.locale)
        .filter((locale: string | undefined): locale is string => Boolean(locale))
    : []

  return Array.from(new Set([
    ...(runtimeContent.locales || []),
    ...variantLocales
  ]))
})

const body = computed(() => {
  let body = props.value.body || props.value
  if (props.excerpt && props.value.excerpt) {
    body = props.value.excerpt
  }

  if (!isMarkdownRoot(body)) {
    return null
  }

  const resolvedRefs = resolveMarkdownRenderRefs(
    body,
    props.value._resolvedRefs,
    runtimeContent.links,
    route => localePath(route, linkLocale.value)
  )

  return Object.keys(resolvedRefs).length
    ? rewriteMarkdownRefLinks(body, resolvedRefs)
    : body
})

const renderedBody = computed(() => {
  if (!body.value) {
    return null
  }

  return props.unwrap
    ? unwrapRoot(body.value, props.unwrap)
    : body.value
})

const resolvedComponents = computed(() => {
  if (!renderedBody.value) {
    return props.components
  }

  return {
    ...Object.fromEntries(loadContentComponentEntries(renderedBody.value as any, runtimeContent.markdown?.tags || {})),
    ...resolveMarkdownRendererComponents(runtimeContent.markdown?.plugins || []),
    ...props.components
  }
})

const rendererAttrs = computed(() => {
  const { class: className, ...rest } = attrs

  return className == null
    ? rest
    : {
        ...rest,
        class: className as string | unknown[] | Record<string, any>
      }
})
</script>

<template>
  <MarkdownRenderer
    v-if="renderedBody"
    :tree="renderedBody"
    :tag="tag"
    :prose="prose"
    :locale="locale"
    :default-locale="defaultLocale"
    :locales="locales"
    :components="resolvedComponents"
    :data-content-id="debug ? value.id : undefined"
    v-bind="rendererAttrs"
  />
</template>
