<script setup lang="ts">
import { useHead } from '#imports'
import { useLocaleHead } from '#i18n'

const localeHead = useLocaleHead({
  addSeoAttributes: true
})

useHead(() => localeHead.value)
</script>

<template>
  <NuxtPage />
</template>
