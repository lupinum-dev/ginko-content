<script setup>
const data = await one('pages', {
  by: { path: '/' },
  select: ['title']
})
</script>

<template>
  <NuxtExampleLayout example="queries/only" repo="lupinum-dev/ginko-content">
    <h1>{{ data?.title }}</h1>
  </NuxtExampleLayout>
</template>
