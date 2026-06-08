import type { DoctorFinding } from '../types'
import { inspectSourceChecks } from './source-checks'

export async function inspectRenderingUsage(rootDir: string): Promise<DoctorFinding[]> {
  return inspectSourceChecks(rootDir, [
    {
      pattern: /<ContentRenderer\b[^>]*:value\s*=\s*["'][^"']*\.body["']/,
      message: 'ContentRenderer is receiving a document body.',
      suggestion: 'Pass the full content document to ContentRenderer, not document.body.'
    },
    {
      pattern: /<NuxtLink\b[^>]*:to\s*=\s*["'][^"']+\._path["']/,
      message: 'NuxtLink is using raw content _path.',
      suggestion: 'Use useContentMany(\'docs\', options) for list pages and bind the route-safe item.path field.'
    }
  ])
}
