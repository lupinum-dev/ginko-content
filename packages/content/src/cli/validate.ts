import { readFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { loadNuxtConfig } from '@nuxt/kit'
import { isContentValidationReport } from '../features/validation/report'
import type { ContentValidationOptions, ContentValidationResult } from './validate/types'

export const runContentValidation = async (options: ContentValidationOptions = {}): Promise<ContentValidationResult> => {
  const rootDir = resolve(options.rootDir || process.cwd())
  const nuxtConfig = await loadNuxtConfig({ cwd: rootDir })
  const buildDir = isAbsolute(nuxtConfig.buildDir) ? nuxtConfig.buildDir : resolve(rootDir, nuxtConfig.buildDir)
  const reportPath = join(buildDir, 'content-cache/validation.json')
  let report: unknown
  try {
    report = JSON.parse(await readFile(reportPath, 'utf8'))
  } catch {
    report = undefined
  }

  if (!isContentValidationReport(report)) {
    return {
      rootDir,
      findings: [{
        severity: 'error',
        file: relative(rootDir, reportPath),
        message: 'Generated content validation report not found or invalid.',
        suggestion: 'Run a Nuxt build with this Ginko Content version before `ginko-content validate`.'
      }],
      exitCode: 1
    }
  }

  return {
    rootDir,
    findings: report.findings,
    exitCode: report.findings.some(finding => finding.severity === 'error') ? 1 : 0
  }
}

export const formatContentValidationResult = (result: ContentValidationResult) => {
  const errors = result.findings.filter(finding => finding.severity === 'error')
  const infos = result.findings.filter(finding => finding.severity === 'info')
  const lines = [
    `Ginko Content validation: ${errors.length ? 'issues found' : 'ok'}`,
    `Root: ${result.rootDir}`
  ]
  for (const [label, findings] of [['Errors', errors], ['Info', infos]] as const) {
    if (!findings.length) continue
    lines.push('', `${label} (${findings.length})`)
    for (const finding of findings) {
      lines.push(`- ${finding.file}: ${finding.message}`, `  Fix: ${finding.suggestion}`)
    }
  }
  return `${lines.join('\n')}\n`
}
