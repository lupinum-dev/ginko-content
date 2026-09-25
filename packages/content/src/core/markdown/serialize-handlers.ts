import type { ElementNode, NodeHandler, State } from 'comark'

/**
 * Serializer handlers that keep code verbatim and list-item blocks attached.
 *
 * Comark's defaults trim fenced code (leading blank lines and first-line
 * indentation are lost), pick a fence that code may already contain, wrap
 * inline code without padding, and do not indent a code block, quote, or table
 * that starts a list item. They also write a thematic break in a list item as
 * `- ---`, which the parser reads as one thematic break outside the list, and
 * write hard breaks as trailing spaces, which block edges lose. Strikethrough
 * loses nested formatting. Each
 * wrapper lets the default handler render the surrounding syntax around a
 * placeholder and then substitutes the exact content, so attribute rendering
 * stays with Comark.
 */

const textOf = (node: unknown): string => {
  if (typeof node === 'string') return node
  if (!Array.isArray(node)) return ''
  return node.slice(2).map(textOf).join('')
}

const longestRun = (text: string, char: string): number => {
  let longest = 0
  let current = 0
  for (const candidate of text) {
    current = candidate === char ? current + 1 : 0
    if (current > longest) longest = current
  }
  return longest
}

const LIST_ITEM_LEADING_BLOCKS = new Set(['pre', 'blockquote', 'table'])
const INLINE_TAGS = new Set(['a', 'br', 'code', 'del', 'em', 'img', 'input', 'span', 'strong'])

const isInlineNode = (node: unknown): boolean => {
  if (typeof node === 'string') return true
  if (!Array.isArray(node) || typeof node[0] !== 'string') return false
  const origin = (node[1] as { $?: { block?: unknown } } | undefined)?.$
  return origin ? origin.block === 0 : INLINE_TAGS.has(node[0])
}

