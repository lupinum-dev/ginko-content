import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'

const ignoredDirs = new Set([
  '.git',
  '.nuxt',
  '.output',
  '.cache',
  'coverage',
  'dist',
  'node_modules'
])

const sourceExtensions = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
  '.vue',
  '.yml',
  '.yaml'
])

export const toRelativePath = (rootDir: string, file: string) => relative(rootDir, file) || '.'

export async function collectFiles(dir: string, rootDir: string, files: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    const absolutePath = join(dir, entry.name)

    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) {
        await collectFiles(absolutePath, rootDir, files)
      }
      continue
    }

    if (entry.isFile() && sourceExtensions.has(extname(entry.name))) {
      files.push(absolutePath)
    }
  }

  return files
}

export async function collectOutputFiles(dir: string, rootDir: string, files: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    const absolutePath = join(dir, entry.name)

    if (entry.isDirectory()) {
      if (entry.name !== '_nuxt') {
        await collectOutputFiles(absolutePath, rootDir, files)
      }
      continue
    }

    if (entry.isFile() && ['.html', '.json', '.xml'].includes(extname(entry.name))) {
      files.push(absolutePath)
    }
  }

  return files
}

export async function readTextIfPresent(path: string): Promise<string> {
  if (!existsSync(path)) {
    return ''
  }

  const fileStat = await stat(path)
  if (!fileStat.isFile()) {
    return ''
  }

  return readFile(path, 'utf8')
}

export async function readPackageJson(rootDir: string): Promise<Record<string, any> | undefined> {
  const path = join(rootDir, 'package.json')
  if (!existsSync(path)) {
    return undefined
  }

  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, any>
  }
  catch {
    return undefined
  }
}

export function hasDependency(packageJson: Record<string, any> | undefined, packageName: string): boolean {
  if (!packageJson) {
    return false
  }

  return ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].some(blockName => {
    const block = packageJson[blockName]
    return !!block && typeof block === 'object' && packageName in block
  })
}
