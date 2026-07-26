import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
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

const collectModuleSpecifiers = (file: string): string[] => {
  const source = readFileSync(file, 'utf8')
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const specifiers: string[] = []
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text)
    }
    if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteralLike(node.arguments[0]!)
    ) {
      specifiers.push(node.arguments[0]!.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return specifiers
}

const collectBuiltImportGraph = (entry: string) => {
  const files = new Set<string>()
  const externalImports = new Set<string>()
  const pending = [resolve(entry)]

  while (pending.length) {
    const file = pending.pop()!
    if (files.has(file)) continue
    files.add(file)

    for (const specifier of collectModuleSpecifiers(file)) {
      if (specifier.startsWith('.')) {
        pending.push(resolve(dirname(file), specifier))
      } else {
        externalImports.add(specifier)
      }
    }
  }

  return { files: [...files], externalImports: [...externalImports] }
}

describe('@lupinum/ginko-content/navigation purity', () => {
  test('does not import Nuxt, Nitro, H3, Vue, or app aliases', () => {
    for (const file of files) {
      expect(collectForbiddenImports(file), `${file} has forbidden imports`).toEqual([])
    }
  })

  test('built navigation entry has a runtime-free transitive import graph', () => {
    const graph = collectBuiltImportGraph('packages/content/dist/public/navigation.js')

    expect(graph.files.some(file => file.includes('/runtime/'))).toBe(false)
    expect(graph.files.some(file => file.includes('/integrations/'))).toBe(false)
    expect(graph.externalImports.filter(specifier =>
      forbiddenImports.has(specifier)
      || specifier.startsWith('nuxt/')
      || specifier.startsWith('nitropack/')
      || specifier.startsWith('vue/')
    )).toEqual([])
  })
})
