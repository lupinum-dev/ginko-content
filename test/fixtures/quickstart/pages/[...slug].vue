<script setup lang="ts">
const { page } = await useContentPage('pages')
</script>

<template>
  <ContentRenderer v-if="page" :value="page" />
</template>
