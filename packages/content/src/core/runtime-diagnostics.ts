import type { ContentVisibilityEnvironment } from './visibility'

export interface RuntimeDiagnostic {
  key: string
  message: string
}

const emittedRuntimeDiagnostics = new Set<string>()

export const shouldEmitRuntimeDiagnostics = (
  environment: ContentVisibilityEnvironment,
  prerender: boolean
): boolean => environment === 'development' || prerender

export const emitRuntimeDiagnostics = (
  diagnostics: readonly RuntimeDiagnostic[],
  warn: (message: string) => void = console.warn
): void => {
  for (const diagnostic of diagnostics) {
    if (emittedRuntimeDiagnostics.has(diagnostic.key)) continue
    emittedRuntimeDiagnostics.add(diagnostic.key)
    warn(`[ginko-content] ${diagnostic.message}`)
  }
}
