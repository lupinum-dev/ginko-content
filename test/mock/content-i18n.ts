export const useLocalePath = () => (value: string | { name?: string, hash?: string, params?: Record<string, unknown>, query?: Record<string, unknown> }, locale?: string) => {
  const route = typeof value === 'string' ? value : value.name || ''
  const path = route.startsWith('/') ? route : `/${route}`
  const localized = locale && locale !== 'en' ? `/${locale}${path}` : path
  const query = typeof value === 'object' && value.query
    ? `?${new URLSearchParams(Object.entries(value.query).filter(([, item]) => item !== undefined).map(([key, item]) => [key, String(item)] as const)).toString()}`
    : ''
  return `${localized}${query}${typeof value === 'object' && value.hash ? value.hash : ''}`
}

export const useRouteBaseName = () => (value: { name?: unknown } | unknown) => {
  if (value && typeof value === 'object' && 'name' in value) {
    return typeof value.name === 'string' ? value.name.replace(/___([^_]+)$/, '') : undefined
  }

  return undefined
}

export const useSetI18nParams = () => () => {}

export const useSwitchLocalePath = () => () => ''
