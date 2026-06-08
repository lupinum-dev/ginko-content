import { readFile } from 'node:fs/promises'
import type { DoctorFinding } from '../types'
import { collectFiles, toRelativePath } from '../files'
import { lockfileNames } from './constants'

export interface SourceCheck {
  pattern: RegExp
  message: string
  suggestion: string
}

export async function inspectSourceChecks(rootDir: string, checks: SourceCheck[]): Promise<DoctorFinding[]> {
  const files = await collectFiles(rootDir, rootDir)
  const findings: DoctorFinding[] = []

  for (const file of files) {
    if (lockfileNames.includes(file.split('/').pop() || '')) {
      continue
    }

    const text = await readFile(file, 'utf8')
    for (const check of checks) {
      if (check.pattern.test(text)) {
        findings.push({
          severity: 'error',
          file: toRelativePath(rootDir, file),
          message: check.message,
          suggestion: check.suggestion
        })
      }
    }
  }

  return findings
}
