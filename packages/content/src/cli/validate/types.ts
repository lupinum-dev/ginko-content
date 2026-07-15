import type { ContentValidationFinding } from '../../features/validation/report'

export interface ContentValidationOptions {
  rootDir?: string
}

export interface ContentValidationResult {
  rootDir: string
  findings: ContentValidationFinding[]
  exitCode: 0 | 1
}
