import { isRelative } from 'ufo'
import type { MarkdownNode, MarkdownOptions, MarkdownParsedContent, MarkdownRoot } from '../types/content'
import { defineTransformer } from './utils'
import { generatePath } from './path-meta'
import { resolveMarkdownPlugins } from './markdown-plugins'
import { stripReservedContentKeys } from './reserved'
import { mapMarkdownNodes, toMarkdownRoot } from '../core/markdown/tree'
import { normalizeComarkNodes } from '../core/markdown/normalize-comark'
import { createComarkParser, parseComark } from '../core/markdown/parse-comark'
import type { ComarkParser } from '../core/markdown/parse-comark'

const configuredParsers = new WeakMap<object, Promise<ComarkParser>>()

/** Resolve one parser for the lifetime of one immutable resolved option object. */
export const getConfiguredComarkParser = (options: MarkdownOptions): Promise<ComarkParser> => {
  const existing = configuredParsers.get(options)
  if (existing) return existing

  const parser = resolveMarkdownPlugins(options.plugins || [])
    .then(plugins => createComarkParser(plugins))
  configuredParsers.set(options, parser)
  void parser.catch(() => {
    // A setup error belongs to this attempted profile, not to the option
    // object's lifetime. Dev/HMR or a caller may correct the same object.
    if (configuredParsers.get(options) === parser) configuredParsers.delete(options)
  })
  return parser
}

export default defineTransformer({
  name: 'markdown',
  extensions: ['.md'],
  parse: async (id, content, options = {}) => {
    const optionOwner = (typeof options === 'object' && options !== null ? options : {}) as MarkdownOptions
    const config = { ...optionOwner } as MarkdownOptions
    const configuredPlugins = config.plugins || []
    const normalizationOptions = { enabledPlugins: configuredPlugins.map(plugin => plugin.name) }
    const tree = configuredPlugins.length
      ? await (await getConfiguredComarkParser(optionOwner))(content as string)
      : await parseComark(content as string)

    const frontmatter = stripReservedContentKeys(tree.frontmatter as Record<string, unknown>, id)

    const body = normalizeMarkdownBody({
      ...toMarkdownRoot(normalizeComarkNodes(tree.nodes as unknown[], normalizationOptions) as any[]),
      // `undefined` is not a JSON-pure value: omit `toc`
      // entirely when the document has none, instead of setting the key to
      // `undefined`.
      ...(tree.meta?.toc ? { toc: tree.meta.toc } : {})
    })
    const excerpt = Array.isArray(tree.meta?.summary)
      ? normalizeMarkdownBody({
          ...toMarkdownRoot(normalizeComarkNodes(tree.meta.summary as unknown[], normalizationOptions) as any[])
        })
      : undefined

    return <MarkdownParsedContent>{
      ...frontmatter,
      description: typeof frontmatter.description === 'string' ? frontmatter.description : '',
      // Omit the key entirely rather than set it to `undefined`: the
      // canonical JSON value model rejects `undefined` values,
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
