// No trailing `export {}` here on purpose: TypeScript only registers the
// `declare module` block below as a global ambient module declaration when
// this file is compiled as a "script" (no top-level import/export of its
// own) rather than as a module — adding one silently breaks resolution of
// `#build/content-i18n.mjs` for every plain `tsc` consumer (reproduced in
// isolation; pre-existing gap, fixed in passing here since it blocks
// `pnpm typecheck` for every phase, not just this one).
declare module '#build/content-i18n.mjs' {
  export function useLocalePath(): (route: string | { name?: string, hash?: string, params?: Record<string, unknown>, query?: Record<string, unknown> }, locale?: string) => string
}
