import { defineAsyncComponent } from 'vue'
import type { ResolvedMarkdownPlugin } from '../../types/content'

type BuiltinMarkdownPluginSpec = {
  componentName?: string
  component?: unknown
}

const importOptionalMarkdownComponent = async (specifier: string) =>
  await import(/* @vite-ignore */ specifier)

const builtinMarkdownPlugins: Record<string, BuiltinMarkdownPluginSpec> = {
  math: {
    componentName: 'Math',
    component: defineAsyncComponent(async () => {
      const mod = await importOptionalMarkdownComponent('@comark/vue/plugins/math')
      return mod.Math
    })
  },
  mermaid: {
    componentName: 'Mermaid',
    component: defineAsyncComponent(async () => {
      const mod = await importOptionalMarkdownComponent('@comark/vue/plugins/mermaid')
      return mod.Mermaid
    })
  }
}

const builtinMarkdownComponents: Record<string, unknown> = {
  ProseImg: defineAsyncComponent(async () => await import('../app/components/Prose/ProseImg.vue'))
}

/**
 * Builtin prose components resolve after the app's component registry, so an
 * app-registered ProseImg (or a tags remap) wins over the bundled default.
 */
export function resolveMarkdownRendererFallbackComponents (): Record<string, unknown> {
  return { ...builtinMarkdownComponents }
}

export function resolveMarkdownRendererComponents (plugins: ResolvedMarkdownPlugin[]) {
  const components: Record<string, unknown> = {}

  for (const plugin of plugins) {
    const builtin = builtinMarkdownPlugins[plugin.name]
    if (builtin?.componentName && builtin.component) {
      components[plugin.name] = builtin.component
    }
  }

  return components
}
