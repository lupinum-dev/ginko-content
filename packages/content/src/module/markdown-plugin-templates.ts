import type { addTemplate } from '@nuxt/kit'
import type { ResolvedMarkdownPlugin } from '../types/content'
import type { PortableComponentPolicyV1 } from '../types/component-policy'
import { assertCanonicalHighlightOptionNames } from '../parsers/markdown-plugin-options'
import { BUILTIN_MARKDOWN_RENDER_CONTRACTS } from '../core/markdown/builtin-render-contracts'

interface BuiltinMarkdownPlugin {
  parserSpecifier: string
  peer?: string
  renderer?: {
    specifier: string
    exportName: string
    tag: string
    componentPolicy: PortableComponentPolicyV1['components'][string]
  }
}

const BUILTIN_MARKDOWN_PLUGINS: Record<string, BuiltinMarkdownPlugin> = {
  breaks: { parserSpecifier: 'comark/plugins/breaks' },
  emoji: { parserSpecifier: 'comark/plugins/emoji' },
  footnotes: { parserSpecifier: 'comark/plugins/footnotes' },
  shiki: { parserSpecifier: 'comark/plugins/shiki', peer: 'shiki' },
  'json-render': { parserSpecifier: 'comark/plugins/json-render' },
  math: {
    parserSpecifier: 'comark/plugins/math',
    peer: 'katex',
    renderer: {
      specifier: '@comark/vue/plugins/math',
      exportName: 'Math',
      ...BUILTIN_MARKDOWN_RENDER_CONTRACTS.math
    }
  },
  mermaid: {
    parserSpecifier: 'comark/plugins/mermaid',
    peer: 'beautiful-mermaid',
    renderer: {
      specifier: '@comark/vue/plugins/mermaid',
      exportName: 'Mermaid',
      ...BUILTIN_MARKDOWN_RENDER_CONTRACTS.mermaid
    }
  },
  punctuation: { parserSpecifier: 'comark/plugins/punctuation' },
  security: { parserSpecifier: 'comark/plugins/security' },
  summary: { parserSpecifier: 'comark/plugins/summary' },
  toc: { parserSpecifier: 'comark/plugins/toc' }
}

export interface MarkdownPluginRegistryEntry {
  name: string
  parserPath: string
  renderer?: {
    path: string
    exportName: string
    tag: string
    componentPolicy: PortableComponentPolicyV1['components'][string]
  }
}

export function canonicalizeMarkdownPluginAliases(
  plugins: ResolvedMarkdownPlugin[],
  warn: (message: string) => void
): ResolvedMarkdownPlugin[] {
  const hasHighlight = plugins.some(plugin => plugin.name === 'highlight')
  const hasShiki = plugins.some(plugin => plugin.name === 'shiki')
  if (hasHighlight && hasShiki) {
    throw new TypeError('Markdown plugins "highlight" and "shiki" configure the same integration. Remove "highlight" and keep only "shiki".')
  }
  if (hasHighlight) {
    warn('[ginko-content] Markdown plugin "highlight" is deprecated. Rename it to "shiki"; the alias will be removed in the next major version.')
  }
  return plugins.map(plugin => plugin.name === 'highlight'
    ? { ...plugin, name: 'shiki' }
    : plugin)
}

export function withMarkdownPluginComponentPolicy(
  policy: PortableComponentPolicyV1 | undefined,
  registry: MarkdownPluginRegistryEntry[]
): PortableComponentPolicyV1 {
  const components = { ...(policy?.components || {}) }
  for (const entry of registry) {
    const renderer = entry.renderer
    if (!renderer) continue
    if (components[renderer.tag]) {
      throw new TypeError(`Component policy name "${renderer.tag}" is reserved for the enabled Markdown plugin "${entry.name}".`)
    }
    components[renderer.tag] = renderer.componentPolicy
  }
  return { components }
}

interface ResolveMarkdownPluginRegistryOptions {
  resolveAppPath: (specifier: string) => Promise<string>
  resolveModulePath: (specifier: string) => Promise<string>
}

export async function resolveMarkdownPluginRegistry(
  plugins: ResolvedMarkdownPlugin[],
  { resolveAppPath, resolveModulePath }: ResolveMarkdownPluginRegistryOptions
): Promise<MarkdownPluginRegistryEntry[]> {
  const entries = new Map<string, MarkdownPluginRegistryEntry>()

  for (const plugin of plugins) {
    if (entries.has(plugin.name)) continue
    if (plugin.name === 'shiki') assertCanonicalHighlightOptionNames(plugin.options)

    const builtin = BUILTIN_MARKDOWN_PLUGINS[plugin.name]
    const peer = builtin?.peer
    if (peer) {
      try {
        await resolveAppPath(peer)
      } catch (error: unknown) {
        const next = new Error(`Markdown plugin "${plugin.name}" requires "${peer}" to be installed in the Nuxt application.`)
        ;(next as Error & { cause?: unknown }).cause = error
        throw next
      }
    }

    let parserPath: string
    try {
      if (builtin) {
        parserPath = await resolveModulePath(builtin.parserSpecifier)
      } else {
        parserPath = await resolveAppPath(plugin.name)
      }
    } catch (error: unknown) {
      const next = new Error(`Markdown plugin "${plugin.name}" could not be resolved during Nuxt module setup.`)
      ;(next as Error & { cause?: unknown }).cause = error
      throw next
    }

    const renderer = builtin?.renderer
    entries.set(plugin.name, {
      name: plugin.name,
      parserPath,
      ...(renderer
        ? {
            renderer: {
              path: renderer.specifier,
              exportName: renderer.exportName,
              tag: renderer.tag,
              componentPolicy: renderer.componentPolicy
            }
          }
        : {})
    })
  }

  return [...entries.values()]
}

export function createMarkdownPluginTemplates(
  registry: MarkdownPluginRegistryEntry[],
  addTemplateImpl: typeof addTemplate
) {
  const parserTemplate = addTemplateImpl({
    filename: 'content/virtual-markdown-parser-plugins.mjs',
    write: true,
    getContents: () => {
      const imports = registry.map((entry, index) =>
        `import * as plugin${index} from ${JSON.stringify(entry.parserPath)}`
      )
      const entries = registry.map((entry, index) =>
        `${JSON.stringify(entry.name)}: resolvePluginFactory(plugin${index})`
      )
      return [
        ...imports,
        'const resolvePluginFactory = mod => mod.default || mod',
        `export const markdownPluginFactories = { ${entries.join(', ')} }`,
        'export default {}'
      ].join('\n')
    }
  }).dst

  const renderers = registry.flatMap(entry => entry.renderer ? [entry.renderer] : [])
  const rendererTemplate = addTemplateImpl({
    filename: 'content/virtual-markdown-renderer-components.mjs',
    write: true,
    getContents: () => {
      if (!renderers.length) {
        return 'export const markdownRendererComponents = {}\nexport default {}'
      }
      return [
        `import { defineAsyncComponent } from 'vue'`,
        'export const markdownRendererComponents = {',
        ...renderers.map(renderer =>
          `  ${JSON.stringify(renderer.tag)}: defineAsyncComponent(() => import(${JSON.stringify(renderer.path)}).then(mod => mod[${JSON.stringify(renderer.exportName)}])),`
        ),
        '}',
        'export default {}'
      ].join('\n')
    }
  }).dst

  return { parserTemplate, rendererTemplate }
}
