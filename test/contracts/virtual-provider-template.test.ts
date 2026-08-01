import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { createVirtualContentTemplates } from '../../packages/content/src/module/virtual'
import { loadContentConfig, resolveContentConfigPath } from '../../packages/content/src/utils/content-config'

const toNuxtPath = (path: string) => path.replaceAll('\\', '/')

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
  test.each([
    {
      format: 'TypeScript with an extensionless import',
      configFile: 'content.config.ts',
      helperFile: 'helper.ts',
      helperImport: './helper',
      configSyntax: 'esm',
      helperSyntax: 'esm',
      preloadHelper: false
    },
    {
      format: 'native ESM',
      configFile: 'content.config.mjs',
      helperFile: 'helper.mjs',
      helperImport: './helper.mjs',
      configSyntax: 'esm',
      helperSyntax: 'esm',
      preloadHelper: false
    },
    {
      format: 'CommonJS',
      configFile: 'content.config.cjs',
      helperFile: 'helper.cjs',
      helperImport: './helper.cjs',
      configSyntax: 'cjs',
      helperSyntax: 'cjs',
      preloadHelper: false
    },
    {
      format: 'TypeScript with a CommonJS helper',
      configFile: 'content.config.ts',
      helperFile: 'helper.cjs',
      helperImport: './helper.cjs',
      configSyntax: 'esm',
      helperSyntax: 'cjs',
      preloadHelper: true
    }
  ] as const)('reloads $format config modules during setup', async ({ configFile, helperFile, helperImport, configSyntax, helperSyntax, preloadHelper }) => {
    const tmpDir = await mkdtemp(join(process.cwd(), '.tmp-ginko-content-config-'))

    try {
      const helperSource = (source: string) => helperSyntax === 'esm'
        ? `export const source = "${source}"\n`
        : `exports.source = "${source}"\n`
      const configSource = configSyntax === 'esm'
        ? [
            `import { source } from "${helperImport}"`,
            'export default { collections: { docs: { type: "page", source } } }'
          ].join('\n')
        : [
            `const { source } = require("${helperImport}")`,
            'module.exports = { collections: { docs: { type: "page", source } } }'
          ].join('\n')

      await writeFile(join(tmpDir, helperFile), helperSource('**/*.md'))
      await writeFile(join(tmpDir, configFile), configSource)
      if (preloadHelper) {
        createRequire(join(tmpDir, 'preload.cjs'))(join(tmpDir, helperFile))
      }

      const nuxt = {
        options: {
          rootDir: tmpDir
        }
      } as any

      expect(resolveContentConfigPath(nuxt)).toBe(toNuxtPath(join(tmpDir, configFile)))
      const config = await loadContentConfig(nuxt)

      expect(config.collections?.docs?.source).toBe('**/*.md')

      await writeFile(join(tmpDir, helperFile), helperSource('docs/**/*.md'))
      const reloadedConfig = await loadContentConfig(nuxt)

      expect(reloadedConfig.collections?.docs?.source).toBe('docs/**/*.md')
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

  test('does not import an external provider unless a module registered it', () => {
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
    expect(contents).not.toContain('import * as provider0')
    expect(contents).not.toContain('resolveProviderModule(provider0)')
  })

  test('imports only explicitly registered external providers', () => {
    const { addTemplate, templates } = createAddTemplate()

    createVirtualContentTemplates(
      {
        transformers: [],
        providers: {
          remote: '~/providers/remote',
          preview: '~/providers/preview'
        }
      } as any,
      createNuxt() as any,
      undefined,
      addTemplate
    )

    const contents = templates.get('content/virtual-providers.mjs')?.()

    expect(contents).toContain('externalContentProviderNames = ["remote","preview"]')
    expect(contents).toContain('import * as provider0 from "~/providers/remote"')
    expect(contents).toContain('import * as provider1 from "~/providers/preview"')
    expect(contents).toContain('"remote": resolveProviderModule(provider0)')
    expect(contents).toContain('"preview": resolveProviderModule(provider1)')
  })
})
