import { describe, expect, test } from 'vitest'
import { normalizeMarkdownPluginOptions } from '../../packages/content/src/parsers/markdown-plugins'
import { processMarkdownOptions } from '../../packages/content/src/utils'

describe('markdown plugin normalization', () => {
  test('treats omitted and explicit-empty plugin lists identically', () => {
    const base = { tags: {}, anchorLinks: { depth: 4, exclude: [1] } }
    expect(processMarkdownOptions(base)).toEqual({ ...base, plugins: [] })
    expect(processMarkdownOptions({ ...base, plugins: [] })).toEqual({ ...base, plugins: [] })
    expect(processMarkdownOptions({ ...base, plugins: [['toc', { depth: 3 }]] })).toEqual({
      ...base,
      plugins: [{ name: 'toc', options: { depth: 3 } }],
    })
  })

  test('uses safe named themes for Shiki plugin defaults', () => {
    const normalized = normalizeMarkdownPluginOptions({
      name: 'shiki',
      options: { preStyles: false }
    }) as {
      preStyles: boolean
      registerDefaultThemes: boolean
      themes: {
        light: { name: string }
        dark: { name: string }
      }
    }

    expect(normalized.preStyles).toBe(false)
    expect(normalized.registerDefaultThemes).toBe(false)
    expect(normalized.themes.light.name).toBe('material-theme-lighter')
    expect(normalized.themes.dark.name).toBe('material-theme-palenight')
  })

  test('clones explicit Shiki theme objects before passing them to Shiki', () => {
    const lightTheme = Object.freeze({
      name: 'custom-light',
      settings: Object.freeze([
        Object.freeze({
          scope: ['keyword'],
          settings: Object.freeze({ foreground: '#111111' })
        })
      ])
    })
    const darkTheme = Object.freeze({
      name: 'custom-dark',
      settings: Object.freeze([
        Object.freeze({
          scope: ['string'],
          settings: Object.freeze({ foreground: '#eeeeee' })
        })
      ])
    })

    const normalized = normalizeMarkdownPluginOptions({
      name: 'shiki',
      options: {
        themes: {
          light: lightTheme,
          dark: darkTheme
        }
      }
    }) as {
      registerDefaultThemes: boolean
      themes: {
        light: typeof lightTheme
        dark: typeof darkTheme
      }
    }

    expect(normalized.registerDefaultThemes).toBe(false)
    expect(normalized.themes.light).toEqual(lightTheme)
    expect(normalized.themes.dark).toEqual(darkTheme)
    expect(normalized.themes.light).not.toBe(lightTheme)
    expect(normalized.themes.dark).not.toBe(darkTheme)
  })

  test('clones explicit Shiki language and transformer arrays before passing them to Comark', () => {
    const language = Object.freeze({
      name: 'custom-language',
      scopeName: 'source.custom',
      patterns: Object.freeze([])
    })
    const transformer = Object.freeze({
      name: 'custom-transformer',
      line() {
        return undefined
      }
    })
    const languages = Object.freeze([language])
    const transformers = Object.freeze([transformer])

    const normalized = normalizeMarkdownPluginOptions({
      name: 'shiki',
      options: {
        languages,
        transformers
      }
    }) as {
      languages: typeof languages
      transformers: typeof transformers
    }

    expect(normalized.languages).toEqual(languages)
    expect(normalized.transformers).toEqual(transformers)
    expect(normalized.languages).not.toBe(languages)
    expect(normalized.transformers).not.toBe(transformers)
    expect(normalized.transformers[0]!.line).toBe(transformer.line)
  })

  test.each([
    ['theme', { theme: 'github-dark' }, 'themes: { light, dark }'],
    ['langs', { langs: ['ts'] }, 'languages'],
  ])('rejects the invalid Shiki option %s with the canonical replacement', (_name, options, replacement) => {
    expect(() => normalizeMarkdownPluginOptions({ name: 'shiki', options })).toThrow(replacement)
  })

  test('leaves non-highlight plugin options untouched', () => {
    const options = { depth: 3 }

    expect(normalizeMarkdownPluginOptions({
      name: 'toc',
      options
    })).toBe(options)
  })
})
