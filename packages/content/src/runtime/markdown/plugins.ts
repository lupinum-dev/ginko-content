import { defineAsyncComponent } from 'vue'
import type { ResolvedMarkdownPlugin } from '../../types/content'
export { resolveMarkdownPlugins } from '../../parsers/markdown-plugins'

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

export function resolveMarkdownRendererComponents (plugins: ResolvedMarkdownPlugin[]) {
  const components: Record<string, unknown> = {
    ...builtinMarkdownComponents
  }

  for (const plugin of plugins) {
    const builtin = builtinMarkdownPlugins[plugin.name]
    if (builtin?.componentName && builtin.component) {
      components[plugin.name] = builtin.component
    }
  }

  return components
}
