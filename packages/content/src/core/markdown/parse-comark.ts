import { createMarkdownParser, defineComarkPlugin, parseFrontmatter } from 'comark'
import type { ComarkPlugin, ParserOptions } from 'comark'
import { angleComponents } from './angle-components.js'

type ComponentTokenState = {
  src: string
  tokens: Array<{
    type: string
    map: [number, number] | null
    /**
     * Markdown parsers declare attribute values as strings. This plugin
     * deliberately restores the JSON value Comark's converter already accepts.
     */
    attrs: Array<[string, unknown]> | null
  }>
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
          if (lines[startLine + 1]?.trim() !== '---') continue

          const parsed = parseFrontmatter(lines.slice(startLine + 1, endLine).join('\n'))
          if (!parsed.frontmatterText) continue

          const yamlEntries = Object.entries(parsed.data)
          const yamlKeys = new Set(yamlEntries.map(([key]) => key))
          token.attrs = [
            ...(token.attrs ?? []).filter(([key]) => !yamlKeys.has(key)),
            ...yamlEntries,
          ]
        }
      })
    },
  ],
}))

export type ComarkParser = ReturnType<typeof createMarkdownParser>

/** Create one parser for one resolved plugin-profile lifecycle. */
export const createComarkParser = (
  plugins: readonly ComarkPlugin[] = [],
  options: Pick<ParserOptions, 'autoClose'> = {},
) => createMarkdownParser({
  ...options,
  plugins: [
    angleComponents({ autoClose: options.autoClose !== false }),
    legacyCssCustomProps(),
    typedComponentFrontmatter(),
    ...plugins,
  ],
})

// CMS, portability, and inline rendering all use this fixed safe profile. A
// single immutable parser avoids recompiling Comark's default plugin pipeline
// for every document without introducing a mutable process-wide profile.
const baselineComarkParser = createComarkParser()
const strictBaselineComarkParser = createComarkParser([], { autoClose: false })

export interface ParseComarkOptions {
  /** Complete incomplete Markdown and component delimiters. Default `true`. */
  autoClose?: boolean
}

/** The fixed-profile Comark entry point used by baseline parsing boundaries. */
export const parseComark = async (
  markdown: string,
  options: ParseComarkOptions = {},
) => await (options.autoClose === false ? strictBaselineComarkParser : baselineComarkParser)(markdown)
