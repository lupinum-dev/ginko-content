import { defineAsyncComponent } from 'vue'
import { markdownRendererComponents } from '#content/virtual/markdown-renderer-components'

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

export function resolveMarkdownRendererComponents () {
  return { ...markdownRendererComponents }
}
