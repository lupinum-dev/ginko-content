/**
 * Preview-mode composable. The `useCookie` / `useRoute` calls below are
 * resolved through `globalThis` rather than statically imported from
 * `#imports` — that keeps this file safe to traverse from a pure-Nitro
 * bundle (where the Nuxt-only auto-imports aren't registered).
 */
const lookupGlobal = <T>(name: string): T | undefined => {
  const fn = (globalThis as Record<string, unknown>)[name]
  return typeof fn === 'function' ? (fn as T) : undefined
}

interface CookieRef<T> { value: T | null }
const cookie = <T>(name: string): CookieRef<T> => {
  const useCookie = lookupGlobal<<U>(name: string) => CookieRef<U>>('useCookie')
  return useCookie ? useCookie<T>(name) : { value: null }
}

const route = (): { query: Record<string, unknown> } => {
  const useRoute = lookupGlobal<() => { query: Record<string, unknown> }>('useRoute')
  return useRoute ? useRoute() : { query: {} }
}

let showWarning = true

export const useContentPreview = () => {
  const getPreviewToken = () => {
    return cookie<string>('previewToken').value ||
      (import.meta.client && sessionStorage.getItem('previewToken')) ||
      undefined
  }

  const setPreviewToken = (token: string | undefined) => {
    cookie<string>('previewToken').value = (token as string | null) ?? null

    route().query.preview = token || ''

    if (import.meta.client) {
      if (token) {
        sessionStorage.setItem('previewToken', token)
      } else {
        sessionStorage.removeItem('previewToken')
      }

      window.location.reload()
    }
  }

  const isEnabled = () => {
    const query = route().query
    if (Object.prototype.hasOwnProperty.call(query, 'preview') && !query.preview) {
      return false
    }

    if (query.preview || cookie<string>('previewToken').value) {
      if (import.meta.dev && showWarning) {
        console.warn('[content] Preview mode enabled since a preview token is set (either in query or cookie).')
        showWarning = false
      }
      return true
    }

    if (import.meta.client && sessionStorage.getItem('previewToken')) {
      return true
    }

    return false
  }

  return {
    isEnabled,
    getPreviewToken,
    setPreviewToken
  }
}
