<script setup lang="ts">
import type { ContentNavigationItem } from '@lupinum/ginko-content'

const navigation = inject<Ref<ContentNavigationItem[]>>('navigation')

const asideNavigation = computed(() => navigation.value || [])
</script>

<template>
  <UMain>
    <UContainer>
      <UPage>
        <template #left>
          <UPageAside>
            <UContentNavigation :navigation="asideNavigation" highlight />
          </UPageAside>
        </template>
        <slot />
      </UPage>
    </UContainer>
  </UMain>
</template>
