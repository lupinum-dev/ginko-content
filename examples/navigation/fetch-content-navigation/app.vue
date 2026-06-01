<script setup lang="ts">
import { useAsyncData } from '#app'
import { many } from '@lupinum/ginko-content/client'
import { pages } from './content.config'

const { data: navigation } = await useAsyncData('navigation', () => {
  return many(pages, {
    select: ['title']
  }).then(items => items.map(item => ({ title: item.title, path: item.path })))
})
</script>

<template>
  <NuxtExampleLayout example="navigation/fetch-content-navigation" repo="lupinum-dev/ginko-content">
    <main class="text-left">
      <nav>
        <AppNavigation :navigation-tree="navigation" />
      </nav>
    </main>
  </NuxtExampleLayout>
</template>
