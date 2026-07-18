import type { DoctorFinding } from '../types'
import { inspectSourceChecks } from './source-checks'

export async function inspectPublicApiUsage(rootDir: string): Promise<DoctorFinding[]> {
  return inspectSourceChecks(rootDir, [
    {
      pattern: /from\s+['"]@nuxt\/content(?:\/[^'"]*)?['"]|import\s*\([^)]*['"]@nuxt\/content(?:\/[^'"]*)?['"][^)]*\)/,
      message: 'Direct Nuxt Content import found.',
      suggestion: 'Import Ginko helpers from @lupinum/ginko-content/config, /client, or /server.'
    },
    {
      pattern: /['"]@nuxt\/content['"]/,
      message: 'Nuxt Content module or package reference found.',
      suggestion: 'Remove @nuxt/content from Nuxt modules and use @lupinum/ginko-content.'
    },
    {
      pattern: /\bqueryCollectionItemSurroundings\s*\(/,
      message: 'Nuxt Content v3 surround helper found.',
      suggestion: 'Use useContentPage(\'docs\', { surround: true }) in route page components.'
    },
    {
      pattern: /\bqueryCollectionSearchSections\s*\(/,
      message: 'Nuxt Content v3 search sections helper found.',
      suggestion: 'Use useContentSearch({ collection: docs }) for UI search data.'
    },
    {
      pattern: /\bqueryCollectionNavigation\s*\(/,
      message: 'Nuxt Content v3 navigation helper found.',
      suggestion: 'Use navigation(\'docs\', options) from @lupinum/ginko-content/client inside useAsyncData for layout navigation.'
    },
    {
      pattern: /\bqueryCollection\s*\(/,
      message: 'Removed collection query helper found.',
      suggestion: 'Use one(\'docs\', options), many(\'docs\', options), or paginate(\'docs\', options) from @lupinum/ginko-content/client inside useAsyncData.'
    },
    {
      pattern: /\buseContentList\s*\(/,
      message: 'Removed content list composable found.',
      suggestion: 'Use many(\'docs\', options) from @lupinum/ginko-content/client inside useAsyncData.'
    },
    {
      pattern: /\bcontent\.(database|build)\b/,
      message: 'Nuxt Content v3 runtime config key found.',
      suggestion: 'Remove content.database/content.build and configure Ginko runtime options instead.'
    },
    {
      // `content.preview` is a real Ginko option (ContentPreviewOptions), unlike
      // `content.database`/`content.build`, so it is not flagged as a v3
      // leftover. It protects preview-storage overlay reads; it is not a
      // production filesystem-preview switch or a partial-visibility switch.
      pattern: /\bcontent\.preview\b/,
      message: 'content.preview configuration found.',
      suggestion: 'content.preview protects filesystem preview-storage overlays. Ordinary drafts are visible in development, partials remain structural non-routes, and authenticated filesystem preview is unsupported in production; use provider-owned preview there.',
      severity: 'info'
    },
    {
      pattern: /\.editor\s*\(/,
      message: 'Nuxt Studio Zod .editor(...) helper found.',
      suggestion: 'Remove .editor(...) from runtime Zod schemas or move editor metadata outside the schema.'
    }
  ])
}
