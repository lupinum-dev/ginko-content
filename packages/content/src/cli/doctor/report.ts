import type { DoctorResult } from './types'

export function formatDoctorResult(result: DoctorResult): string {
  const errors = result.findings.filter(finding => finding.severity === 'error')
  const infos = result.findings.filter(finding => finding.severity === 'info')
  const lines = [
    `Ginko Content doctor: ${errors.length ? 'issues found' : 'ok'}`,
    `Root: ${result.rootDir}`
  ]

  if (errors.length) {
    lines.push('', `Errors (${errors.length})`)
    for (const finding of errors) {
      lines.push(`- ${finding.file}: ${finding.message}`)
      lines.push(`  Fix: ${finding.suggestion}`)
    }
  }

  if (infos.length) {
    lines.push('', `Info (${infos.length})`)
    for (const finding of infos) {
      lines.push(`- ${finding.file}: ${finding.message}`)
      lines.push(`  Check: ${finding.suggestion}`)
    }
  }

  return `${lines.join('\n')}\n`
}
