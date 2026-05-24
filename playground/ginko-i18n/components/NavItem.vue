<script setup lang="ts">
import { computed } from 'vue'
import type { NavItem } from '@lupinum/ginko-content'

const props = defineProps<{
  navItem: NavItem
}>()

const icon = computed(() => {
  if (props.navItem.icon) {
    const lowerIcon = String(props.navItem.icon).toLowerCase()
    if (lowerIcon.includes('book')) { return '📚' }
    if (lowerIcon.includes('pen')) { return '📝' }
    if (lowerIcon.includes('rocket')) { return '🚀' }
    if (lowerIcon.includes('translate') || lowerIcon.includes('globe')) { return '🌍' }
    if (lowerIcon.includes('user') || lowerIcon.includes('author')) { return '👤' }
    if (lowerIcon.includes('search')) { return '🔎' }
    return '📎'
  }
  if (props.navItem.children && props.navItem.children.length) { return '📁' }
  return '📄'
})

const to = computed(() => props.navItem.path)
</script>

<template>
  <li class="nav-item">
    <NuxtLink v-if="to" :to="to" class="nav-item__link">
      <span class="nav-item__icon">{{ icon }}</span>
      <span class="nav-item__title">{{ navItem.title }}</span>
    </NuxtLink>

    <div v-else class="nav-item__label">
      <span class="nav-item__icon">{{ icon }}</span>
      <span class="nav-item__title">{{ navItem.title }}</span>
    </div>

    <ul v-if="navItem.children?.length" class="nav-item__children">
      <NavItem v-for="item of navItem.children" :key="item.path || item.title" :nav-item="item" />
    </ul>
  </li>
</template>

<style scoped>
.nav-item {
  list-style: none;
}

.nav-item + .nav-item {
  margin-top: 0.2rem;
}

.nav-item__label,
.nav-item__link {
  display: flex;
  gap: 0.55rem;
  align-items: flex-start;
  padding: 0.35rem 0.45rem;
  border-radius: 0.35rem;
  text-decoration: none;
}

.nav-item__label {
  font-weight: 600;
  color: #43372d;
}

.nav-item__link {
  color: #2a221c;
}

.nav-item__link:hover {
  background: rgba(124, 104, 86, 0.08);
}

.router-link-exact-active {
  background: rgba(124, 104, 86, 0.14);
  font-weight: 700;
}

.nav-item__icon {
  display: inline-flex;
  width: 1.2rem;
  justify-content: center;
  flex: 0 0 1.2rem;
}

.nav-item__title {
  line-height: 1.35;
}

.nav-item__children {
  margin: 0.15rem 0 0 0.85rem;
  padding: 0 0 0 0.85rem;
  border-left: 1px solid #d7c9b6;
}
</style>
