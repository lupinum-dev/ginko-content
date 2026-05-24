<script setup>
const { page } = await useContentPage('pages')
</script>

<template>
  <main class="prose text-left">
    <ContentRenderer v-if="page" :value="page" />
  </main>
</template>
