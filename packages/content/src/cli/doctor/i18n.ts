import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { DetectedI18n, DoctorFinding } from './types'
import { collectFiles, collectOutputFiles, hasDependency, readPackageJson, readTextIfPresent, toRelativePath } from './files'
import { extractLocaleCodesFromConfig, findCollectionDefinitions, localeCodePattern } from './parsing'
import { countSitemapUrls, readGeneratedSitemaps } from './sitemap'

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
        suggestion: 'Use @nuxtjs/i18n route helpers, useContentNavigation(\'docs\'), or useContentMany(\'docs\', options) item paths instead of branching on locale codes.'
      })
    }

    if (/<(?:NuxtLink|U[A-Za-z]+)\b[^>]*:to\s*=\s*["'][^"']+\._path["']/.test(text)) {
      findings.push({
        severity: 'error',
        file: relativeFile,
        message: 'UI link is bound to raw content _path.',
        suggestion: 'Use useContentMany(\'docs\', options) for localized list pages and bind item.path.'
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
        return item.locale === locale || (typeof item.path === 'string' && item.path.startsWith(`/${locale}/`))
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

export async function inspectI18n(rootDir: string): Promise<DoctorFinding[]> {
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
