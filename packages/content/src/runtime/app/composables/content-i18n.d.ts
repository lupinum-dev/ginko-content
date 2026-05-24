declare module '#build/content-i18n.mjs' {
  export function useRouteBaseName(): (route: { name?: unknown } | unknown) => string | undefined
  export function useSetI18nParams(): (params: Record<string, unknown>) => void
  export function useSwitchLocalePath(): (locale: string) => string
}
