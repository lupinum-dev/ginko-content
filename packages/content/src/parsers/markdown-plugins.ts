import type { ComarkPlugin } from 'comark'
import highlightPlugin from 'comark/plugins/highlight'
import summaryPlugin from 'comark/plugins/summary'
import tocPlugin from 'comark/plugins/toc'
import materialThemeLighter from 'shiki/dist/themes/material-theme-lighter.mjs'
import materialThemePalenight from 'shiki/dist/themes/material-theme-palenight.mjs'
import type { ResolvedMarkdownPlugin } from '../types/content'

type BuiltinMarkdownPluginSpec = {
  load: () => Promise<(options?: Record<string, unknown>) => ComarkPlugin>
}

const cloneSerializableValue = <T>(value: T): T => {
  if (typeof value !== 'object' || value === null) {
    return value
  }

  return structuredClone(value)
}

const defaultHighlightThemes = () => ({
  light: cloneSerializableValue(materialThemeLighter),
  dark: cloneSerializableValue(materialThemePalenight)
})

export const normalizeMarkdownPluginOptions = (plugin: ResolvedMarkdownPlugin) => {
  if (plugin.name !== 'highlight') {
    return plugin.options
  }

  const options = plugin.options || {}
  const themes = (options as Record<string, unknown>).themes
  if (typeof themes !== 'object' || themes === null) {
    return {
      ...options,
      registerDefaultThemes: false,
      themes: defaultHighlightThemes()
    }
  }

  // Shiki normalizes theme objects by mutating nested token arrays. Imported
  // theme modules can be non-extensible in Nuxt/Nitro builds, so pass fresh
  // clones into the highlighter instead of leaking module objects downstream.
  // Also disable Comark's default theme imports; those imports can be frozen too.
  return {
    ...options,
    registerDefaultThemes: false,
    themes: cloneSerializableValue(themes)
  }
}

const builtinMarkdownPlugins: Record<string, BuiltinMarkdownPluginSpec> = {
  breaks: {
    load: () => loadModule('comark/plugins/breaks')
  },
  emoji: {
    load: () => loadModule('comark/plugins/emoji')
  },
  highlight: {
    load: async () => highlightPlugin
  },
  'json-render': {
    load: () => loadModule('comark/plugins/json-render')
  },
  math: {
    load: () => loadModule('comark/plugins/math')
  },
  mermaid: {
    load: () => loadModule('comark/plugins/mermaid')
  },
  punctuation: {
    load: () => loadModule('comark/plugins/punctuation')
  },
  security: {
    load: () => loadModule('comark/plugins/security')
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
    return factory(normalizeMarkdownPluginOptions(plugin))
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

function resolveModule<T> (imported: T) {
  return (imported as Record<string, unknown>).default || imported
}
