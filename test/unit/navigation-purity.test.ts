import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, test } from 'vitest'

const files = [
  'packages/content/src/public/navigation.ts',
  'packages/content/src/features/navigation/resolve.ts'
]

const forbiddenImports = new Set([
  '#imports',
  '#app',
  'h3',
  'nitropack',
  'nitropack/runtime',
  'nuxt',
  '@nuxt/kit',
  '@nuxt/schema',
  'vue'
])

const collectForbiddenImports = (file: string) => {
  const source = readFileSync(file, 'utf8')
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const imports: string[] = []
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      forbiddenImports.has(node.moduleSpecifier.text)
    ) {
      imports.push(node.moduleSpecifier.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return imports
}

describe('@lupinum/ginko-content/navigation purity', () => {
  test('does not import Nuxt, Nitro, H3, Vue, or app aliases', () => {
    for (const file of files) {
      expect(collectForbiddenImports(file), `${file} has forbidden imports`).toEqual([])
    }
  })
})
