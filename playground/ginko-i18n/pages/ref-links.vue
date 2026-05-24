<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useFetch } from '#imports'

const { locale } = useI18n()
const { data } = await useFetch('/api/ref-links-debug', {
  query: {
    locale: locale.value
  }
})
</script>

<template>
  <main>
    <section>
      <h1>Ref Link Rendering</h1>
      <ContentRenderer v-if="data?.home" :value="data.home" />
    </section>

    <section>
      <ContentRenderer v-if="data?.gettingStarted" :value="data.gettingStarted" />
    </section>
  </main>
</template>
