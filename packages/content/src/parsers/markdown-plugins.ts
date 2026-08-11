import type { ComarkPlugin } from 'comark'
import materialThemeLighter from 'shiki/dist/themes/material-theme-lighter.mjs'
import materialThemePalenight from 'shiki/dist/themes/material-theme-palenight.mjs'
import type { ResolvedMarkdownPlugin } from '../types/content'
import { markdownPluginFactories } from '#content/virtual/markdown-parser-plugins'
import { assertCanonicalHighlightOptionNames } from './markdown-plugin-options'

export { assertCanonicalHighlightOptionNames } from './markdown-plugin-options'

type ShikiTransformer = {
  name?: string
  code?: unknown
}

type ShikiTransformerFactoryName =
  | 'transformerNotationDiff'
  | 'transformerNotationHighlight'

const shikiTransformerFactories: Record<string, ShikiTransformerFactoryName> = {
  '@shikijs/transformers:notation-diff': 'transformerNotationDiff',
  '@shikijs/transformers:notation-highlight': 'transformerNotationHighlight'
}

const cloneMarkdownPluginOptionValue = <T>(value: T): T => {
  if (typeof value !== 'object' || value === null) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(item => cloneMarkdownPluginOptionValue(item)) as T
  }

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    return value
  }

  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    cloneMarkdownPluginOptionValue(item)
  ])) as T
}

const defaultHighlightThemes = () => ({
  light: cloneMarkdownPluginOptionValue(materialThemeLighter),
  dark: cloneMarkdownPluginOptionValue(materialThemePalenight)
})

const restoreSerializedShikiTransformers = async (transformers: unknown): Promise<unknown> => {
  if (!Array.isArray(transformers)) {
    return transformers
  }

  let shikiTransformersModule: Record<string, unknown> | undefined

  return await Promise.all(transformers.map(async (transformer) => {
    if (
      typeof transformer !== 'object' ||
      transformer === null ||
      typeof (transformer as ShikiTransformer).code === 'function'
    ) {
      return transformer
    }

    const factoryName = shikiTransformerFactories[(transformer as ShikiTransformer).name || '']
    if (!factoryName) {
      return transformer
    }

    shikiTransformersModule ||= await import('@shikijs/transformers')
    const factory = shikiTransformersModule[factoryName]
    if (typeof factory !== 'function') {
      throw new TypeError(`[ginko-content] Failed to restore serialized Shiki transformer "${(transformer as ShikiTransformer).name}". Install @shikijs/transformers in the app or remove the transformer from content.markdown.plugins.`)
    }

    return (factory as () => unknown)()
  }))
}

export const normalizeMarkdownPluginOptions = (plugin: ResolvedMarkdownPlugin) => {
  if (plugin.name !== 'highlight') {
    return plugin.options
  }

  const options = plugin.options || {}
  assertCanonicalHighlightOptionNames(options)
  const normalizedOptions = cloneMarkdownPluginOptionValue(options)
  const themes = (options as Record<string, unknown>).themes
  if (typeof themes !== 'object' || themes === null) {
    return {
      ...normalizedOptions,
      registerDefaultThemes: false,
      themes: defaultHighlightThemes()
    }
  }

  // Shiki normalizes theme objects by mutating nested token arrays. Imported
  // theme modules can be non-extensible in Nuxt/Nitro builds, so pass fresh
  // clones into the highlighter instead of leaking module objects downstream.
  // Also disable Comark's default theme imports; those imports can be frozen too.
  return {
    ...normalizedOptions,
    registerDefaultThemes: false,
    themes: cloneMarkdownPluginOptionValue(themes)
  }
}

const resolveMarkdownPluginOptions = async (plugin: ResolvedMarkdownPlugin) => {
  const normalized = normalizeMarkdownPluginOptions(plugin)
  if (plugin.name !== 'highlight' || typeof normalized !== 'object' || normalized === null) {
    return normalized
  }

  const options = normalized as Record<string, unknown>
  return {
    ...options,
    transformers: await restoreSerializedShikiTransformers(options.transformers)
  }
}

export async function resolveMarkdownPlugins (plugins: ResolvedMarkdownPlugin[]): Promise<ComarkPlugin[]> {
  return await Promise.all(plugins.map(async (plugin) => {
    const factory = markdownPluginFactories[plugin.name]
    if (typeof factory !== 'function') {
      throw new TypeError(`Markdown plugin "${plugin.name}" is not present in the generated Nuxt plugin registry.`)
    }
    return factory(await resolveMarkdownPluginOptions(plugin))
  }))
}
