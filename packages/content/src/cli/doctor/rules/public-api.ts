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
      suggestion: 'Use useContentSearchData(\'docs\') for UI search data.'
    },
    {
      pattern: /\bqueryCollectionNavigation\s*\(/,
      message: 'Nuxt Content v3 navigation helper found.',
      suggestion: 'Use useContentNavigation(\'docs\') for layout navigation.'
    },
    {
      pattern: /\bqueryCollection\s*\(/,
      message: 'Removed collection query helper found.',
      suggestion: 'Use one(\'docs\', options), many(\'docs\', options), paginate(\'docs\', options), or the matching useContent* composable.'
    },
    {
      pattern: /\buseContentList\s*\(/,
      message: 'Removed content list composable found.',
      suggestion: 'Use useContentMany(\'docs\', options) or many(\'docs\', options).'
    },
    {
      pattern: /\bcontent\.(database|preview|build)\b/,
      message: 'Nuxt Content v3 runtime config key found.',
      suggestion: 'Remove content.database/content.preview/content.build and configure Ginko runtime options instead.'
    },
    {
      pattern: /\.editor\s*\(/,
      message: 'Nuxt Studio Zod .editor(...) helper found.',
      suggestion: 'Remove .editor(...) from runtime Zod schemas or move editor metadata outside the schema.'
    }
  ])
}
