import type { ContentNavigationItem } from '../../types/content'

export type ContentNavigationMatch = {
  path?: string
  stem?: string
  title?: string
}

export type ResolvedContentNavigationItem = ContentNavigationItem & {
  path: string
}

const normalizePath = (path: string) => path !== '/' && path.endsWith('/') ? path.slice(0, -1) : path

const stringValue = (value: unknown) => typeof value === 'string' && value.length ? value : undefined

export const getNavigationItemPath = (item: ContentNavigationItem | null | undefined): string | undefined => {
  if (!item || item.page === false) {
    return undefined
  }

  return stringValue(item.path)
}

export const resolveNavigationItem = (item: ContentNavigationItem | null | undefined): ResolvedContentNavigationItem | null => {
  const path = getNavigationItemPath(item)
  return item && path ? { ...item, path } : null
}

const fieldMatches = (item: ContentNavigationItem, field: 'path' | 'unprefixedPath' | 'stem' | 'title', value: string) => {
  const candidate = stringValue(item[field])
  if (!candidate) {
    return false
  }

  if (field === 'path' || field === 'unprefixedPath') {
    return normalizePath(candidate) === normalizePath(value)
  }

  return candidate === value
}

export const matchesNavigationItem = (item: ContentNavigationItem, match: string | ContentNavigationMatch): boolean => {
  if (typeof match === 'string') {
    return fieldMatches(item, 'path', match)
      || fieldMatches(item, 'unprefixedPath', match)
      || fieldMatches(item, 'stem', match)
      || fieldMatches(item, 'title', match)
  }

  if (match.path && !(fieldMatches(item, 'path', match.path) || fieldMatches(item, 'unprefixedPath', match.path))) {
    return false
  }

  if (match.stem && !fieldMatches(item, 'stem', match.stem)) {
    return false
  }

  if (match.title && !fieldMatches(item, 'title', match.title)) {
    return false
  }

  return Boolean(match.path || match.stem || match.title)
}

export const findFirstNavigationPage = (items: ContentNavigationItem[] = []): ResolvedContentNavigationItem | null => {
  for (const item of items) {
    const resolved = resolveNavigationItem(item)
    if (resolved) {
      return resolved
    }

    const child = findFirstNavigationPage(item.children)
    if (child) {
      return child
    }
  }

  return null
}

export const findFirstNavigationChild = (item: ContentNavigationItem | null | undefined): ResolvedContentNavigationItem | null => {
  return findFirstNavigationPage(item?.children || [])
}

export const findNavigationItem = (
  items: ContentNavigationItem[] = [],
  match: number | string | ContentNavigationMatch,
  options: { recursive?: boolean } = {}
): ContentNavigationItem | null => {
  if (typeof match === 'number') {
    return items[match] || null
  }

  for (const item of items) {
    if (matchesNavigationItem(item, match)) {
      return item
    }

    if (options.recursive) {
      const child = findNavigationItem(item.children, match, options)
      if (child) {
        return child
      }
    }
  }

  return null
}

export const resolveNavigationPaths = (items: ContentNavigationItem[] = []): string[] => {
  return items
    .map(item => resolveNavigationItem(item)?.path)
    .filter((path): path is string => Boolean(path))
}

export const resolveNavigationFirstPages = (items: ContentNavigationItem[] = []): ResolvedContentNavigationItem[] => {
  return items
    .map(item => resolveNavigationItem(item) || findFirstNavigationChild(item))
    .filter((item): item is ResolvedContentNavigationItem => Boolean(item))
}

export const resolveNavigationFirstChildren = (items: ContentNavigationItem[] = []): ResolvedContentNavigationItem[] => {
  return items
    .map(item => findFirstNavigationChild(item))
    .filter((item): item is ResolvedContentNavigationItem => Boolean(item))
}
