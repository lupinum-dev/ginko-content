import { defineNuxtPlugin, useRuntimeConfig } from '#imports'

export default defineNuxtPlugin(async (nuxtApp: any) => {
  const plugins = useRuntimeConfig().public.content?.markdown?.plugins || []
  const names = new Set(plugins.map((plugin: { name: string }) => plugin.name))

  if (names.has('math')) {
    const { Math } = await import(/* @vite-ignore */ ['@comark/vue', 'plugins/math'].join('/'))
    nuxtApp.vueApp.component('Math', Math)
  }

  if (names.has('mermaid')) {
    const { Mermaid } = await import(/* @vite-ignore */ ['@comark/vue', 'plugins/mermaid'].join('/'))
    nuxtApp.vueApp.component('Mermaid', Mermaid)
  }
})
