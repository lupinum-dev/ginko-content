<template>
  <div class="content-page">
    <div>
      {{ doc }}
    </div>
  </div>
</template>

<script setup lang="ts">
const docs = await many('docs')
const doc = Array.isArray(docs) ? docs[0] : docs

definePageMeta({
  layout: 'default',
  layoutTransition: false
})
</script>

<style>
.content-page {
  height: calc(100vh - 60px);
  max-height: calc(100vh - 60px);
  padding: 1rem;
  margin: 0;
}
</style>
