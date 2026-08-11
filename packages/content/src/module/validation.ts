import type { ResolvedMarkdownPlugin } from '../types/content'
import { assertCanonicalHighlightOptionNames } from '../parsers/markdown-plugins'
import type { ContentCollectionConfig } from '../types/config'
import { normalizeContentConfigCollectionNames } from '../types/config'
import type { ContentContext, ModuleOptions } from '../types/module'

const BUILTIN_PLUGIN_PEER_DEPS: Record<string, string | undefined> = {
  highlight: 'shiki',
  math: 'katex',
  mermaid: 'beautiful-mermaid'
}

export function assertConfiguredProviderAvailable(contentContext: Pick<ContentContext, 'provider' | 'providers'>) {
  const provider = contentContext.provider || 'filesystem'
  if (provider === 'filesystem') return

  if (contentContext.providers?.[provider]) return

  throw new Error(`content.config.ts sets provider "${provider}", but no provider module registered it. Register a module for "${provider}" or add it to content providers.`)
}

export function validateCollectionNames(collections: Record<string, ContentCollectionConfig>) {
  normalizeContentConfigCollectionNames(collections)
}

export function validateContentConfigOnlyOptions(options: ModuleOptions) {
  const record = options as unknown as Record<string, unknown>
  for (const key of ['collections', 'provider', 'providers'] as const) {
    if (record[key] !== undefined) {
      throw new Error(`content.${key} was removed from nuxt.config. Move it to content.config.ts so content configuration has one source of truth.`)
    }
  }
}

export function validateRemovedMarkdownOptions(options: ModuleOptions) {
  if ((options as unknown as Record<string, unknown>).highlight !== undefined) {
    throw new Error('`content.highlight` was removed. Enable syntax highlighting with `content.markdown.plugins`, for example `[[\'highlight\', { ...options }]]`.')
  }

  const markdown = (options.markdown || {}) as Record<string, unknown>
  const removedOptions = ['mdc', 'remarkPlugins', 'rehypePlugins', 'toc']
  const removed = removedOptions.filter(key => typeof markdown[key] !== 'undefined')

  if (removed.length) {
    throw new Error(`Removed markdown options: ${removed.map(option => `content.markdown.${String(option)}`).join(', ')}. Use ordered \`content.markdown.plugins\` entries instead.`)
  }
}

export async function validateBuiltinMarkdownPlugins(
  plugins: ResolvedMarkdownPlugin[],
  resolvePath: (path: string) => Promise<string>
) {
  for (const plugin of plugins) {
    if (plugin.name === 'highlight') assertCanonicalHighlightOptionNames(plugin.options)
    const peerDependency = BUILTIN_PLUGIN_PEER_DEPS[plugin.name]
    if (!peerDependency) {
      continue
    }

    try {
      await resolvePath(peerDependency)
    } catch (error: unknown) {
      const next = new Error(`Markdown plugin "${plugin.name}" requires "${peerDependency}" to be installed.`)
      ;(next as Error & { cause?: unknown }).cause = error
      throw next
    }
  }
}
