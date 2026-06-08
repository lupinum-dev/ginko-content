import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'

const packageSrc = join(process.cwd(), 'packages/content/src')

const collectTypeScriptFiles = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      return collectTypeScriptFiles(path)
    }
    return entry.isFile() && path.endsWith('.ts') ? [path] : []
  }))

  return files.flat()
}

const importPattern = /\bimport(?:\s+type)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g

const collectImports = async (directories: string[]) => {
  const imports: Array<{ file: string, specifier: string }> = []
  for (const directory of directories) {
    for (const file of await collectTypeScriptFiles(join(packageSrc, directory))) {
      const source = await readFile(file, 'utf8')
      for (const match of source.matchAll(importPattern)) {
        imports.push({
          file: relative(process.cwd(), file),
          specifier: match[1] || match[2]
        })
      }
    }
  }
  return imports
}

describe('architecture boundary contracts', () => {
  test('runtime-neutral library layers do not import Nuxt, Nitro, Vue, H3, or app/runtime/module code', async () => {
    const imports = await collectImports(['core', 'features', 'cms-contract', 'cms-import'])
    const forbidden = imports.filter(({ specifier }) =>
      /^(@nuxt|nuxt|nitro|h3|vue|@vue|#)/.test(specifier) ||
      /^(\.\.\/)+(runtime|module|integrations|public|cli)(\/|$)/.test(specifier)
    )

    expect(forbidden).toEqual([])
  })

  test('storage remains a storage bridge and does not import runtime, module, public, or cli layers', async () => {
    const imports = await collectImports(['storage'])
    const forbidden = imports.filter(({ specifier }) =>
      specifier.startsWith('#') ||
      /^(\.\.\/)+(runtime|module|public|cli)(\/|$)/.test(specifier)
    )

    expect(forbidden).toEqual([])
  })

  test('storage validation stays framework-free', async () => {
    const imports = (await collectImports(['storage'])).filter(({ file }) =>
      file.endsWith('packages/content/src/storage/validation.ts')
    )
    const forbidden = imports.filter(({ specifier }) =>
      /^(@nuxt|nuxt|nitro|h3|vue|@vue|#)/.test(specifier) ||
      /^(\.\.\/)+(runtime|module|integrations|public|cli)(\/|$)/.test(specifier)
    )

    expect(forbidden).toEqual([])
  })
})
