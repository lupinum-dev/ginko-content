import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { DoctorFinding, SitemapFile } from './types'
import { toRelativePath } from './files'

export const countSitemapUrls = (text: string) => (text.match(/<url>/g) || []).length

export async function readGeneratedSitemaps(rootDir: string): Promise<SitemapFile[]> {
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

export async function inspectSitemap(rootDir: string): Promise<DoctorFinding[]> {
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
