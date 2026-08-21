<script setup lang="ts">
import { findFirstNavigationPage, navigation } from '@lupinum/ginko-content/client'
import { useAsyncData } from '#imports'
import { docs } from './content.config'

const { data: tree } = await useAsyncData(
  'sidebar-tree',
  () => navigation(docs),
  { default: () => [] }
)

const first = computed(() => findFirstNavigationPage(tree.value))
</script>

<template>
  <div class="layout">
    <aside aria-label="Documentation">
      <NuxtLink v-if="first?.path" :to="first.path">Overview</NuxtLink>
      <ul>
        <li v-for="section in tree" :key="section.path ?? section.title">
          <strong>{{ section.title }}</strong>
          <ul>
            <li v-for="child in section.children ?? []" :key="child.path">
              <NuxtLink :to="child.path">{{ child.title }}</NuxtLink>
            </li>
          </ul>
        </li>
      </ul>
    </aside>
    <NuxtPage class="prose text-left" />
  </div>
</template>

<style scoped>
.layout { display: flex; gap: 2rem; }
aside { min-width: 14rem; }
ul { list-style: none; padding-left: 0.5rem; }
</style>
