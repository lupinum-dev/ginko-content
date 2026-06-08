import { useNuxtApp, useRoute, useState } from '#imports'

export function getLocaleContext() {
  const nuxtApp = useNuxtApp()
  return {
    route: useRoute(),
    i18nLocale: (nuxtApp.$i18n as any)?.locale,
    resolvedLocaleState: useState<any>('$si18n:resolved-locale')
  }
}