export function createVerbatimHandlers(marker: string): Record<string, NodeHandler> {
  const placeholder = `${marker}code${marker}`
  const defaults = (state: State) => state.handlers as Record<string, NodeHandler>

  const pre: NodeHandler = async (node, state, parent) => {
    const [, props, ...children] = node
    const code = typeof props.code === 'string' ? props.code : children.map(textOf).join('')
    const { code: _code, ...rest } = props
    const firstChild = children[0]
    const template = (Array.isArray(firstChild) && firstChild[0] === 'code'
      ? ['pre', rest, [firstChild[0], firstChild[1], placeholder]]
      : ['pre', rest, placeholder]) as ElementNode
    const rendered = await defaults(state).pre!(template, state, parent)
    const body = rendered.indexOf(`\n${placeholder}\n`)
    const openingStart = rendered.lastIndexOf('\n', body - 1) + 1
    const opening = rendered.slice(openingStart, body)
    const closingStart = body + placeholder.length + 2
    if (body < 0 || !opening.startsWith('```') || !rendered.startsWith('```', closingStart)) return rendered
    const info = opening.slice(3)
    // A backtick fence cannot carry a backtick in its info string.
    const fenceChar = info.includes('`') ? '~' : '`'
    const fence = fenceChar.repeat(Math.max(3, longestRun(code, fenceChar) + 1))
    // An info string that starts with the fence character would lengthen the fence.
    const separator = info.startsWith(fenceChar) ? ' ' : ''
    return `${rendered.slice(0, openingStart)}${fence}${separator}${info}\n${code}\n${fence}${rendered.slice(closingStart + 3)}`
  }

  const code: NodeHandler = async (node, state, parent) => {
    const content = textOf(node)
    const rendered = await defaults(state).code!([node[0], node[1], placeholder] as ElementNode, state, parent)
    const wrapped = `\`${placeholder}\``
    if (!rendered.startsWith(wrapped)) return rendered
    // A code span closes at a backtick run of exactly its fence length. The
    // shortest unused length keeps a line-leading span from looking like a
    // code fence, which Comark's component scanner would misread.
    const runs = new Set(content.match(/`+/g)?.map(run => run.length))
    let length = 1
    while (runs.has(length)) length++
    const fence = '`'.repeat(length)
    // CommonMark strips one space from both ends, and a code span cannot start
    // or end next to its own fence without padding.
    const padded = /^`|`$/.test(content) || (/^ .* $/s.test(content) && content.trim() !== '')
      ? ` ${content} `
      : content
    return `${fence}${padded}${fence}${rendered.slice(wrapped.length)}`
  }

  const componentListItemKey = listItemInComponentKey(marker)
  const li: NodeHandler = async (node, state, parent) => {
    const { [componentListItemKey]: inComponent, ...itemProps } = node[1]
    const item = [node[0], itemProps, ...node.slice(2)] as ElementNode
    const children = item.slice(2)
    const isTaskInput = (child: unknown) => Array.isArray(child) && child[0] === 'input'
    const leadingIndex = isTaskInput(children[0]) ? 1 : 0
    const leading = children[leadingIndex]
    if (!Array.isArray(leading) || !LIST_ITEM_LEADING_BLOCKS.has(String(leading[0]))) {
      // Without a text child, Comark puts each component on its own line,
      // where an inline component reads as block shorthand. An empty text
      // child keeps inline-only content on one line.
      const inlineOnly = children.length > 0 && children.every(isInlineNode) && !children.some(child => typeof child === 'string')
      return await defaults(state).li!(inlineOnly ? [item[0], item[1], '', ...children] as ElementNode : item, state, parent)
    }
    // Comark indents a block child only after other content. An anchor that
    // renders as the placeholder supplies that content and is removed after.
    const anchor = ['ginko-list-item-anchor', {}] as ElementNode
    const anchored = [item[0], item[1], ...children.slice(0, leadingIndex), anchor, ...children.slice(leadingIndex)] as ElementNode
    const rendered = await defaults(state).li!(anchored, state, parent)
    const width = rendered.indexOf(placeholder)
    const indentation = ' '.repeat(width)
    const after = width + placeholder.length
    if (width < 0 || !rendered.startsWith(`\n${indentation}`, after)) return rendered
    // Inside a component, Comark finds the closing `::` by tracking fences
    // that start a line. Put a leading fence on its own line so that the
    // scan sees the opening fence as well as the closing one.
    if (inComponent && leading[0] === 'pre') return rendered.slice(0, width).trimEnd() + rendered.slice(after)
    return rendered.slice(0, width) + rendered.slice(after + 1 + width)
  }

  const anchor: NodeHandler = async () => placeholder

  // `- ---` is a thematic break, not a list item that contains one.
  const hr: NodeHandler = async (node, state, parent) => parent?.[0] === 'li'
    ? `***${state.context.blockSeparator}`
    : await defaults(state).hr!(node, state, parent)

  // Comark writes strikethrough from plain text content, which drops nested
  // formatting and escaping. Render the children like emphasis instead.
  const del: NodeHandler = async (node, state, parent) => {
    let content = ''
    for (const child of node.slice(2)) content += await state.one(child as ElementNode, state, node)
    const probe = await defaults(state).em!(['em', node[1], placeholder] as ElementNode, state, parent)
    const attributes = probe.startsWith(`*${placeholder}*`) ? probe.slice(placeholder.length + 2) : ''
    return `~~${content.trim()}~~${attributes}`
  }

  // A backslash hard break survives editors and block edges that strip
  // trailing spaces. Table cells cannot contain a line break, and a break at
  // the end of a block does not render.
  const br: NodeHandler = async (node, state, parent) => {
    if (parent?.[0] === 'td' || parent?.[0] === 'th') return await defaults(state).br!(node, state, parent)
    const following = parent ? parent.slice(parent.indexOf(node) + 1) : []
    return following.every(child => typeof child === 'string' && child.trim() === '') ? '' : '\\\n'
  }

  // The parser adds this class to every list with a task item, and Comark
  // otherwise writes it as a `::ol{...}` wrapper that reads as a component.
  const list = (tag: 'ul' | 'ol'): NodeHandler => async (node, state, parent) => {
    const { class: className, ...props } = node[1]
    const classes = typeof className === 'string'
      ? className.split(/\s+/).filter(name => name && name !== 'contains-task-list')
      : undefined
    const listProps = classes?.length ? { ...props, class: classes.join(' ') } : className === undefined || classes ? props : node[1]
    return await defaults(state)[tag]!([node[0], listProps, ...node.slice(2)] as ElementNode, state, parent)
  }

  return {
    'pre': pre,
    'code': code,
    'li': li,
    'hr': hr,
    'br': br,
    'del': del,
    'ul': list('ul'),
    'ol': list('ol'),
    'ginko-list-item-anchor': anchor,
  }
}

const listItemInComponentKey = (marker: string) => `${marker}list-item-in-component`

/**
 * Mark list items inside block components, in place. The list-item handler
 * then writes a leading code fence on its own line. Call it with the marker
 * passed to `createVerbatimHandlers`.
 */
export function markListItemsInComponents(nodes: unknown[], marker: string): void {
  const key = listItemInComponentKey(marker)
  const visit = (node: unknown, inComponent: boolean) => {
    if (!Array.isArray(node) || typeof node[0] !== 'string') return
    const props = node[1] as Record<string, unknown> | undefined
    const origin = props?.$ as { block?: unknown } | undefined
    if (inComponent && node[0] === 'li' && props) props[key] = 1
    const component = inComponent || origin?.block === 1 || node[0] === 'template'
    for (const child of node.slice(2)) visit(child, component)
  }
  for (const node of nodes) visit(node, false)
}
