import { createMarkdownParser, defineComarkPlugin, parseFrontmatter } from 'comark'
import type { ComarkPlugin } from 'comark'
import { resolveHeadingAnchors, markdownHeadingLevel, headingSlugText, type HeadingDescriptor } from './heading-id.js'
import { angleComponents } from './angle-components.js'
import { autoCloseMarkdownOutsideCode } from './auto-close.js'
import { jsonLikeStrings, readsAsJson, restoreStrings } from './json-attribute.js'

export { readsAsJson }

type ComponentTokenState = {
  src: string
  Token: new (type: string, tag: string, nesting: number) => ComponentToken
  tokens: ComponentToken[]
}

type ComponentToken = {
  type: string
  tag: string
  nesting: number
  map: [number, number] | null
  hidden: boolean
  children: ComponentToken[] | null
  /**
   * Markdown parsers declare attribute values as strings. These plugins
   * deliberately attach JSON values Comark's converter already accepts.
   */
  attrs: Array<[string, unknown]> | null
  attrSet: (name: string, value: unknown) => void
}

type LegacyPropsInlineState = {
  src: string
  pos: number
  push: (type: string, tag: string, nesting: number) => {
    attrs: Array<[string, string]> | null
    hidden: boolean
  }
}

/** Preserve the legacy CSS-custom-property attribute spelling used by CMS documents. */
const legacyCssCustomProps = defineComarkPlugin(() => ({
  name: 'ginko-legacy-css-custom-props',
  markdownItPlugins: [
    (markdown) => {
      markdown.inline.ruler.before('text', 'ginko_legacy_css_custom_props', (state: LegacyPropsInlineState, silent: boolean) => {
        if (state.src[state.pos] !== '{') return false
        const match = /^\{\s*(--[a-z][a-z0-9-]*)\s*=\s*(["'])(.*?)\2\s*\}/i.exec(state.src.slice(state.pos))
        if (!match) return false
        if (silent) return true
        const token = state.push('mdc_inline_props', 'span', 0)
        token.attrs = [[match[1], match[3]]]
        token.hidden = true
        state.pos += match[0].length
        return true
      })
    },
  ],
}))

// A private-use key that authored attributes cannot contain.
const YAML_STRINGS = '\uE000ginko-yaml-strings'

type BlockState = {
  src: string
  bMarks: number[]
  eMarks: number[]
  tShift: number[]
  sCount: number[]
  blkIndent: number
  line: number
  env: { comarkBlockTokens?: ComponentToken[] }
}

// Opening fences of a component property block and their closing fences.
const PROPERTY_BLOCK_FENCES: Record<string, string> = {
  '---': '---',
  '```yaml [props]': '```',
  '~~~yaml [props]': '~~~',
  '```yml [props]': '```',
  '~~~yml [props]': '~~~',
}

/**
 * Read a block component's property block before Comark's rule does.
 *
 * Comark slices the YAML from the source across lines, so inside a blockquote
 * every line after the first keeps its `>` prefix. It also turns every value
 * into a string. This rule reads each line after its container prefix and
 * indentation. A `---` block keeps the YAML types; the code-block form keeps
 * Comark's string values. A YAML string that Comark would read as JSON, such
 * as `title: "[1, 2]"`, is kept in a marker and restored after parsing.
 */
const typedComponentFrontmatter = defineComarkPlugin(() => ({
  name: 'ginko-typed-component-frontmatter',
  markdownItPlugins: [
    (markdown) => {
      const rule = (state: BlockState, startLine: number, endLine: number, silent: boolean): boolean => {
        const component = state.env.comarkBlockTokens?.[0]
        if (!component || state.sCount[startLine]! - state.blkIndent >= 4) return false
        const indent = state.tShift[startLine]!
        const line = state.src.slice(state.bMarks[startLine]! + indent, state.eMarks[startLine])
        const closingFence = PROPERTY_BLOCK_FENCES[line]
        if (!closingFence) return false
        // The `---` fence is only valid directly after the component opener.
        if (line === '---' && (component.map?.[0] === undefined || startLine !== component.map[0] + 1)) return false
        let lineEnd = startLine + 1
        // Remove the container prefix (`bMarks`) and the fence indentation.
        const content = (index: number) => {
          const text = state.src.slice(state.bMarks[index], state.eMarks[index])
          return text.slice(Math.min(indent, text.length - text.trimStart().length))
        }
        while (lineEnd < endLine && content(lineEnd) !== closingFence) lineEnd += 1
        if (lineEnd >= endLine) return false
        if (!silent) {
          const yaml = Array.from({ length: lineEnd - startLine - 1 }, (_, offset) => content(startLine + 1 + offset)).join('\n')
          const data = yaml.trim() ? parseFrontmatter(`---\n${yaml}\n---`).data : {}
          const typed = line === '---'
          const strings = jsonLikeStrings(Object.entries(data))
          for (const [key, value] of Object.entries(data)) {
            const attribute = typed || typeof value === 'string' ? value : JSON.stringify(value)
            if (key === 'class' && typeof attribute === 'string') {
              const current = component.attrs?.find(([name]) => name === 'class')?.[1]
              component.attrSet(key, typeof current === 'string' && current ? `${current} ${attribute}` : attribute)
            } else {
              component.attrSet(key, attribute)
            }
          }
          if (Object.keys(strings).length > 0) component.attrSet(YAML_STRINGS, JSON.stringify(strings))
        }
        state.line = lineEnd + 1
        return true
      }
      // Comark registers its rule later, after `code`. This rule runs first
      // and leaves indented code to the `code` rule, as Comark's order does.
      ;(markdown as unknown as { block: { ruler: { before: (name: string, id: string, fn: typeof rule) => void } } })
        .block.ruler.before('code', 'ginko_component_property_block', rule)
    },
  ],
  post: ({ tree }) => {
    const restore = (node: unknown): void => {
      if (!Array.isArray(node) || node[0] === null) return
      const { [YAML_STRINGS]: strings, ...props } = (node[1] ?? {}) as Record<string, unknown>
      if (strings !== undefined) node[1] = restoreStrings(props, strings)
      for (const child of node.slice(2)) restore(child)
    }
    for (const node of tree.nodes) restore(node)
  },
}))

const componentSyntaxMetadata = defineComarkPlugin(() => ({
  name: 'ginko-component-syntax-metadata',
  markdownItPlugins: [
    (markdown) => {
      markdown.core.ruler.after('inline', 'ginko_component_syntax_metadata', (state: ComponentTokenState) => {
        const metadata = (token: ComponentToken, block: 0 | 1) => ({
          syntax: 'colon',
          block,
          sourceName: token.tag,
        })
        const annotateInline = (tokens: ComponentToken[]) => {
          const stack: ComponentToken[] = []
          for (let index = 0; index < tokens.length; index++) {
            const token = tokens[index]!
            if (token.type !== 'mdc_inline_component') continue
            if (token.nesting === 1) {
              stack.push(token)
              continue
            }
            if (token.nesting === 0) {
              if (token.tag === 'input') continue
              token.attrSet('$', metadata(token, 0))
              continue
            }
            const opening = stack.pop()
            if (!opening) continue
            const existingProps = tokens[index + 1]
            if (existingProps?.type === 'mdc_inline_props') {
              existingProps.attrSet('$', metadata(opening, 0))
              continue
            }
            const props = new state.Token('mdc_inline_props', 'span', 0)
            props.hidden = true
            props.attrSet('$', metadata(opening, 0))
            tokens.splice(index + 1, 0, props)
            index++
          }
        }

        for (const token of state.tokens) {
          if (token.type === 'mdc_block_open') token.attrSet('$', metadata(token, 1))
          if (token.type === 'mdc_block_shorthand') token.attrSet('$', metadata(token, 0))
          if (token.type === 'inline' && token.children) annotateInline(token.children)
        }
      })
    },
  ],
}))

/**
 * The portable profile links only URLs with an explicit `http:`, `https:`, or
 * `mailto:` scheme. Bare domains, email addresses, IP addresses,
 * protocol-relative `//host` URLs, and `ftp:` URLs stay text, so editable
 * source keeps its meaning and never becomes a link that validation rejects.
 * Site content keeps Comark's default link recognition.
 */
const explicitLinkify = defineComarkPlugin(() => ({
  name: 'ginko-explicit-linkify',
  markdownItPlugins: [
    (markdown) => {
      const linkify = (markdown as unknown as {
        linkify: {
          set: (options: Record<string, boolean>) => unknown
          add: (schema: string, definition: null) => unknown
        }
      }).linkify
      linkify.set({ fuzzyLink: false, fuzzyEmail: false, fuzzyIP: false })
      linkify.add('//', null)
      linkify.add('ftp:', null)
    },
  ],
}))

const headingAnchors = defineComarkPlugin(() => ({
  name: 'ginko-heading-anchors',
  post: ({ tree }) => {
    const headings: Array<{ props: Record<string, unknown>, descriptor: HeadingDescriptor }> = []
    const occupied: string[] = []
    const visit = (node: unknown): void => {
      if (!Array.isArray(node) || typeof node[0] !== 'string') return
      const props = node[1] as Record<string, unknown>
      const level = markdownHeadingLevel(node[0], props)
      const id = typeof props.id === 'string' ? props.id : undefined
      if (level) headings.push({ props, descriptor: { text: headingSlugText(node.slice(2)), level: Number(level), ...(id !== undefined ? { id } : {}) } })
      else if (id !== undefined) occupied.push(id)
      for (const child of node.slice(2)) visit(child)
    }
    for (const node of tree.nodes) visit(node)
    const anchors = resolveHeadingAnchors(headings.map(heading => heading.descriptor), occupied)
    headings.forEach((heading, index) => { heading.props.id = anchors[index]!.id })
  },
}))

export type ComarkParser = ReturnType<typeof createMarkdownParser>

export interface ComarkParserOptions {
  /** Complete incomplete Markdown and component delimiters. Default `true`. */
  autoClose?: boolean
  /** Use the portable CMS-contract link recognition. Default `false`. */
  portable?: boolean
}

/** Create one parser for one resolved plugin-profile lifecycle. */
export const createComarkParser = (
  plugins: readonly ComarkPlugin[] = [],
  options: ComarkParserOptions = {},
): ComarkParser => {
  const autoClose = options.autoClose !== false
  // Comark's own completion ignores code fences. Complete the source here with
  // a code-aware pass and keep Comark's pass disabled.
  const parse = createMarkdownParser({
    autoClose: false,
    headingIds: false,
    plugins: [
      angleComponents({ autoClose }),
      ...(options.portable ? [explicitLinkify()] : []),
      legacyCssCustomProps(),
      typedComponentFrontmatter(),
      componentSyntaxMetadata(),
      headingAnchors(),
      ...plugins,
    ],
  })
  return autoClose
    ? (markdown, parseOptions) => parse(autoCloseMarkdownOutsideCode(markdown), parseOptions)
    : parse
}

// Baseline parsers are immutable, so one instance per profile avoids
// recompiling Comark's plugin pipeline for every document without a mutable
// process-wide profile. The portable profile serves CMS and portability
// boundaries; the site profile serves filesystem and inline rendering.
const parsers = {
  site: createComarkParser(),
  siteStrict: createComarkParser([], { autoClose: false }),
  portable: createComarkParser([], { portable: true }),
  portableStrict: createComarkParser([], { autoClose: false, portable: true }),
}

export type ParseComarkOptions = ComarkParserOptions

/** The fixed-profile Comark entry point used by baseline parsing boundaries. */
export const parseComark = async (
  markdown: string,
  options: ParseComarkOptions = {},
) => {
  const strict = options.autoClose === false
  const parser = options.portable
    ? strict ? parsers.portableStrict : parsers.portable
    : strict ? parsers.siteStrict : parsers.site
  return await parser(markdown)
}
