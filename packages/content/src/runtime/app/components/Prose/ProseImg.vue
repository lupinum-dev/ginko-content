<script setup lang="ts">
import { computed, getCurrentInstance, useAttrs } from 'vue'
import { useRuntimeConfig } from '#imports'

defineOptions({
  inheritAttrs: false
})

defineProps({
  src: {
    type: String,
    required: true
  },
  alt: {
    type: String,
    default: ''
  },
  title: {
    type: String,
    default: undefined
  },
  width: {
    type: [String, Number],
    default: undefined
  },
  height: {
    type: [String, Number],
    default: undefined
  },
  loading: {
    type: String,
    default: 'lazy'
  }
})

const attrs = useAttrs()
const runtimeContent = useRuntimeConfig().public.content || {}
const registry = getCurrentInstance()?.appContext?.components || {}

const imageMode = computed(() => runtimeContent.markdown?.image || 'auto')
const component = computed(() => {
  if (imageMode.value === 'img') {
    return 'img'
  }

  if (imageMode.value === 'nuxt-image') {
    return 'NuxtImg'
  }

  return registry.NuxtImg ? 'NuxtImg' : 'img'
})
</script>

<template>
  <component
    :is="component"
    :src="src"
    :alt="alt"
    :title="title"
    :width="width"
    :height="height"
    :loading="loading"
    v-bind="attrs"
  />
</template>
