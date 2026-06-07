import picomatch from 'picomatch'
import type { ContentCollectionConfig } from '../../types/config'
import { normalizeCollectionExcludes, normalizeCollectionSources } from './sources'

const stripLocalePrefix = (file: string, locales: string[]) => {
  const parts = file.split('/').filter(Boolean)
  if (parts[0] && locales.includes(parts[0])) {
    return parts.slice(1).join('/')
  }

  return file
}

const createNumericSlugPattern = (source: string) => {
  const translated = source
    .split('/')
    .map((segment) => {
      if (segment.includes('*')) {
        return segment
      }

      const match = /^(\d+)\.[^/]+?(\.[^.]+)?$/.exec(segment)
      if (!match) {
        return segment
      }

      return `${match[1]}.*${match[2] || ''}`
    })
    .join('/')

  return translated === source ? [source] : [source, translated]
}

const createSourceMatcher = (source: string) => {
  const matchers = createNumericSlugPattern(source).map(pattern => picomatch(pattern, { dot: true }))
  return (file: string) => matchers.some(isMatch => isMatch(file))
}

export const resolveCollection = (
  file: string,
  collections: Record<string, ContentCollectionConfig> = {},
  locales: string[] = []
) => {
  return resolveCollections(file, collections, locales)[0]
}

export const resolveCollections = (
  file: string,
  collections: Record<string, ContentCollectionConfig> = {},
  locales: string[] = []
) => {
  const normalizedFile = file.replace(/^\/+/, '')
  const localeAgnosticFile = stripLocalePrefix(normalizedFile, locales)
  const matches: string[] = []

  for (const [name, collection] of Object.entries(collections)) {
    const excludes = normalizeCollectionExcludes(collection.exclude)
    const isExcluded = excludes.some((source) => {
      const isMatch = createSourceMatcher(source)
      return isMatch(normalizedFile) || isMatch(localeAgnosticFile)
    })

    if (isExcluded) {
      continue
    }

    for (const source of normalizeCollectionSources(collection.source || [])) {
      const isMatch = createSourceMatcher(source)
      if (isMatch(normalizedFile) || isMatch(localeAgnosticFile)) {
        matches.push(name)
        break
      }
    }
  }

  return matches
}
