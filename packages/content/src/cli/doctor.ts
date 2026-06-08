import type { DoctorOptions, DoctorResult } from './doctor/types'
import { inspectSitemap } from './doctor/sitemap'
import { inspectI18n } from './doctor/i18n'
import { inspectDependencies } from './doctor/rules/dependencies'
import { inspectPublicApiUsage } from './doctor/rules/public-api'
import { inspectRenderingUsage } from './doctor/rules/rendering'
import { inspectSearchCollections } from './doctor/rules/search'
export { formatDoctorResult } from './doctor/report'

export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorResult> {
  const rootDir = options.rootDir || process.cwd()
  const findings = [
    ...await inspectDependencies(rootDir),
    ...await inspectPublicApiUsage(rootDir),
    ...await inspectRenderingUsage(rootDir),
    ...await inspectSearchCollections(rootDir),
    ...await inspectSitemap(rootDir),
    ...(options.i18n ? await inspectI18n(rootDir) : [])
  ].sort((a, b) => `${a.severity}:${a.file}:${a.message}`.localeCompare(`${b.severity}:${b.file}:${b.message}`))
  const exitCode = findings.some(finding => finding.severity === 'error') ? 1 : 0

  return {
    rootDir,
    findings,
    exitCode
  }
}
