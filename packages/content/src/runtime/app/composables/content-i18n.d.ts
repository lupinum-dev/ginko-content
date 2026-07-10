declare module '#build/content-i18n.mjs' {
  export function useLocalePath(): (route: string | { name?: string, hash?: string, params?: Record<string, unknown>, query?: Record<string, unknown> }, locale?: string) => string
}
