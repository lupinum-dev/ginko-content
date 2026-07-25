import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, test } from 'vitest'

const sourceRoot = 'packages/content/src'

const sourceFiles = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return await sourceFiles(path)
    return /\.(?:ts|mts|vue)$/.test(entry.name) ? [path] : []
  }))
  return nested.flat()
}

const importSpecifiers = (source: string, file: string): string[] => {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const specifiers: string[] = []
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text)
    }
    if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return specifiers
}

const importsFrom = async (dir: string, isForbidden: (specifier: string) => boolean) => {
  const files = await sourceFiles(join(sourceRoot, dir))
  const offenders: string[] = []
  for (const file of files) {
    const source = await readFile(file, 'utf8')
    if (importSpecifiers(source, file).some(isForbidden)) {
      offenders.push(relative(process.cwd(), file))
    }
  }
  return offenders
}

const importsSourceSegment = (segment: 'runtime' | 'features') => (specifier: string) =>
  specifier.includes(`/${segment}/`)

const importsRuntimeFramework = (specifier: string) =>
  specifier === '#imports'
  || specifier === 'vue'
  || specifier === 'vue-router'
  || specifier === 'h3'
  || specifier.startsWith('@nuxt/')
  || specifier.startsWith('nitropack/')

describe('architecture boundaries', () => {
  test('core does not import runtime modules', async () => {
    await expect(importsFrom('core', importsSourceSegment('runtime'))).resolves.toEqual([])
  })

  test('core does not import feature modules', async () => {
    await expect(importsFrom('core', importsSourceSegment('features'))).resolves.toEqual([])
  })

  test('features do not import runtime modules', async () => {
    await expect(importsFrom('features', importsSourceSegment('runtime'))).resolves.toEqual([])
  })

  test('storage does not import runtime modules', async () => {
    await expect(importsFrom('storage', importsSourceSegment('runtime'))).resolves.toEqual([])
  })

  test('core does not import runtime framework modules', async () => {
    await expect(importsFrom('core', importsRuntimeFramework)).resolves.toEqual([])
  })

  test('features do not import runtime framework modules', async () => {
    await expect(importsFrom('features', importsRuntimeFramework)).resolves.toEqual([])
  })

  test('portable read, write, manifest, wire, and image boundaries share one limit policy', async () => {
    const files = [
      'packages/content/src/cms-contract/asset-bytes.ts',
      'packages/content/src/cms-contract/provider-wire.ts',
      'packages/content/src/portability/manifest.ts',
      'packages/content/src/portability-node/read-directory.ts',
      'packages/content/src/portability-node/write-directory.ts',
    ]
    const sources = await Promise.all(files.map(file => readFile(file, 'utf8')))

    expect(sources.every(source => source.includes('PORTABLE_CONTENT_LIMITS'))).toBe(true)
    expect(sources.some(source => source.includes('25 * 1024 * 1024'))).toBe(false)
  })
})
