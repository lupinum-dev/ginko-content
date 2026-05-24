<script setup lang="ts">
const page = await one('pages', {
  by: { path: '/' }
})
</script>

<template>
  <NuxtExampleLayout example="mdc/slots" repo="lupinum-dev/ginko-content">
    <ContentRenderer v-if="page" :value="page" class="prose text-left" />
  </NuxtExampleLayout>
</template>
