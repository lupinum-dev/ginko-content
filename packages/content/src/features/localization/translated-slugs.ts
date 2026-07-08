import type { ParsedContent } from '../../types/content'

const TRANSLATED_SLUG_SEGMENT_RE = /^(\d+)\.(.+)$/

export type TranslatedSlugValidationIssue = {
  level: 'warn' | 'error'
  file: string
  reason: string
  details?: string
}

type TranslatedSlugEntry = {
  locale: string
  file: string
  parentKey: string
  raw: string
  number?: string
  kind: 'dir' | 'file'
}

const getTranslatedSlugEntries = (document: ParsedContent, locales: string[] = []): TranslatedSlugEntry[] => {
  const file = (document.file?.path || '').replace(/^\/+/, '')
  const parts = file.split('/').filter(Boolean)
  const localizedParts = parts[0] && locales.includes(parts[0]) ? parts.slice(1) : parts

  if (!localizedParts.length) {
    return []
  }

  const locale = document._locale || ''
  const directories = localizedParts.slice(0, -1)
  const basename = localizedParts[localizedParts.length - 1] || ''
  const entries: TranslatedSlugEntry[] = []
  let parentKey = '/'

  for (const directory of directories) {
    const match = directory.match(TRANSLATED_SLUG_SEGMENT_RE)
    entries.push({
      locale,
      file: document.file?.path || document.id,
      parentKey,
      raw: directory,
      number: match?.[1],
      kind: 'dir'
    })
    parentKey = match?.[1] ? `${parentKey}${parentKey === '/' ? '' : '/'}${match[1]}` : `${parentKey}${parentKey === '/' ? '' : '/'}${directory}`
  }

  if (!/^index\./.test(basename) && !/^\.(navigation)(\.[^.]+)?$/.test(basename)) {
    const match = basename.match(TRANSLATED_SLUG_SEGMENT_RE)
    entries.push({
      locale,
      file: document.file?.path || document.id,
      parentKey,
      raw: basename,
      number: match?.[1],
      kind: 'file'
    })
  }

  return entries
}

export const collectTranslatedSlugValidationIssues = (
  contents: ParsedContent[],
  options: { translatedSlugs?: boolean, locales?: string[] }
): TranslatedSlugValidationIssue[] => {
  if (!options.translatedSlugs) {
    return []
  }

  const issues: TranslatedSlugValidationIssue[] = []
  const seenEntries = new Set<string>()
  const siblingNumbers = new Map<string, TranslatedSlugEntry>()

  for (const document of contents) {
    const entries = getTranslatedSlugEntries(document, options.locales || [])
    const hasMissingPrefix = entries.some(entry => !entry.number)

    if (hasMissingPrefix) {
      issues.push({
        level: 'warn',
        file: document.file?.path || document.id,
        reason: 'translated slug mode expects numeric prefixes for localized route segments'
      })
    }

    for (const entry of entries) {
      if (!entry.number) {
        continue
      }

      const entryKey = `${entry.locale}:${entry.parentKey}:${entry.kind}:${entry.raw}`
      if (seenEntries.has(entryKey)) {
        continue
      }
      seenEntries.add(entryKey)

      const siblingKey = `${entry.locale}:${entry.parentKey}:${entry.number}`
      const previous = siblingNumbers.get(siblingKey)
      if (previous && previous.raw !== entry.raw) {
        issues.push({
          level: 'error',
          file: entry.file,
          reason: `duplicate numeric prefix "${entry.number}" among localized siblings`,
          details: `conflicts with ${previous.file}`
        })
        continue
      }

      siblingNumbers.set(siblingKey, entry)
    }
  }

  return issues
}
