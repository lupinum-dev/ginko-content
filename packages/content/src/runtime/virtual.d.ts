declare module '#build/content-i18n.mjs' {
  export function useLocalePath(): (route: string | { name?: string, hash?: string, params?: Record<string, unknown>, query?: Record<string, unknown> }, locale?: string) => string
  export function useRouteBaseName(): (route: { name?: unknown } | unknown) => string | undefined
  export function useSetI18nParams(): (params: Record<string, unknown>) => void
  export function useSwitchLocalePath(): (locale: string) => string
}

export {}
