import { describe, expect, test } from 'vitest'

import { createVirtualContentTemplates } from '../../packages/content/src/module/virtual'

const createNuxt = () => ({
  options: {
    rootDir: '/workspace/app'
  }
})

const createAddTemplate = () => {
  const templates = new Map<string, () => string>()
  const addTemplate = ((options: { filename: string, getContents: () => string }) => {
    templates.set(options.filename, options.getContents)
    return { dst: `/workspace/.nuxt/${options.filename}` }
  }) as any

  return { addTemplate, templates }
}

describe('virtual provider template contract', () => {
  test('does not import the CMS provider unless a module registered it', () => {
    const { addTemplate, templates } = createAddTemplate()

    createVirtualContentTemplates(
      {
        transformers: [],
        providers: {}
      } as any,
      createNuxt() as any,
      undefined,
      addTemplate
    )

    const contents = templates.get('content/virtual-providers.mjs')?.()

    expect(contents).toContain('externalContentProviderNames = []')
    expect(contents).not.toContain('@lupinum/ginko-cms/nuxt-provider')
    expect(contents).not.toContain('case "ginko"')
    expect(contents).not.toContain('case "cms"')
  })

  test('imports only explicitly registered external providers', () => {
    const { addTemplate, templates } = createAddTemplate()

    createVirtualContentTemplates(
      {
        transformers: [],
        providers: {
          cms: '@lupinum/ginko-cms/nuxt-provider',
          preview: '~/providers/preview'
        }
      } as any,
      createNuxt() as any,
      undefined,
      addTemplate
    )

    const contents = templates.get('content/virtual-providers.mjs')?.()

    expect(contents).toContain('externalContentProviderNames = ["cms","preview"]')
    expect(contents).toContain('case "cms": return import("@lupinum/ginko-cms/nuxt-provider")')
    expect(contents).toContain('case "preview": return import("~/providers/preview")')
    expect(contents).not.toContain('case "ginko"')
  })
})
