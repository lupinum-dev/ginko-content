import type { ComarkPlugin } from 'comark'
import highlightPlugin from 'comark/plugins/highlight'
import summaryPlugin from 'comark/plugins/summary'
import tocPlugin from 'comark/plugins/toc'
import footnotesPlugin from 'comark/plugins/footnotes'
import materialThemeLighter from 'shiki/dist/themes/material-theme-lighter.mjs'
import materialThemePalenight from 'shiki/dist/themes/material-theme-palenight.mjs'
import type { ResolvedMarkdownPlugin } from '../types/content'

type BuiltinMarkdownPluginSpec = {
  load: () => Promise<any>
}

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

// Two loading strategies live side by side here on purpose:
//   - Most builtin comark plugins use a literal `import('comark/plugins/x')`
//     (via `loadBuiltinModule`). These are statically analyzable, so the
//     bundler resolves them at build time and they pull in zero optional peers.
//   - `math` and `mermaid` stay behind the `@vite-ignore` `loadModule` path
//     because they hard-import optional peers (katex / mermaid) that are not
//     installed by default; a literal import would make the bundler try to
//     resolve those absent peers and fail. Deferring to a runtime `loadModule`
//     keeps them opt-in — they only load when an app actually installs the peer.
const builtinMarkdownPlugins: Record<string, BuiltinMarkdownPluginSpec> = {
  breaks: {
    load: () => loadBuiltinModule(() => import('comark/plugins/breaks'))
  },
  emoji: {
    load: () => loadBuiltinModule(() => import('comark/plugins/emoji'))
  },
  footnotes: {
    load: async () => footnotesPlugin
  },
  highlight: {
    load: async () => highlightPlugin
  },
  'json-render': {
    load: () => loadBuiltinModule(() => import('comark/plugins/json-render'))
  },
  math: {
    load: () => loadModule('comark/plugins/math')
  },
  mermaid: {
    load: () => loadModule('comark/plugins/mermaid')
  },
  punctuation: {
    load: () => loadBuiltinModule(() => import('comark/plugins/punctuation'))
  },
  security: {
    load: () => loadBuiltinModule(() => import('comark/plugins/security'))
  },
  summary: {
    load: async () => summaryPlugin
  },
  toc: {
    load: async () => tocPlugin
  }
}

export async function resolveMarkdownPlugins (plugins: ResolvedMarkdownPlugin[]): Promise<ComarkPlugin[]> {
  return await Promise.all(plugins.map(async (plugin) => {
    const factory = await loadMarkdownPluginFactory(plugin.name)
    return factory(await resolveMarkdownPluginOptions(plugin))
  }))
}

async function loadMarkdownPluginFactory (name: string) {
  const builtin = builtinMarkdownPlugins[name]
  if (builtin) {
    return await builtin.load()
  }

  return await loadModule(name)
}

async function loadModule (specifier: string) {
  const imported = await import(/* @vite-ignore */ specifier)
  return resolveModule(imported)
}

async function loadBuiltinModule (loader: () => Promise<unknown>) {
  const imported = await loader()
  return resolveModule(imported)
}

function resolveModule<T> (imported: T) {
  return (imported as Record<string, unknown>).default || imported
}
