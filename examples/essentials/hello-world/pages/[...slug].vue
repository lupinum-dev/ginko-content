<script setup lang="ts">
const { page } = await useContentPage('pages')
</script>

<template>
  <main class="prose">
    <ContentRenderer v-if="page" :value="page" />
  </main>
</template>
