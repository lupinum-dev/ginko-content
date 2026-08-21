import type { MarkdownPluginDescriptor } from '../../types/content'
import type { RuntimeDiagnostic } from '../runtime-diagnostics'

export interface MarkdownFeatureUsage {
  /** Documents whose source contains `$$` block math. */
  math: string[]
  /** Documents whose source contains a ```mermaid fence. */
  mermaid: string[]
}

export const emptyMarkdownFeatureUsage = (): MarkdownFeatureUsage => ({
  math: [],
  mermaid: []
})

const MATH_BLOCK_PATTERN = /\$\$[\s\S]*?\$\$/
const MERMAID_FENCE_PATTERN = /^[ \t]*```mermaid[ \t]*$/m

/** Detect opt-in markdown features from raw document source, before parsing. */
export const detectMarkdownFeatureUsage = (source: string): { math: boolean, mermaid: boolean } => ({
  math: MATH_BLOCK_PATTERN.test(source),
  mermaid: MERMAID_FENCE_PATTERN.test(source)
})

const MAX_EXAMPLE_FILES = 5

const describeFiles = (files: readonly string[]): string => {
  const examples = files.slice(0, MAX_EXAMPLE_FILES).map(file => `"${file}"`).join(', ')
  const more = files.length > MAX_EXAMPLE_FILES ? ` and ${files.length - MAX_EXAMPLE_FILES} more` : ''
  return `${examples}${more}`
}

export const recordMarkdownFeatureUsage = (
  usage: MarkdownFeatureUsage,
  file: string,
  detected: { math: boolean, mermaid: boolean }
): void => {
  if (detected.math && usage.math.length < 50) {
    usage.math.push(file)
  }
  if (detected.mermaid && usage.mermaid.length < 50) {
    usage.mermaid.push(file)
  }
}

const enabledPluginNames = (plugins: readonly MarkdownPluginDescriptor[] | undefined): Set<string> =>
  new Set((plugins ?? []).map(descriptor =>
    typeof descriptor === 'string' ? descriptor : descriptor[0]
  ))

const FEATURE_PLUGIN_NAMES: Record<keyof Omit<MarkdownFeatureUsage, never>, string> = {
  math: 'math',
  mermaid: 'mermaid'
}

/**
 * Diagnostics for documents using features their build-time markdown config
 * will not render. `ContentRenderer` output silently degrades for these
 * (literal `$$…$$` text, plain code fence), so the build says so instead.
 */
export const buildMarkdownFeatureDiagnostics = (
  usage: MarkdownFeatureUsage,
  plugins: readonly MarkdownPluginDescriptor[] | undefined
): RuntimeDiagnostic[] => {
  const enabled = enabledPluginNames(plugins)

  const diagnostics: RuntimeDiagnostic[] = []
  const features = Object.keys(FEATURE_PLUGIN_NAMES) as Array<keyof typeof FEATURE_PLUGIN_NAMES>
  for (const feature of features) {
    const pluginName = FEATURE_PLUGIN_NAMES[feature]
    const files = usage[feature]
    if (!files.length || enabled.has(pluginName)) {
      continue
    }
    diagnostics.push({
      key: `markdown-${feature}-plugin-not-enabled`,
      message:
        `${files.length} document${files.length === 1 ? '' : 's'} use ${feature === 'math' ? '"$$" math' : 'mermaid fences'} ` +
        `(${describeFiles(files)}), but the "${pluginName}" markdown plugin is not enabled. ` +
        `Add "${pluginName}" to markdown.plugins to render it; otherwise it stays literal text.`
    })
  }
  return diagnostics
}
