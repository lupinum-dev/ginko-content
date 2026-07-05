import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { createVirtualContentTemplates } from '../../packages/content/src/module/virtual'
import { loadContentConfig, resolveContentConfigPath } from '../../packages/content/src/utils/content-config'

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
  test('loads content config with extensionless TypeScript imports during setup', async () => {
    const tmpDir = await mkdtemp(join(process.cwd(), '.tmp-ginko-content-config-'))

    try {
      await writeFile(join(tmpDir, 'helper.ts'), 'export const source = "**/*.md"\n')
      await writeFile(join(tmpDir, 'content.config.ts'), [
        'import { source } from "./helper"',
        'export default { collections: { docs: { type: "page", source } } }'
      ].join('\n'))

      const nuxt = {
        options: {
          rootDir: tmpDir
        }
      } as any

      expect(resolveContentConfigPath(nuxt)).toBe(join(tmpDir, 'content.config.ts'))
      const config = await loadContentConfig(nuxt)

      expect(config.collections?.docs?.source).toBe('**/*.md')
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('generates a virtual config import for the authored content config', () => {
    const { addTemplate, templates } = createAddTemplate()

    createVirtualContentTemplates(
      {
        transformers: [],
        providers: {}
      } as any,
      createNuxt() as any,
      '/workspace/app/content.config.ts',
      addTemplate
    )

    const contents = templates.get('content/virtual-config.mjs')?.()

    expect(contents).toBe([
      'import config from "/workspace/app/content.config.ts"',
      'export default config'
    ].join('\n'))
    expect(contents).not.toContain('jiti')
  })

  test('keeps the virtual config inert when no content config exists', () => {
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

    const contents = templates.get('content/virtual-config.mjs')?.()

    expect(contents).toBe('export default {}')
    expect(contents).not.toContain('content.config')
    expect(contents).not.toContain('jiti')
  })

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
