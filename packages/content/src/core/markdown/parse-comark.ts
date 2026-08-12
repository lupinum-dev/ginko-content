import { createMarkdownParser, defineComarkPlugin, parseFrontmatter } from 'comark'
import type { ComarkPlugin } from 'comark'

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
) => createMarkdownParser({
  plugins: [typedComponentFrontmatter(), ...plugins],
})

// CMS, portability, and inline rendering all use this fixed safe profile. A
// single immutable parser avoids recompiling Comark's default plugin pipeline
// for every document without introducing a mutable process-wide profile.
const baselineComarkParser = createComarkParser()

/** The fixed-profile Comark entry point used by baseline parsing boundaries. */
export const parseComark = async (markdown: string) => await baselineComarkParser(markdown)
