import type { ParsedContent } from '../../types/content'
import { localComponents, localComponentLoaders } from '../utils/content-components'
import { resolveDocumentContentComponents, loadContentComponentEntries } from '../../integrations/vue/content-components'
import { defineTransformer } from './utils'

export async function resolveContentComponents (body: ParsedContent['body'], meta: Record<string, string>) {
  return await resolveDocumentContentComponents(body as any, {
    tags: meta,
    catalog: {
      localComponents,
      localComponentLoaders
    }
  })
}

export function loadComponents (node: ParsedContent['body'] | { type?: string, tag?: string, props?: Record<string, unknown>, children?: Array<ParsedContent['body']> } | null, tags: Record<string, string>) {
  return loadContentComponentEntries(node as any, tags)
}
export default defineTransformer({
  name: 'component-resolver',
  extensions: ['.*'],
  async transform (content, options = {}) {
    if (import.meta.server) {
      // This transformer is only needed on client side to resolve components
      return content
    }

    const transformerOptions = typeof options === 'object' && options !== null ? options as { tags?: Record<string, string> } : {}
    const _components = await resolveContentComponents(content.body, {
      ...(transformerOptions.tags || {}),
      ...(content._components || {})
    })

    content._components = _components
    return content
  }
})
