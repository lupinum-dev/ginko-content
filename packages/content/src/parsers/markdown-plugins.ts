import type { ComarkPlugin } from 'comark'
import highlightPlugin from 'comark/plugins/highlight'
import summaryPlugin from 'comark/plugins/summary'
import tocPlugin from 'comark/plugins/toc'
import type { ResolvedMarkdownPlugin } from '../types/content'

type BuiltinMarkdownPluginSpec = {
  load: () => Promise<(options?: Record<string, unknown>) => ComarkPlugin>
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
    return factory(plugin.options)
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
