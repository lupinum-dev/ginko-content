import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'

type FindingSeverity = 'error' | 'info'

export interface DoctorFinding {
  severity: FindingSeverity
  file: string
  message: string
  suggestion: string
}

export interface DoctorResult {
  rootDir: string
  findings: DoctorFinding[]
  exitCode: number
}

export interface DoctorOptions {
  rootDir?: string
  i18n?: boolean
}

interface SitemapFile {
  file: string
  text: string
}

interface DetectedI18n {
  locales: string[]
  hasNuxtI18nModule: boolean
  hasContentI18nConfig: boolean
  hasNuxtI18nDependency: boolean
}

interface CollectionDefinition {
  name: string
  block: string
}

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

const stalePackageNames = ['@nuxt/content', 'better-sqlite3', '@standard-schema/spec'] as const

const sourceChecks: Array<{
  pattern: RegExp
  message: string
  suggestion: string
}> = [
  {
    pattern: /from\s+['"]@nuxt\/content(?:\/[^'"]*)?['"]|import\s*\([^)]*['"]@nuxt\/content(?:\/[^'"]*)?['"][^)]*\)/,
    message: 'Direct Nuxt Content import found.',
    suggestion: 'Import Ginko helpers from @lupinum/ginko-content/config, /client, or /server.'
  },
  {
    pattern: /['"]@nuxt\/content['"]/,
    message: 'Nuxt Content module or package reference found.',
    suggestion: 'Remove @nuxt/content from Nuxt modules and use @lupinum/ginko-content.'
  },
  {
    pattern: /\bqueryCollectionItemSurroundings\s*\(/,
    message: 'Nuxt Content v3 surround helper found.',
    suggestion: 'Use useContentPage(collection, { surround: true }) in route page components.'
  },
  {
    pattern: /\bqueryCollectionSearchSections\s*\(/,
    message: 'Nuxt Content v3 search sections helper found.',
    suggestion: 'Use useContentSearchData(collection) for UI search data.'
  },
  {
    pattern: /\bqueryCollectionNavigation\s*\(/,
    message: 'Nuxt Content v3 navigation helper found.',
    suggestion: 'Use useContentTree(handle) for layout navigation.'
  },
  {
    pattern: /\bqueryCollection\s*\(/,
    message: 'Removed collection query helper found.',
    suggestion: 'Use one(handle, options), many(handle, options), paginate(handle, options), or the matching useContent* composable.'
  },
  {
    pattern: /\buseContentList\s*\(/,
    message: 'Removed content list composable found.',
    suggestion: 'Use useContentMany(handle, options) or many(handle, options).'
  },
  {
    pattern: /\buseContentNavigation\s*\(/,
    message: 'Removed content navigation composable found.',
    suggestion: 'Use useContentTree(handle) for layout navigation.'
  },
  {
    pattern: /\bcontent\.(database|preview|build)\b/,
    message: 'Nuxt Content v3 runtime config key found.',
    suggestion: 'Remove content.database/content.preview/content.build and configure Ginko runtime options instead.'
  },
  {
    pattern: /\.editor\s*\(/,
    message: 'Nuxt Studio Zod .editor(...) helper found.',
    suggestion: 'Remove .editor(...) from runtime Zod schemas or move editor metadata outside the schema.'
  },
  {
    pattern: /<ContentRenderer\b[^>]*:value\s*=\s*["'][^"']*\.body["']/,
    message: 'ContentRenderer is receiving a document body.',
    suggestion: 'Pass the full content document to ContentRenderer, not document.body.'
  },
  {
    pattern: /<NuxtLink\b[^>]*:to\s*=\s*["'][^"']+\.path["']/,
    message: 'NuxtLink may be using raw query .path.',
    suggestion: 'Use useContentMany(handle, options) for route-safe list items, or link route-page payloads with their explicit path field.'
  },
  {
    pattern: /<NuxtLink\b[^>]*:to\s*=\s*["'][^"']+\._path["']/,
    message: 'NuxtLink is using raw content _path.',
    suggestion: 'Use useContentMany(handle, options) for list pages and bind the route-safe item.path field.'
  }
]

const lockfileNames = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lockb']
const localeCodePattern = /^[a-z]{2}(?:-[A-Z]{2})?$/

const toRelativePath = (rootDir: string, file: string) => relative(rootDir, file) || '.'
const countSitemapUrls = (text: string) => (text.match(/<url>/g) || []).length

function findMatchingBrace(text: string, start: number): number {
  let depth = 0
  let quote: string | undefined
  let escaped = false
  let lineComment = false
  let blockComment = false

  for (let index = start; index < text.length; index++) {
    const char = text[index]
    const next = text[index + 1]

    if (lineComment) {
      if (char === '\n') {
        lineComment = false
      }
      continue
    }

    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false
        index++
      }
      continue
    }

    if (quote) {
      if (escaped) {
        escaped = false
      }
      else if (char === '\\') {
        escaped = true
      }
      else if (char === quote) {
        quote = undefined
      }
      continue
    }

    if (char === '/' && next === '/') {
      lineComment = true
      index++
      continue
    }

    if (char === '/' && next === '*') {
      blockComment = true
      index++
      continue
    }

    if (char === '\'' || char === '"' || char === '`') {
      quote = char
      continue
    }

    if (char === '{') {
      depth++
    }
    else if (char === '}') {
      depth--
      if (depth === 0) {
        return index
      }
    }
  }

  return text.length - 1
}

function findCollectionDefinitions(text: string): CollectionDefinition[] {
  const definitions: CollectionDefinition[] = []
  const callPattern = /\bdefineCollection\s*\(/g

  for (const match of text.matchAll(callPattern)) {
    const callStart = match.index || 0
    const argsStart = callStart + match[0].length
    const args = text.slice(argsStart)
    const namedMatch = args.match(/^\s*(['"])([^'"]+)\1\s*,\s*\{/)

    if (namedMatch) {
      const bodyStart = argsStart + namedMatch[0].lastIndexOf('{')
      const bodyEnd = findMatchingBrace(text, bodyStart)
      definitions.push({
        name: namedMatch[2],
        block: text.slice(bodyStart, bodyEnd + 1)
      })
      continue
    }

    const objectMatch = args.match(/^\s*\{/)
    const propertyMatch = text.slice(0, callStart).match(/([a-z_$][\w$]*)\s*:\s*$/i)
    if (objectMatch && propertyMatch) {
      const bodyStart = argsStart + objectMatch[0].lastIndexOf('{')
      const bodyEnd = findMatchingBrace(text, bodyStart)
      definitions.push({
        name: propertyMatch[1],
        block: text.slice(bodyStart, bodyEnd + 1)
      })
    }
  }

  return definitions
}

function findObjectPropertyBlocks(text: string, property: string): string[] {
  const blocks: string[] = []
  const pattern = new RegExp(`\\b${property}\\s*:\\s*\\{`, 'g')

  for (const match of text.matchAll(pattern)) {
    const bodyStart = text.indexOf('{', match.index)
    if (bodyStart === -1) {
      continue
    }

    const bodyEnd = findMatchingBrace(text, bodyStart)
    blocks.push(text.slice(bodyStart, bodyEnd + 1))
  }

  return blocks
}

function extractStringArrayProperty(block: string, property: string): string[] {
  const match = block.match(new RegExp(`\\b${property}\\s*:\\s*\\[([\\s\\S]*?)\\]`))
  if (!match) {
    return []
  }

  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map(item => item[1])
}

async function collectFiles(dir: string, rootDir: string, files: string[] = []): Promise<string[]> {
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

function packageDependencyFindings(rootDir: string, packageJson: Record<string, any>): DoctorFinding[] {
  const dependencyBlocks = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
  const findings: DoctorFinding[] = []

  for (const blockName of dependencyBlocks) {
    const block = packageJson[blockName]
    if (!block || typeof block !== 'object') {
      continue
    }

    for (const packageName of stalePackageNames) {
      if (packageName in block) {
        findings.push({
          severity: 'error',
          file: toRelativePath(rootDir, join(rootDir, 'package.json')),
          message: `Direct dependency "${packageName}" found in ${blockName}.`,
          suggestion: packageName === '@nuxt/content'
            ? 'Remove @nuxt/content and install @lupinum/ginko-content.'
            : `Remove ${packageName} unless the app imports it directly. If it is only transitive, keep it out of package.json.`
        })
      }
    }
  }

  return findings
}

async function inspectPackageJson(rootDir: string): Promise<DoctorFinding[]> {
  const path = join(rootDir, 'package.json')
  if (!existsSync(path)) {
    return []
  }

  try {
    const packageJson = JSON.parse(await readFile(path, 'utf8')) as Record<string, any>
    return packageDependencyFindings(rootDir, packageJson)
  }
  catch {
    return [{
      severity: 'error',
      file: 'package.json',
      message: 'package.json could not be parsed.',
      suggestion: 'Fix package.json before running ginko-content doctor again.'
    }]
  }
}

async function inspectSourceFiles(rootDir: string): Promise<DoctorFinding[]> {
  const files = await collectFiles(rootDir, rootDir)
  const findings: DoctorFinding[] = []

  for (const file of files) {
    if (lockfileNames.includes(file.split('/').pop() || '')) {
      continue
    }

    const text = await readFile(file, 'utf8')
    for (const check of sourceChecks) {
      if (check.pattern.test(text)) {
        findings.push({
          severity: 'error',
          file: toRelativePath(rootDir, file),
          message: check.message,
          suggestion: check.suggestion
        })
      }
    }
  }

  return findings
}

async function inspectSearchCollections(rootDir: string): Promise<DoctorFinding[]> {
  const contentConfig = await readTextIfPresent(join(rootDir, 'content.config.ts'))
  const nuxtConfig = await readTextIfPresent(join(rootDir, 'nuxt.config.ts'))

  if (!contentConfig || !nuxtConfig) {
    return []
  }

  const dataCollections = new Set(
    findCollectionDefinitions(contentConfig)
      .filter(collection => /\btype\s*:\s*['"]data['"]/.test(collection.block))
      .map(collection => collection.name)
  )

  if (!dataCollections.size) {
    return []
  }

  const configuredCollections = new Set(
    findObjectPropertyBlocks(nuxtConfig, 'search')
      .flatMap(block => extractStringArrayProperty(block, 'collections'))
  )
  const dataSearchCollections = [...configuredCollections].filter(collection => dataCollections.has(collection))

  if (!dataSearchCollections.length) {
    return []
  }

  return [{
    severity: 'info',
    file: 'nuxt.config.ts',
    message: `Data-only collections listed in content.search.collections: ${dataSearchCollections.join(', ')}.`,
    suggestion: 'Remove data-only collections from the static public search index, make them route-backed pages, or use provider-backed search with route-safe results.'
  }]
}

async function inspectLockfiles(rootDir: string): Promise<DoctorFinding[]> {
  const findings: DoctorFinding[] = []

  for (const lockfileName of lockfileNames) {
    const path = join(rootDir, lockfileName)
    if (!existsSync(path)) {
      continue
    }

    const text = await readFile(path, 'utf8')
    const presentPackages = stalePackageNames.filter(packageName => text.includes(packageName))
    if (presentPackages.length) {
      findings.push({
        severity: 'info',
        file: lockfileName,
        message: `Lockfile still mentions ${presentPackages.join(', ')}.`,
        suggestion: `Run "pnpm why ${presentPackages.join(' ')}" and only act if one is still a direct app dependency.`
      })
    }
  }

  return findings
}

async function readGeneratedSitemaps(rootDir: string): Promise<SitemapFile[]> {
  const outputPublicDir = join(rootDir, '.output/public')
  if (!existsSync(outputPublicDir)) {
    return []
  }

  const sitemapPaths = [
    join(outputPublicDir, 'sitemap.xml'),
    join(outputPublicDir, 'sitemap_index.xml')
  ]
  const sitemapDir = join(outputPublicDir, '__sitemap__')

  if (existsSync(sitemapDir)) {
    const entries = await readdir(sitemapDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.xml')) {
        sitemapPaths.push(join(sitemapDir, entry.name))
      }
    }
  }

  const sitemapFiles: SitemapFile[] = []
  for (const sitemapPath of sitemapPaths) {
    if (!existsSync(sitemapPath)) {
      continue
    }

    const fileStat = await stat(sitemapPath)
    if (fileStat.isFile()) {
      sitemapFiles.push({
        file: toRelativePath(rootDir, sitemapPath),
        text: await readFile(sitemapPath, 'utf8')
      })
    }
  }

  return sitemapFiles
}

async function inspectSitemap(rootDir: string): Promise<DoctorFinding[]> {
  const sitemapFiles = await readGeneratedSitemaps(rootDir)
  const sitemapTexts = sitemapFiles.map(file => file.text)

  if (!sitemapTexts.length) {
    return []
  }

  const urlCount = sitemapTexts.reduce((total, text) => total + countSitemapUrls(text), 0)
  const hasSitemapIndex = sitemapTexts.some(text => /<sitemapindex\b/.test(text))
  if (urlCount > 0 || hasSitemapIndex) {
    return []
  }

  return [{
    severity: 'error',
    file: '.output/public/sitemap.xml',
    message: 'Generated sitemap contains no <url> entries.',
    suggestion: 'Enable content.sitemap, configure site.url, and verify public route collections are sitemap-backed.'
  }]
}

async function readTextIfPresent(path: string): Promise<string> {
  if (!existsSync(path)) {
    return ''
  }

  const fileStat = await stat(path)
  if (!fileStat.isFile()) {
    return ''
  }

  return readFile(path, 'utf8')
}

function extractLocaleCodesFromConfig(text: string): string[] {
  const locales = new Set<string>()

  for (const match of text.matchAll(/\bcode\s*:\s*['"]([^'"]+)['"]/g)) {
    if (localeCodePattern.test(match[1])) {
      locales.add(match[1])
    }
  }

  for (const match of text.matchAll(/\bdefaultLocale\s*:\s*['"]([^'"]+)['"]/g)) {
    if (localeCodePattern.test(match[1])) {
      locales.add(match[1])
    }
  }

  for (const match of text.matchAll(/\blocales\s*:\s*\[([\s\S]*?)\]/g)) {
    if (/\bcode\s*:/.test(match[1])) {
      continue
    }

    for (const localeMatch of match[1].matchAll(/['"]([^'"]+)['"]/g)) {
      if (localeCodePattern.test(localeMatch[1])) {
        locales.add(localeMatch[1])
      }
    }
  }

  return [...locales]
}

async function readPackageJson(rootDir: string): Promise<Record<string, any> | undefined> {
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

function hasDependency(packageJson: Record<string, any> | undefined, packageName: string): boolean {
  if (!packageJson) {
    return false
  }

  return ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].some(blockName => {
    const block = packageJson[blockName]
    return !!block && typeof block === 'object' && packageName in block
  })
}

async function detectI18n(rootDir: string): Promise<DetectedI18n> {
  const nuxtConfigPath = join(rootDir, 'nuxt.config.ts')
  const contentConfigPath = join(rootDir, 'content.config.ts')
  const nuxtConfig = await readTextIfPresent(nuxtConfigPath)
  const contentConfig = await readTextIfPresent(contentConfigPath)
  const packageJson = await readPackageJson(rootDir)
  const locales = new Set([
    ...extractLocaleCodesFromConfig(nuxtConfig),
    ...extractLocaleCodesFromConfig(contentConfig)
  ])
  const contentDir = join(rootDir, 'content')

  if (existsSync(contentDir)) {
    const entries = await readdir(contentDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && localeCodePattern.test(entry.name)) {
        locales.add(entry.name)
      }
    }
  }

  return {
    locales: [...locales].sort(),
    hasNuxtI18nModule: /['"]@nuxtjs\/i18n['"]/.test(nuxtConfig),
    hasContentI18nConfig: /\bcontent\s*:\s*\{[\s\S]*?\bi18n\s*:/.test(nuxtConfig),
    hasNuxtI18nDependency: hasDependency(packageJson, '@nuxtjs/i18n')
  }
}

async function inspectI18nConfig(rootDir: string, detected: DetectedI18n): Promise<DoctorFinding[]> {
  const findings: DoctorFinding[] = []

  if (!detected.locales.length) {
    findings.push({
      severity: 'error',
      file: 'nuxt.config.ts',
      message: 'No i18n locales detected.',
      suggestion: 'Configure @nuxtjs/i18n locales and content.i18n.locales, or create content/<locale>/ folders.'
    })
  }

  if (!detected.hasNuxtI18nDependency) {
    findings.push({
      severity: 'error',
      file: 'package.json',
      message: 'Direct @nuxtjs/i18n dependency is missing for an i18n app.',
      suggestion: 'Install @nuxtjs/i18n directly so Nuxt owns route localization explicitly.'
    })
  }

  if (!detected.hasNuxtI18nModule) {
    findings.push({
      severity: 'error',
      file: 'nuxt.config.ts',
      message: '@nuxtjs/i18n module is not registered.',
      suggestion: 'Add @nuxtjs/i18n to modules before relying on localized content routes.'
    })
  }

  if (!detected.hasContentI18nConfig) {
    findings.push({
      severity: 'error',
      file: 'nuxt.config.ts',
      message: 'content.i18n runtime config is missing.',
      suggestion: 'Add content.i18n with defaultLocale and locales so collections resolve localized documents.'
    })
  }

  return findings
}

async function inspectI18nCollections(rootDir: string): Promise<DoctorFinding[]> {
  const contentConfigPath = join(rootDir, 'content.config.ts')
  const text = await readTextIfPresent(contentConfigPath)
  if (!text) {
    return [{
      severity: 'error',
      file: 'content.config.ts',
      message: 'content.config.ts is missing.',
      suggestion: 'Declare i18n collections with defineContentConfig({ collections }).'
    }]
  }

  const collections = findCollectionDefinitions(text)
  if (!collections.length) {
    return []
  }

  const findings: DoctorFinding[] = []
  for (const collection of collections) {
    if (!/\bi18n\s*:\s*(true|\{)/.test(collection.block)) {
      findings.push({
        severity: 'error',
        file: 'content.config.ts',
        message: `Collection "${collection.name}" is not marked as i18n-aware.`,
        suggestion: `Add i18n: true to the ${collection.name} collection or provide collection-level i18n locales.`
      })
    }
  }

  return findings
}

async function inspectI18nContentFolders(rootDir: string, locales: string[]): Promise<DoctorFinding[]> {
  const contentDir = join(rootDir, 'content')
  if (!existsSync(contentDir) || !locales.length) {
    return []
  }

  const findings: DoctorFinding[] = []
  for (const locale of locales) {
    const localeDir = join(contentDir, locale)
    if (!existsSync(localeDir) || !(await stat(localeDir)).isDirectory()) {
      findings.push({
        severity: 'error',
        file: `content/${locale}`,
        message: `Content locale folder "${locale}" is missing.`,
        suggestion: `Create content/${locale}/ and place translated collection files under that locale root.`
      })
    }
  }

  return findings
}

async function inspectI18nSourceSmells(rootDir: string, locales: string[]): Promise<DoctorFinding[]> {
  const files = await collectFiles(rootDir, rootDir)
  const findings: DoctorFinding[] = []
  const hardcodedLocalePathPattern = locales.length
    ? new RegExp(`locale\\.(?:value|code)\\s*={2,3}\\s*['"](?:${locales.join('|')})['"][\\s\\S]{0,160}?['"]/(?:${locales.join('|')})/`)
    : undefined

  for (const file of files) {
    const relativeFile = toRelativePath(rootDir, file)
    if (!/^(app|pages|components|layouts|error\.vue)\//.test(relativeFile) && relativeFile !== 'error.vue') {
      continue
    }

    const text = await readFile(file, 'utf8')
    if (hardcodedLocalePathPattern?.test(text)) {
      findings.push({
        severity: 'error',
        file: relativeFile,
        message: 'Hardcoded locale route branch found.',
        suggestion: 'Use @nuxtjs/i18n route helpers, useContentTree(handle), or useContentMany(handle, options) item paths instead of branching on locale codes.'
      })
    }

    if (/<(?:NuxtLink|U[A-Za-z]+)\b[^>]*:to\s*=\s*["'][^"']+\._path["']/.test(text)) {
      findings.push({
        severity: 'error',
        file: relativeFile,
        message: 'UI link is bound to raw content _path.',
        suggestion: 'Use useContentMany(handle, options) for localized list pages and bind item.path.'
      })
    }
  }

  return findings
}

async function inspectI18nDuplicateContentGroups(rootDir: string, locales: string[]): Promise<DoctorFinding[]> {
  const contentDir = join(rootDir, 'content')
  if (!existsSync(contentDir) || !locales.length) {
    return []
  }

  const findings: DoctorFinding[] = []
  for (const locale of locales) {
    const localeDir = join(contentDir, locale)
    if (!existsSync(localeDir)) {
      continue
    }

    const entries = await readdir(localeDir, { withFileTypes: true })
    const byOrdinal = new Map<string, string[]>()
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue
      }

      const ordinal = entry.name.match(/^(\d+)\./)?.[1]
      if (!ordinal) {
        continue
      }

      const names = byOrdinal.get(ordinal) || []
      names.push(entry.name)
      byOrdinal.set(ordinal, names)
    }

    for (const [ordinal, names] of byOrdinal) {
      if (names.length > 1) {
        findings.push({
          severity: 'error',
          file: `content/${locale}`,
          message: `Locale "${locale}" has multiple content groups with ordinal "${ordinal}": ${names.join(', ')}.`,
          suggestion: 'Keep one translated slug group per collection ordinal and delete stale canonical duplicates.'
        })
      }
    }
  }

  return findings
}

async function collectOutputFiles(dir: string, rootDir: string, files: string[] = []): Promise<string[]> {
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

async function inspectRepeatedLocalePrefixes(rootDir: string, locales: string[]): Promise<DoctorFinding[]> {
  const outputPublicDir = join(rootDir, '.output/public')
  if (!existsSync(outputPublicDir)) {
    return []
  }

  const files = await collectOutputFiles(outputPublicDir, rootDir)
  const findings: DoctorFinding[] = []

  for (const file of files) {
    const relativeFile = toRelativePath(rootDir, file)
    const text = await readFile(file, 'utf8')
    for (const locale of locales) {
      const repeatedPath = `/${locale}/${locale}/`
      if (relativeFile.includes(repeatedPath) || text.includes(repeatedPath)) {
        findings.push({
          severity: 'error',
          file: relativeFile,
          message: `Repeated locale prefix "${repeatedPath}" found in generated output.`,
          suggestion: 'Use locale-neutral raw _path values in content links and let Nuxt I18n add the route prefix once.'
        })
        break
      }
    }
  }

  return findings
}

async function inspectI18nSitemaps(rootDir: string, locales: string[]): Promise<DoctorFinding[]> {
  const sitemapFiles = await readGeneratedSitemaps(rootDir)
  const childSitemaps = sitemapFiles.filter(file => file.file.includes('__sitemap__/'))
  if (!childSitemaps.length || !locales.length) {
    return []
  }

  const findings: DoctorFinding[] = []
  for (const locale of locales) {
    const hasLocaleSitemap = childSitemaps.some(file => {
      const filename = file.file.split('/').pop() || ''
      return filename.startsWith(locale) && countSitemapUrls(file.text) > 0
    })

    if (!hasLocaleSitemap) {
      findings.push({
        severity: 'error',
        file: '.output/public/__sitemap__',
        message: `Generated sitemap is missing non-empty locale sitemap for "${locale}".`,
        suggestion: 'Build the app and verify Nuxt Sitemap emits one child sitemap per configured locale.'
      })
    }
  }

  return findings
}

async function inspectI18nSitemapSummary(rootDir: string, locales: string[]): Promise<DoctorFinding[]> {
  const sitemapFiles = await readGeneratedSitemaps(rootDir)
  const index = sitemapFiles.find(file => file.file === '.output/public/sitemap_index.xml' && /<sitemapindex\b/.test(file.text))
  const childSitemaps = sitemapFiles
    .filter(file => file.file.includes('__sitemap__/'))
    .map(file => ({
      file: file.file,
      urlCount: countSitemapUrls(file.text)
    }))
    .sort((a, b) => a.file.localeCompare(b.file))

  if (!index || !childSitemaps.length || !locales.length) {
    return []
  }

  const rootSitemapPath = join(rootDir, '.output/public/sitemap.xml')
  const hasRedirectDirectory = existsSync(rootSitemapPath) && (await stat(rootSitemapPath)).isDirectory()
  const childSummary = childSitemaps
    .map(file => `${file.file.replace('.output/public/', '')} (${file.urlCount} ${file.urlCount === 1 ? 'URL' : 'URLs'})`)
    .join(', ')
  const totalUrls = childSitemaps.reduce((total, file) => total + file.urlCount, 0)
  const redirectNote = hasRedirectDirectory
    ? ' Ignore .output/public/sitemap.xml/ when it is a generated redirect directory.'
    : ''

  return [{
    severity: 'info',
    file: '.output/public/sitemap_index.xml',
    message: `Sitemap mode: Nuxt Sitemap i18n multi-sitemap (${childSitemaps.length} child sitemaps, ${totalUrls} ${totalUrls === 1 ? 'URL' : 'URLs'}).`,
    suggestion: `Submit "/sitemap_index.xml". Child sitemaps: ${childSummary}.${redirectNote}`
  }]
}

async function inspectI18nSearchIndex(rootDir: string, locales: string[]): Promise<DoctorFinding[]> {
  const searchIndexPath = join(rootDir, '.output/public/api/_content/search/index.json')
  if (!existsSync(searchIndexPath) || !locales.length) {
    return []
  }

  try {
    const raw = JSON.parse(await readFile(searchIndexPath, 'utf8')) as unknown
    const records = Array.isArray(raw)
      ? raw
      : raw && typeof raw === 'object' && Array.isArray((raw as { records?: unknown }).records)
        ? (raw as { records: unknown[] }).records
        : []

    const findings: DoctorFinding[] = []
    for (const locale of locales) {
      const hasLocaleRecords = records.some(record => {
        if (!record || typeof record !== 'object') {
          return false
        }

        const item = record as Record<string, unknown>
        return item.locale === locale || item._locale === locale || (typeof item.path === 'string' && item.path.startsWith(`/${locale}/`))
      })

      if (!hasLocaleRecords) {
        findings.push({
          severity: 'error',
          file: '.output/public/api/_content/search/index.json',
          message: `Search index has no records for locale "${locale}".`,
          suggestion: 'Use useContentSearchData() with i18n collections and verify the prerendered search payload includes every locale.'
        })
      }
    }

    return findings
  }
  catch {
    return [{
      severity: 'error',
      file: '.output/public/api/_content/search/index.json',
      message: 'Search index JSON could not be parsed.',
      suggestion: 'Rebuild the app and inspect the generated search payload.'
    }]
  }
}

async function inspectI18n(rootDir: string): Promise<DoctorFinding[]> {
  const detected = await detectI18n(rootDir)

  return [
    ...await inspectI18nConfig(rootDir, detected),
    ...await inspectI18nCollections(rootDir),
    ...await inspectI18nContentFolders(rootDir, detected.locales),
    ...await inspectI18nDuplicateContentGroups(rootDir, detected.locales),
    ...await inspectI18nSourceSmells(rootDir, detected.locales),
    ...await inspectRepeatedLocalePrefixes(rootDir, detected.locales),
    ...await inspectI18nSitemaps(rootDir, detected.locales),
    ...await inspectI18nSitemapSummary(rootDir, detected.locales),
    ...await inspectI18nSearchIndex(rootDir, detected.locales)
  ]
}

export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorResult> {
  const rootDir = options.rootDir || process.cwd()
  const findings = [
    ...await inspectPackageJson(rootDir),
    ...await inspectSourceFiles(rootDir),
    ...await inspectSearchCollections(rootDir),
    ...await inspectLockfiles(rootDir),
    ...await inspectSitemap(rootDir),
    ...(options.i18n ? await inspectI18n(rootDir) : [])
  ].sort((a, b) => `${a.severity}:${a.file}:${a.message}`.localeCompare(`${b.severity}:${b.file}:${b.message}`))
  const exitCode = findings.some(finding => finding.severity === 'error') ? 1 : 0

  return {
    rootDir,
    findings,
    exitCode
  }
}

export function formatDoctorResult(result: DoctorResult): string {
  const errors = result.findings.filter(finding => finding.severity === 'error')
  const infos = result.findings.filter(finding => finding.severity === 'info')
  const lines = [
    `Ginko Content doctor: ${errors.length ? 'issues found' : 'ok'}`,
    `Root: ${result.rootDir}`
  ]

  if (errors.length) {
    lines.push('', `Errors (${errors.length})`)
    for (const finding of errors) {
      lines.push(`- ${finding.file}: ${finding.message}`)
      lines.push(`  Fix: ${finding.suggestion}`)
    }
  }

  if (infos.length) {
    lines.push('', `Info (${infos.length})`)
    for (const finding of infos) {
      lines.push(`- ${finding.file}: ${finding.message}`)
      lines.push(`  Check: ${finding.suggestion}`)
    }
  }

  return `${lines.join('\n')}\n`
}
