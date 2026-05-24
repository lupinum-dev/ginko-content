<script setup lang="ts">
import PageSectionCTAComponent from '../PageSectionCTA.vue'

defineOptions({
  inheritAttrs: false
})
</script>

<template>
  <PageSectionCTAComponent v-bind="$attrs">
    <slot />
  </PageSectionCTAComponent>
</template>
