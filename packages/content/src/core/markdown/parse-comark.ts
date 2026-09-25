import { createMarkdownParser, defineComarkPlugin, parseFrontmatter } from 'comark'
import type { ComarkPlugin } from 'comark'
import { angleComponents } from './angle-components.js'
import { autoCloseMarkdownOutsideCode } from './auto-close.js'

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

/**
 * Whether Comark reads an attribute string as JSON. It parses any value that
 * starts with `[` and ends with `]`, or starts with `{` and ends with `}`.
 */
export const readsAsJson = (value: unknown): boolean => {
  if (typeof value !== 'string') return false
  if (!((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']')))) return false
  try {
    JSON.parse(value)
    return true
  } catch {
    return false
  }
}

/**
 * Comark currently stringifies component-frontmatter scalar attributes before
 * AST conversion and then treats the string "true" as a Vue binding. Restore
 * the YAML values at the parser-token boundary, where the component token and
 * its exact source span are still available.
 */
const typedComponentFrontmatter = defineComarkPlugin(() => ({
  name: 'ginko-typed-component-frontmatter',
  markdownItPlugins: [
    (markdown) => {
      markdown.core.ruler.after('block', 'ginko_typed_component_frontmatter', (state: ComponentTokenState) => {
        const lines = state.src.split(/\r?\n/)

        for (const token of state.tokens) {
          if (token.type !== 'mdc_block_open' || !token.map) continue

          const [startLine, endLine] = token.map
          const fence = lines[startLine + 1]
          if (fence?.trim() !== '---') continue

          // Nested components are indented; read their YAML without that indentation.
          const indentation = fence.slice(0, fence.length - fence.trimStart().length)
          const parsed = parseFrontmatter(lines.slice(startLine + 1, endLine)
            .map(line => line.startsWith(indentation) ? line.slice(indentation.length) : line)
            .join('\n'))
          if (!parsed.frontmatterText) continue

          const yamlEntries = Object.entries(parsed.data)
          const yamlKeys = new Set(yamlEntries.map(([key]) => key))
          // Comark later reads every attribute string that starts with `[` or
          // `{` as JSON. Keep YAML strings such as `title: "[1, 2]"` in a
          // marker object, whose strings Comark leaves alone, and restore them.
          const strings = Object.fromEntries(yamlEntries.filter(([, value]) => readsAsJson(value)))
          token.attrs = [
            ...(token.attrs ?? []).filter(([key]) => !yamlKeys.has(key) && key !== YAML_STRINGS),
            ...yamlEntries,
            ...(Object.keys(strings).length > 0 ? [[YAML_STRINGS, JSON.stringify(strings)] as [string, string]] : []),
          ]
        }
      })
    },
  ],
  post: ({ tree }) => {
    const restore = (node: unknown): void => {
      if (!Array.isArray(node) || node[0] === null) return
      const { [YAML_STRINGS]: strings, ...props } = (node[1] ?? {}) as Record<string, unknown>
      if (strings && typeof strings === 'object' && !Array.isArray(strings)) {
        // Replace the values in place, so the property order stays authored.
        node[1] = Object.fromEntries(Object.entries(props).map(([key, value]) =>
          [key, Object.prototype.hasOwnProperty.call(strings, key) ? (strings as Record<string, unknown>)[key] : value]))
      }
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
    plugins: [
      angleComponents({ autoClose }),
      ...(options.portable ? [explicitLinkify()] : []),
      legacyCssCustomProps(),
      typedComponentFrontmatter(),
      componentSyntaxMetadata(),
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
