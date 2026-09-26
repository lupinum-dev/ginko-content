import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, join, resolve } from 'node:path'
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

/** Runtime (non-type) module specifiers of one source file. */
function runtimeSpecifiers(source: ts.SourceFile): string[] {
  const specifiers: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier) && !node.importClause?.isTypeOnly) {
      specifiers.push(node.moduleSpecifier.text)
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier) && !node.isTypeOnly) {
      specifiers.push(node.moduleSpecifier.text)
    }
    if (
      ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])
    ) specifiers.push(node.arguments[0].text)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return specifiers
}

const resolveRelative = (from: string, specifier: string): string | undefined => {
  const base = resolve(dirname(from), specifier)
  return [base.replace(/\.js$/, '.ts'), `${base}.ts`, join(base, 'index.ts')].find(candidate => existsSync(candidate))
}

describe('@lupinum/ginko-content/cms-contract module graph', () => {
  it('reaches no Node builtin, Nuxt, Nitro, h3, or virtual module through its imports', () => {
    const entry = join(cmsContractRoot, 'index.ts')
    const seen = new Set<string>()
    const pending = [entry]
    const offenders: string[] = []
    const builtins = new Set(builtinModules)
    while (pending.length) {
      const file = pending.pop()!
      if (seen.has(file)) continue
      seen.add(file)
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
      for (const specifier of runtimeSpecifiers(source)) {
        if (specifier.startsWith('.')) {
          const target = resolveRelative(file, specifier)
          if (!target) offenders.push(`${file}: unresolved ${specifier}`)
          else pending.push(target)
          continue
        }
        const bare = specifier.split('/')[0]!
        if (
          specifier.startsWith('node:') || builtins.has(specifier) || builtins.has(bare) ||
          specifier.startsWith('#') || ['nuxt', 'h3', 'nitropack', 'unstorage'].includes(bare) ||
          bare === '@nuxt' || specifier.startsWith('@nuxt/')
        ) offenders.push(`${file}: ${specifier}`)
      }
    }
    expect(seen.size).toBeGreaterThan(10)
    expect(offenders).toEqual([])
  })
})
