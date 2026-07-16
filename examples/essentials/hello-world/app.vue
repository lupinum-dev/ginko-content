<script setup lang="ts">
import { useAsyncData } from '#imports'
import { navigation } from '@lupinum/ginko-content/client'
import { pages } from './content.config'

const { data: links } = await useAsyncData(
  'hello-world-navigation',
  () => navigation(pages),
  { default: () => [] }
)
</script>

<template>
  <main>
    <nav aria-label="Content">
      <NuxtLink v-for="item in links" :key="item.path" :to="item.path">
        {{ item.title }}
      </NuxtLink>
    </nav>
    <NuxtPage class="prose text-left" />
  </main>
</template>
