import { getLocaleContext } from './locale-context'
import { normalizeContentPath, resolveRouteContent as resolveLocalizedRouteContent } from '../../../features/localization/path'

export { normalizeContentPath }

export const resolveActiveLocale = (locales: string[], defaultLocale?: string) => {
  const { route, nuxtApp, resolvedLocaleState } = getLocaleContext()
  const i18nLocale = (nuxtApp.$i18n as any)?.locale
  const explicitLocale = typeof i18nLocale === 'string'
    ? i18nLocale
    : i18nLocale?.value || resolvedLocaleState.value

  if (explicitLocale && locales.includes(explicitLocale)) {
    return explicitLocale
  }

  const segments = route.path.split('/').filter(Boolean)
  const routeLocale = segments[0] && locales.includes(segments[0]) ? segments[0] : undefined
  return routeLocale || defaultLocale
}

export const resolveRouteContent = (path: string, locales: string[], defaultLocale?: string) =>
  resolveLocalizedRouteContent(path, locales, defaultLocale, resolveActiveLocale(locales, defaultLocale))
