import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const cmsContractRoot = join(process.cwd(), 'packages/content/src/cms-contract')

const forbiddenImports = new Set([
  'fs',
  'fs/promises',
  'node:fs',
  'node:fs/promises',
  'path',
  'node:path',
  'process',
  'node:process',
  'child_process',
  'node:child_process',
  'worker_threads',
  'node:worker_threads',
  'url',
  'node:url',
  'nuxt',
  '@nuxt/kit',
  '@nuxt/schema',
  'nitropack',
  'h3',
])

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : []
  })
}

function collectForbiddenImports(source: ts.SourceFile): string[] {
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
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      forbiddenImports.has(node.arguments[0].text)
    ) {
      imports.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return imports
}

function collectForbiddenRuntimeGlobals(source: ts.SourceFile): string[] {
  const globals: string[] = []
  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === 'env' &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'process'
    ) {
      globals.push('process.env')
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === 'url' &&
      node.expression.kind === ts.SyntaxKind.ImportMeta
    ) {
      globals.push('import.meta.url')
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === '__NUXT__' &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'globalThis'
    ) {
      globals.push('globalThis.__NUXT__')
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return globals
}

describe('@lupinum/ginko-content/cms-contract purity', () => {
  it('does not import Node, Nuxt, Nitro, or app-runtime modules', () => {
    const files = sourceFiles(cmsContractRoot)

    expect(files.length).toBeGreaterThan(0)

    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)

      expect(collectForbiddenImports(ast), `${file} has forbidden imports`).toEqual([])
      expect(collectForbiddenRuntimeGlobals(ast), `${file} has forbidden runtime globals`).toEqual(
        [],
      )
    }
  })
})
