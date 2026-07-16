<script setup lang="ts">
defineProps<{ title?: string }>()
</script>

<template>
  <section class="my-6 rounded-lg border bg-muted/35 p-5">
    <h3 v-if="title" class="mb-2 text-base font-semibold">
      {{ title }}
    </h3>
    <div class="text-sm leading-6 text-muted-foreground">
      <slot />
    </div>
  </section>
</template>
