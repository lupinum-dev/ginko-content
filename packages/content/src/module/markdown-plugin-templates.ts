import type { addTemplate } from '@nuxt/kit'
import type { ResolvedMarkdownPlugin } from '../types/content'
import type { PortableComponentPolicyV1 } from '../types/component-policy'
import { assertCanonicalHighlightOptionNames } from '../parsers/markdown-plugin-options'

const BUILTIN_PARSER_SPECIFIERS: Record<string, string> = {
  breaks: 'comark/plugins/breaks',
  emoji: 'comark/plugins/emoji',
  footnotes: 'comark/plugins/footnotes',
  highlight: 'comark/plugins/highlight',
  'json-render': 'comark/plugins/json-render',
  math: 'comark/plugins/math',
  mermaid: 'comark/plugins/mermaid',
  punctuation: 'comark/plugins/punctuation',
  security: 'comark/plugins/security',
  summary: 'comark/plugins/summary',
  toc: 'comark/plugins/toc'
}

const BUILTIN_PEERS: Record<string, string | undefined> = {
  highlight: 'shiki',
  math: 'katex',
  mermaid: 'beautiful-mermaid'
}

const BUILTIN_RENDERERS: Record<string, { specifier: string, exportName: string, tag: string } | undefined> = {
  math: { specifier: '@comark/vue/plugins/math', exportName: 'Math', tag: 'ginko-math' },
  mermaid: { specifier: '@comark/vue/plugins/mermaid', exportName: 'Mermaid', tag: 'ginko-mermaid' }
}

export interface MarkdownPluginRegistryEntry {
  name: string
  parserPath: string
  renderer?: {
    path: string
    exportName: string
    tag: string
  }
}

const PLUGIN_COMPONENT_POLICIES: Record<string, PortableComponentPolicyV1['components'][string] | undefined> = {
  'ginko-math': {
    kind: 'inline',
    props: {
      class: { type: 'string', required: true },
      content: { type: 'string', required: true }
    },
    slots: [],
    media: null
  },
  'ginko-mermaid': {
    kind: 'block',
    props: {
      content: { type: 'string', required: true }
    },
    slots: [],
    media: null
  }
}

export function withMarkdownPluginComponentPolicy(
  policy: PortableComponentPolicyV1 | undefined,
  registry: MarkdownPluginRegistryEntry[]
): PortableComponentPolicyV1 {
  const components = { ...(policy?.components || {}) }
  for (const entry of registry) {
    const tag = entry.renderer?.tag
    if (!tag) continue
    if (components[tag]) {
      throw new TypeError(`Component policy name "${tag}" is reserved for the enabled Markdown plugin "${entry.name}".`)
    }
    components[tag] = PLUGIN_COMPONENT_POLICIES[tag]!
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
    if (plugin.name === 'highlight') assertCanonicalHighlightOptionNames(plugin.options)

    const builtinSpecifier = BUILTIN_PARSER_SPECIFIERS[plugin.name]
    const peer = BUILTIN_PEERS[plugin.name]
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
      if (builtinSpecifier) {
        parserPath = await resolveModulePath(builtinSpecifier)
      } else {
        parserPath = await resolveAppPath(plugin.name)
      }
    } catch (error: unknown) {
      const next = new Error(`Markdown plugin "${plugin.name}" could not be resolved during Nuxt module setup.`)
      ;(next as Error & { cause?: unknown }).cause = error
      throw next
    }

    const renderer = BUILTIN_RENDERERS[plugin.name]
    entries.set(plugin.name, {
      name: plugin.name,
      parserPath,
      ...(renderer
        ? {
            renderer: {
              path: renderer.specifier,
              exportName: renderer.exportName,
              tag: renderer.tag
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

  const rendererEntries = registry.filter(entry => entry.renderer)
  const rendererTemplate = addTemplateImpl({
    filename: 'content/virtual-markdown-renderer-components.mjs',
    write: true,
    getContents: () => {
      if (!rendererEntries.length) {
        return 'export const markdownRendererComponents = {}\nexport default {}'
      }
      return [
        `import { defineAsyncComponent } from 'vue'`,
        'export const markdownRendererComponents = {',
        ...rendererEntries.map(({ renderer }) =>
          `  ${JSON.stringify(renderer!.tag)}: defineAsyncComponent(() => import(${JSON.stringify(renderer!.path)}).then(mod => mod[${JSON.stringify(renderer!.exportName)}])),`
        ),
        '}',
        'export default {}'
      ].join('\n')
    }
  }).dst

  return { parserTemplate, rendererTemplate }
}
