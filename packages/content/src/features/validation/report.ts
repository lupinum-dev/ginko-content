export const CONTENT_VALIDATION_REPORT_VERSION = 1 as const

export interface ContentValidationFinding {
  severity: 'error' | 'info'
  file: string
  message: string
  suggestion: string
}

export interface ContentValidationReport {
  version: typeof CONTENT_VALIDATION_REPORT_VERSION
  generatedAt: number
  integrity: string
  findings: ContentValidationFinding[]
}

export const isContentValidationReport = (value: unknown): value is ContentValidationReport => {
  if (!value || typeof value !== 'object') return false
  const report = value as Record<string, unknown>
  return report.version === CONTENT_VALIDATION_REPORT_VERSION
    && typeof report.generatedAt === 'number'
    && Number.isFinite(report.generatedAt)
    && report.generatedAt >= 0
    && typeof report.integrity === 'string'
    && report.integrity.length > 0
    && Array.isArray(report.findings)
    && report.findings.every((finding) => {
      if (!finding || typeof finding !== 'object') return false
      const item = finding as Record<string, unknown>
      return (item.severity === 'error' || item.severity === 'info')
        && typeof item.file === 'string'
        && typeof item.message === 'string'
        && typeof item.suggestion === 'string'
    })
}
