<script setup lang="ts">
import { computed, defineAsyncComponent, useAttrs } from 'vue'
import { pascalCase } from 'scule'
import { useRuntimeConfig } from '#imports'
import { useContentPreview } from '../../composables/preview'
import { useUnwrap } from '../../composables/useUnwrap'
import MarkdownRenderer from './MarkdownRenderer.js'
import { useLocalePath } from '../../composables/content-i18n'
import { resolveMarkdownRenderRefs, rewriteMarkdownRefLinks } from '../../../../core/references/resolve'
import { loadContentComponentEntries } from '../../../../integrations/vue/content-components'
import { resolveMarkdownRendererComponents, resolveMarkdownRendererFallbackComponents } from '../../../markdown/plugins'
import { localComponentLoaders, localComponents } from '../../../utils/content-components'
import { isMarkdownRoot } from '../../../../core/markdown/tree'

defineOptions({
  inheritAttrs: false
})

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
// The canonical document envelope carries `locale` at the top
// level (the resolved/served locale) and `resolution.requested.locale` (the
// locale the caller actually asked for, before fallback) — there is no more
// `resolved`/`variants` shape to read these off of.
const locale = computed(() => props.value.locale)
const linkLocale = computed(() => props.value.resolution?.requested?.locale || locale.value)
const defaultLocale = computed(() => runtimeContent.defaultLocale)
const locales = computed(() => {
  const alternateLocales = Array.isArray(props.value.route?.alternates)
    ? props.value.route.alternates
        .map((alternate: { locale?: string }) => alternate.locale)
        .filter((locale: string | undefined): locale is string => Boolean(locale))
    : []

  return Array.from(new Set([
    ...(runtimeContent.locales || []),
    ...alternateLocales
  ]))
})
const renderPolicy = computed(() =>
  runtimeContent.renderPolicies?.[props.value.collection] || { components: {} }
)

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
    props.value.resolvedRefs,
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

const fallbackComponents = resolveMarkdownRendererFallbackComponents()

const resolvedComponents = computed(() => {
  if (!renderedBody.value) {
    return props.components
  }

  return {
    ...Object.fromEntries(loadContentComponentEntries(renderedBody.value as any, runtimeContent.markdown?.tags || {}).map(([tag, component]) => {
      if (typeof component !== 'string') return [tag, component]
      const componentName = pascalCase(component)
      const loader = localComponents.includes(componentName) ? localComponentLoaders[componentName] : undefined
      return [tag, loader ? defineAsyncComponent(loader) : component]
    })),
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
    :fallback-components="fallbackComponents"
    :render-policy="renderPolicy"
    :data-content-id="debug ? value.id : undefined"
    v-bind="rendererAttrs"
  />
</template>
