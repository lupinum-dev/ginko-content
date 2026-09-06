<template>
  <div class="content-page">
    <div>
      {{ doc }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { definePageMeta } from '#imports'
import { many } from '@lupinum/ginko-content/client'
import { docs } from '../content.config'

const documents = await many(docs)
const doc = Array.isArray(documents) ? documents[0] : documents

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
