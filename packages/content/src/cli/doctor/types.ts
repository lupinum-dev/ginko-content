export type FindingSeverity = 'error' | 'info'

export interface DoctorFinding {
  severity: FindingSeverity
  file: string
  message: string
  suggestion: string
}

export interface DoctorResult {
  rootDir: string
  findings: DoctorFinding[]
  exitCode: number
}

export interface DoctorOptions {
  rootDir?: string
  i18n?: boolean
}

export interface SitemapFile {
  file: string
  text: string
}

export interface DetectedI18n {
  locales: string[]
  hasNuxtI18nModule: boolean
  hasContentI18nConfig: boolean
  hasNuxtI18nDependency: boolean
}
