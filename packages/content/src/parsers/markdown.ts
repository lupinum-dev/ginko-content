import { parse } from 'comark'
import { isRelative } from 'ufo'
import type { MarkdownNode, MarkdownOptions, MarkdownParsedContent, MarkdownRoot } from '../types/content'
import { defineTransformer } from './utils'
import { generatePath } from './path-meta'
import { resolveMarkdownPlugins } from './markdown-plugins'
import { stripReservedContentKeys } from './reserved'
import { mapMarkdownNodes, toMarkdownRoot } from '../core/markdown/tree'

export default defineTransformer({
  name: 'markdown',
  extensions: ['.md'],
  parse: async (id, content, options = {}) => {
    const config = { ...(typeof options === 'object' && options !== null ? options : {}) } as MarkdownOptions
    const plugins = await resolveMarkdownPlugins(config.plugins || [])
    const tree = await parse(content as string, {
      plugins
    })

    const frontmatter = stripReservedContentKeys(tree.frontmatter as Record<string, unknown>, id)

    const body = normalizeMarkdownBody({
      ...toMarkdownRoot(tree.nodes as any[]),
      // `undefined` is not a JSON-pure value (VNEXT §11): omit `toc`
      // entirely when the document has none, instead of setting the key to
      // `undefined`.
      ...(tree.meta?.toc ? { toc: tree.meta.toc } : {})
    })
    const excerpt = Array.isArray(tree.meta?.summary)
      ? normalizeMarkdownBody({
          ...toMarkdownRoot(tree.meta.summary as any[])
        })
      : undefined

    return <MarkdownParsedContent>{
      ...frontmatter,
      description: typeof frontmatter.description === 'string' ? frontmatter.description : '',
      // Omit the key entirely rather than set it to `undefined`: the
      // canonical JSON value model (VNEXT §11) rejects `undefined` values,
      // and a document with no excerpt should simply not carry the field.
      ...(excerpt ? { excerpt } : {}),
      body,
      type: 'markdown',
      id
    }
  }
})

function normalizeMarkdownBody (body: MarkdownRoot): MarkdownRoot {
  return {
    ...body,
    children: mapMarkdownNodes(body.children, normalizeMarkdownNode)
  }
}

function normalizeMarkdownNode (node: MarkdownNode): MarkdownNode {
  if (node.tag !== 'a') {
    return node
  }

  const href = typeof node.props?.href === 'string' ? node.props.href : undefined
  if (!href) {
    return node
  }

  return {
    ...node,
    props: {
      ...node.props,
      href: normalizeLink(href)
    }
  }
}

function normalizeLink (link: string) {
  const match = link.match(/#.+$/)
  const hash = match ? match[0] : ''
  if (link.replace(/#.+$/, '').endsWith('.md') && (isRelative(link) || (!/^https?/.test(link) && !link.startsWith('/')))) {
    const normalized = link.replace('.md' + hash, '').replace(/^\.\//, '')
    return (generatePath(normalized, { forceLeadingSlash: false }) + hash)
  }

  return link
}
