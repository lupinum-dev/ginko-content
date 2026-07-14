import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ContentSearchIndexRecord } from '../../types/search'
import { createPagefindLocaleManifest, isPagefindLocale } from '../pagefind-manifest'

export async function writePagefindIndex (records: ContentSearchIndexRecord[], outputPath: string, defaultLocale: string) {
  const { createIndex } = await import('pagefind')
  const fallbackLocale = defaultLocale || 'en'
  if (!isPagefindLocale(fallbackLocale)) {
    throw new Error(`Invalid Pagefind locale "${fallbackLocale}".`)
  }
  const recordsByLocale = new Map<string, ContentSearchIndexRecord[]>()
  for (const record of records) {
    const locale = record.locale || fallbackLocale
    if (!isPagefindLocale(locale)) {
      throw new Error(`Invalid Pagefind locale "${locale}".`)
    }
    const scoped = recordsByLocale.get(locale) || []
    scoped.push({ ...record, locale })
    recordsByLocale.set(locale, scoped)
  }
  const locales = [...new Set([fallbackLocale, ...recordsByLocale.keys()])].sort((left, right) => {
    if (left === fallbackLocale) return -1
    if (right === fallbackLocale) return 1
    return left.localeCompare(right)
  })

  for (const locale of locales) {
    const { index } = await createIndex()
    if (!index) throw new Error(`Failed to initialize Pagefind index for locale "${locale}"`)

    for (const record of recordsByLocale.get(locale) || []) {
      const url = record.anchor ? `${record.path}#${record.anchor}` : record.path
      const content = [record.title, ...record.headings, record.content].filter(Boolean).join('\n')
      const response = await index.addCustomRecord({
        url,
        content,
        language: locale,
        meta: {
          title: record.title,
          excerpt: record.excerpt,
          collection: record.collection,
          locale,
          anchor: record.anchor || '',
          path: record.path
        },
        filters: {
          locale: [locale]
        }
      })

      if (response.errors.length) {
        throw new Error(`Failed to add Pagefind record for ${url}: ${response.errors.join(', ')}`)
      }
    }

    const localeOutputPath = locale === fallbackLocale ? outputPath : join(outputPath, locale)
    const response = await index.writeFiles({ outputPath: localeOutputPath })
    if (response.errors.length) {
      throw new Error(`Failed to write Pagefind index for locale "${locale}": ${response.errors.join(', ')}`)
    }
  }

  const manifest = createPagefindLocaleManifest(fallbackLocale, locales)
  await writeFile(join(outputPath, 'ginko-locales.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}
