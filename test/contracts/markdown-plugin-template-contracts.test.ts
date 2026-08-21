import { describe, expect, test, vi } from 'vitest'
import {
  createMarkdownPluginTemplates,
  resolveMarkdownPluginRegistry,
  validateCanonicalMarkdownPlugins,
  withMarkdownPluginComponentPolicy,
} from '../../packages/content/src/module/markdown-plugin-templates'

const plugin = (name: string) => ({ name, options: {} })

describe('generated Markdown plugin registry', () => {
  test('rejects the removed highlight alias', () => {
    expect(() => validateCanonicalMarkdownPlugins([
      { name: 'highlight', options: { preStyles: false } }
    ])).toThrow('was removed')

    expect(validateCanonicalMarkdownPlugins([plugin('shiki')])).toEqual([plugin('shiki')])
  })

  test('resolves the canonical Shiki plugin and peer without importing the deprecated Comark alias', async () => {
    const appResolutions: string[] = []
    const moduleResolutions: string[] = []
    const registry = await resolveMarkdownPluginRegistry([plugin('shiki')], {
      resolveAppPath: vi.fn(async (specifier) => {
        appResolutions.push(specifier)
        return `/app/${specifier}`
      }),
      resolveModulePath: vi.fn(async (specifier) => {
        moduleResolutions.push(specifier)
        return `/package/${specifier}.mjs`
      })
    })

    expect(appResolutions).toEqual(['shiki'])
    expect(moduleResolutions).toEqual(['comark/plugins/shiki'])
    expect(registry).toEqual([{ name: 'shiki', parserPath: '/package/comark/plugins/shiki.mjs' }])
  })

  test('emits literal parser and renderer imports without exposing custom plugins to the client', async () => {
    const appResolutions: string[] = []
    const registry = await resolveMarkdownPluginRegistry(
      [plugin('math'), plugin('~/server/custom-markdown')],
      {
        resolveAppPath: vi.fn(async (specifier) => {
          appResolutions.push(specifier)
          return `/app/${specifier.replace('~/', '')}.mjs`
        }),
        resolveModulePath: vi.fn(async specifier => `/package/${specifier}.mjs`),
      },
    )
    const templates: Array<{ filename: string; getContents: () => string }> = []
    const addTemplate = vi.fn((template: { filename: string; getContents: () => string }) => {
      templates.push(template)
      return { dst: `/generated/${template.filename}` }
    })

    const result = createMarkdownPluginTemplates(registry, addTemplate as never)
    const parser = templates.find(template => template.filename.includes('parser'))!.getContents()
    const renderer = templates.find(template => template.filename.includes('renderer'))!.getContents()

    expect(result).toEqual({
      parserTemplate: '/generated/content/virtual-markdown-parser-plugins.mjs',
      rendererTemplate: '/generated/content/virtual-markdown-renderer-components.mjs',
    })
    expect(appResolutions).toEqual(['katex', '~/server/custom-markdown'])
    expect(registry[0]?.renderer?.componentPolicy).toMatchObject({ kind: 'inline' })
    expect(parser).toContain('import * as plugin0 from "/package/comark/plugins/math.mjs"')
    expect(parser).toContain('import * as plugin1 from "/app/server/custom-markdown.mjs"')
    expect(renderer).toContain('import("@comark/vue/plugins/math")')
    expect(renderer).not.toContain('custom-markdown')
    expect(`${parser}\n${renderer}`).not.toContain('@vite-ignore')
  })

  test('fails setup when an enabled optional peer is absent', async () => {
    await expect(resolveMarkdownPluginRegistry([plugin('mermaid')], {
      resolveAppPath: vi.fn(async () => { throw new Error('missing') }),
      resolveModulePath: vi.fn(async specifier => specifier),
    })).rejects.toThrow('requires "beautiful-mermaid" to be installed in the Nuxt application')
  })

  test('emits an empty client registry and reserves policies only for enabled companions', async () => {
    const registry = await resolveMarkdownPluginRegistry([plugin('toc')], {
      resolveAppPath: vi.fn(async specifier => specifier),
      resolveModulePath: vi.fn(async specifier => specifier),
    })
    const templates: Array<{ filename: string; getContents: () => string }> = []
    createMarkdownPluginTemplates(registry, ((template: { filename: string; getContents: () => string }) => {
      templates.push(template)
      return { dst: template.filename }
    }) as never)

    expect(templates.find(template => template.filename.includes('renderer'))!.getContents())
      .toBe('export const markdownRendererComponents = {}\nexport default {}')
    expect(withMarkdownPluginComponentPolicy(undefined, registry)).toEqual({ components: {} })
  })
})
