import { useNuxtApp, useRoute, useState } from '#imports'

export function getLocaleContext() {
  return {
    route: useRoute(),
    nuxtApp: useNuxtApp(),
    resolvedLocaleState: useState<any>('$si18n:resolved-locale')
  }
}
